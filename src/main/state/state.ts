import { Result } from "effect"

import { UnknownContainer, UnknownTab } from "../../shared/errors"
import type {
    BrowserSnapshot,
    ClosedSubtree,
    ContainerId,
    ContainerMeta,
    ExtensionGrant,
    TabId,
    TabNode,
} from "../../shared/protocol"

export interface DomainState {
    containers: ContainerMeta[]
    tabs: Map<TabId, TabNode>
    closeHistory: ClosedSubtree[]
    activeContainerId: ContainerId | null
    /**
     * Per-extension consent ledger: install consent plus runtime-granted permissions.
     * Presence of a key means the user accepted that scope; not part of the snapshot.
     * Keyed by extension id (unpacked dev installs also key on their source path).
     */
    extensionConsent: Record<string, ExtensionGrant>
}

export type { DomainError } from "../../shared/errors"

export const initialState = (): DomainState => ({
    containers: [],
    tabs: new Map(),
    closeHistory: [],
    activeContainerId: null,
    extensionConsent: {},
})

// --- shared helpers

export const childrenOf = (
    state: DomainState,
    containerId: ContainerId,
    parentId: TabId | null,
): TabNode[] =>
    [...state.tabs.values()]
        .filter((tab) => tab.containerId === containerId && tab.parentId === parentId)
        .sort((a, b) => a.order - b.order)

export const siblingsOf = (state: DomainState, tab: TabNode): TabNode[] =>
    childrenOf(state, tab.containerId, tab.parentId)

export const reindex = (siblings: TabNode[]): TabNode[] =>
    siblings.map((tab, index) => ({ ...tab, order: index }))

export const withTabs = (state: DomainState, tabs: Map<TabId, TabNode>): DomainState => ({
    ...state,
    tabs,
})

export const tabOf = (state: DomainState, tabId: TabId): Result.Result<TabNode, UnknownTab> => {
    const tab = state.tabs.get(tabId)
    return tab ? Result.succeed(tab) : Result.fail(new UnknownTab({ tabId }))
}

export const containerOf = (
    state: DomainState,
    containerId: ContainerId,
): Result.Result<ContainerMeta, UnknownContainer> => {
    const container = state.containers.find((c) => c.id === containerId)
    return container
        ? Result.succeed(container)
        : Result.fail(new UnknownContainer({ containerId }))
}

/** `state` with one tab replaced or added. */
export const putTab = (state: DomainState, tab: TabNode): DomainState =>
    withTabs(state, new Map(state.tabs).set(tab.id, tab))

export const removeContainer = (state: DomainState, containerId: ContainerId): DomainState => {
    const remaining = state.containers.filter((c) => c.id !== containerId)
    return { ...state, containers: remaining }
}

export const tabCount = (state: DomainState, containerId: ContainerId): number =>
    [...state.tabs.values()].filter((t) => t.containerId === containerId).length

/** Update `lastActiveAt` */
export const touch = (tab: TabNode, now: number): TabNode => ({
    ...tab,
    lastActiveAt: now,
})

/** Every tab below `root`, parents before children. */
export const descendantsOf = (state: DomainState, root: TabNode): TabNode[] => {
    const result: TabNode[] = []
    const walk = (parentId: TabId): void => {
        for (const child of childrenOf(state, root.containerId, parentId)) {
            result.push(child)
            walk(child.id)
        }
    }
    walk(root.id)
    return result
}

export const subtreeOf = (state: DomainState, root: TabNode): TabNode[] => [
    root,
    ...descendantsOf(state, root),
]

// --- derived

export const snapshot = (state: DomainState): BrowserSnapshot => {
    const active = state.activeContainerId
        ? state.containers.find((c) => c.id === state.activeContainerId)
        : undefined
    return {
        containers: [...state.containers],
        tabs: [...state.tabs.values()],
        activeContainerId: state.activeContainerId,
        activeTabId: active?.activeTabId ?? null,
    }
}
