import { Schema } from "effect"

import { decodeOr, orDefault } from "../../shared/decode"
import {
    ContainerId,
    ContainerMeta,
    ExtensionGrant,
    TabNode,
    type ContainerIcon,
    type TabId,
} from "../../shared/protocol"
import { reindex, type DomainState } from "./state"

export const PERSIST_VERSION = 1

/** Flat JSON shape for disk */
export interface PersistedState {
    version: typeof PERSIST_VERSION
    containers: ContainerMeta[]
    tabs: TabNode[]
    activeContainerId: ContainerId | null
    extensionConsent: Record<string, ExtensionGrant>
}

const cloneGrant = (grant: {
    readonly permissions: readonly string[]
    readonly origins: readonly string[]
}): ExtensionGrant => ({
    permissions: [...grant.permissions],
    origins: [...grant.origins],
})

export const toPersisted = (state: DomainState): PersistedState => ({
    version: PERSIST_VERSION,
    containers: state.containers.map((c) => ({ ...c })),
    tabs: [...state.tabs.values()].map((t) => ({ ...t })),
    activeContainerId: state.activeContainerId,
    extensionConsent: Object.fromEntries(
        Object.entries(state.extensionConsent).map(([id, grant]) => [id, cloneGrant(grant)]),
    ),
})


export const PersistedContainer = Schema.Struct({
    ...ContainerMeta.fields,
    color: orDefault(ContainerMeta.fields.color, () => "#3b82f6"),
    icon: orDefault(ContainerMeta.fields.icon, (): ContainerIcon => "world"),
    activeTabId: orDefault(ContainerMeta.fields.activeTabId, () => null),
})

export const PersistedTab = Schema.Struct({
    ...TabNode.fields,
    order: orDefault(TabNode.fields.order, () => 0),
    title: orDefault(TabNode.fields.title, () => ""),
    collapsed: orDefault(TabNode.fields.collapsed, () => false),
    userLabel: orDefault(TabNode.fields.userLabel, () => null),
    favicon: orDefault(TabNode.fields.favicon, () => null),
    lastActiveAt: orDefault(TabNode.fields.lastActiveAt, () => 0),
})

const PersistedGrant = Schema.Struct({
    permissions: orDefault(ExtensionGrant.fields.permissions, () => []),
    origins: orDefault(ExtensionGrant.fields.origins, () => []),
})

const PersistedStateSchema = Schema.Struct({
    version: Schema.Literal(PERSIST_VERSION),
    containers: Schema.Array(Schema.Unknown),
    tabs: Schema.Array(Schema.Unknown),
    activeContainerId: orDefault(Schema.NullOr(ContainerId), () => null),
    extensionConsent: orDefault(
        Schema.Record(Schema.String, Schema.Unknown),
        (): Record<string, unknown> => ({}),
    ),
})

const parseContainer = decodeOr(PersistedContainer)
const parseTab = decodeOr(PersistedTab)
const parseGrant = decodeOr(PersistedGrant)
const parsePayload = decodeOr(PersistedStateSchema)

/**
 * Parse a disk payload into a well-formed `DomainState`, or `null` when unusable.
 * Repairs dangling pointers instead of rejecting the whole file:
 * drops orphan tabs, empty containers, and cycles;
 * reindexes sibling order;
 * resets active pointers that no longer resolve.
 */
export const fromPersisted = (data: unknown): DomainState | null => {
    const payload = parsePayload(data)
    if (!payload) return null

    const containers: ContainerMeta[] = []
    const containerIds = new Set<ContainerId>()
    for (const raw of payload.containers) {
        const container = parseContainer(raw)
        if (!container || containerIds.has(container.id)) continue
        containerIds.add(container.id)
        containers.push(container)
    }

    const parsedTabs: TabNode[] = []
    const tabIds = new Set<TabId>()
    for (const raw of payload.tabs) {
        const tab = parseTab(raw)
        if (!tab || tabIds.has(tab.id) || !containerIds.has(tab.containerId)) continue
        tabIds.add(tab.id)
        parsedTabs.push(tab)
    }

    // Drop tabs whose parent is missing or lives in another container.
    const byId = new Map(parsedTabs.map((t) => [t.id, t]))
    const withParent = parsedTabs.filter((tab) => {
        if (tab.parentId === null) return true
        const parent = byId.get(tab.parentId)
        return parent !== undefined && parent.containerId === tab.containerId
    })

    // Keep only nodes reachable from roots (drops parent-cycles).
    const byParent = new Map<string | null, TabNode[]>()
    for (const tab of withParent) {
        const bucket = byParent.get(tab.parentId)
        if (bucket) bucket.push(tab)
        else byParent.set(tab.parentId, [tab])
    }
    const reachable = new Map<TabId, TabNode>()
    const walk = (parentId: TabId | null): void => {
        for (const child of byParent.get(parentId) ?? []) {
            if (reachable.has(child.id)) continue
            reachable.set(child.id, child)
            walk(child.id)
        }
    }
    walk(null)

    // Reindex sibling order per (container, parent).
    const groups = new Map<string, TabNode[]>()
    for (const tab of reachable.values()) {
        const key = `${tab.containerId}\0${tab.parentId ?? ""}`
        const bucket = groups.get(key)
        if (bucket) bucket.push(tab)
        else groups.set(key, [tab])
    }
    const reindexed = new Map<TabId, TabNode>()
    for (const bucket of groups.values()) {
        bucket.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
        for (const tab of reindex(bucket)) reindexed.set(tab.id, tab)
    }

    const inContainer = (containerId: ContainerId): TabNode[] =>
        [...reindexed.values()].filter((t) => t.containerId === containerId)

    // Empty containers cannot exist in a live DomainState.
    const liveContainers: ContainerMeta[] = []
    for (const container of containers) {
        const tabs = inContainer(container.id)
        if (tabs.length === 0) continue
        const activeOk =
            container.activeTabId !== null &&
            reindexed.get(container.activeTabId)?.containerId === container.id
        const roots = tabs.filter((t) => t.parentId === null).sort((a, b) => a.order - b.order)
        liveContainers.push({
            ...container,
            activeTabId: activeOk ? container.activeTabId : (roots[0]?.id ?? tabs[0].id),
        })
    }

    if (liveContainers.length === 0) return null

    const rawActive = payload.activeContainerId
    const activeContainerId =
        rawActive !== null && liveContainers.some((c) => c.id === rawActive)
            ? rawActive
            : liveContainers[0].id

    const extensionConsent: Record<string, ExtensionGrant> = {}
    for (const [id, raw] of Object.entries(payload.extensionConsent)) {
        const grant = parseGrant(raw)
        if (!grant || id.length === 0) continue
        extensionConsent[id] = cloneGrant(grant)
    }

    return {
        containers: liveContainers,
        tabs: reindexed,
        closeHistory: [],
        activeContainerId,
        extensionConsent,
    }
}
