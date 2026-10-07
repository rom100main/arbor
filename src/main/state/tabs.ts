import type { ContainerId, TabId, TabNode } from "../../shared/protocol"
import {
    childrenOf,
    containerOf,
    DomainError,
    okWith,
    reindex,
    siblingsOf,
    touch,
    withTabs,
    type DomainState,
    type TransitionResult,
} from "./state"

export interface CreateTabOptions {
    id?: TabId
    now?: number
    containerId?: ContainerId
    url?: string
}

export interface CreateChildTabOptions {
    id?: TabId
    now?: number
    url?: string
    /** Background opens must not steal focus from the originating tab. */
    background?: boolean
}

/** Manual new tab: sibling inserted right after the active tab. */
export const createTab = (
    state: DomainState,
    options: CreateTabOptions = {},
): TransitionResult<TabId> => {
    if (state.containers.length === 0) throw new DomainError("No container to create a tab in")
    const id = options.id ?? `tab-${crypto.randomUUID()}`
    const now = options.now ?? Date.now()
    const containerId = options.containerId ?? state.activeContainerId ?? state.containers[0].id
    const container = containerOf(state, containerId)
    const anchor =
        container.activeTabId !== null ? state.tabs.get(container.activeTabId) : undefined

    const tab: TabNode = {
        id,
        containerId,
        parentId: null,
        order: 0,
        url: options.url ?? "about:blank",
        title: "",
        collapsed: false,
        userLabel: null,
        favicon: null,
        lastActiveAt: now,
    }

    let next = withTabs(state, new Map(state.tabs))
    if (anchor) {
        tab.parentId = anchor.parentId
        const siblings = siblingsOf(state, anchor)
        const index = siblings.findIndex((s) => s.id === anchor.id)
        siblings.splice(index + 1, 0, tab)
        for (const updated of reindex(siblings)) next.tabs.set(updated.id, updated)
    } else {
        const roots = childrenOf(state, containerId, null)
        tab.order = roots.length
        next.tabs.set(tab.id, tab)
    }

    next = {
        ...next,
        containers: next.containers.map((c) =>
            c.id === containerId ? { ...c, activeTabId: tab.id } : c,
        ),
        activeContainerId: containerId,
    }
    return okWith(next, id)
}

/** Tab opened by a link (ctrl+click, target=_blank): last child of the parent. */
export const createChildTab = (
    state: DomainState,
    parentTabId: TabId,
    options: CreateChildTabOptions = {},
): TransitionResult<TabId> => {
    const parent = state.tabs.get(parentTabId)
    if (!parent) throw new DomainError(`Unknown tab: ${parentTabId}`)
    const id = options.id ?? `tab-${crypto.randomUUID()}`
    const now = options.now ?? Date.now()
    const tab: TabNode = {
        id,
        containerId: parent.containerId,
        parentId: parent.id,
        order: 0,
        url: options.url ?? "about:blank",
        title: "",
        collapsed: false,
        userLabel: null,
        favicon: null,
        lastActiveAt: now,
    }
    const next = withTabs(state, new Map(state.tabs))
    const siblings = childrenOf(state, parent.containerId, parent.id)
    siblings.push(tab)
    for (const updated of reindex(siblings)) next.tabs.set(updated.id, updated)
    if (options.background) return okWith(next, id)
    return okWith(
        {
            ...next,
            activeContainerId: parent.containerId,
            containers: next.containers.map((c) =>
                c.id === parent.containerId ? { ...c, activeTabId: tab.id } : c,
            ),
        },
        id,
    )
}

export const selectTab = (state: DomainState, tabId: TabId, now?: number): DomainState => {
    const tab = state.tabs.get(tabId)
    if (!tab) throw new DomainError(`Unknown tab: ${tabId}`)
    const next = withTabs(state, new Map(state.tabs))
    next.tabs.set(tabId, touch(tab, now))
    return {
        ...next,
        activeContainerId: tab.containerId,
        containers: next.containers.map((c) =>
            c.id === tab.containerId ? { ...c, activeTabId: tab.id } : c,
        ),
    }
}

export const setCollapsed = (state: DomainState, tabId: TabId, collapsed: boolean): DomainState => {
    const tab = state.tabs.get(tabId)
    if (!tab) throw new DomainError(`Unknown tab: ${tabId}`)
    if (tab.collapsed === collapsed) return state
    const next = withTabs(state, new Map(state.tabs))
    next.tabs.set(tabId, { ...tab, collapsed })
    return next
}

/** Custom label overriding the page title until cleared. */
export const renameTab = (state: DomainState, tabId: TabId, label: string | null): DomainState => {
    const tab = state.tabs.get(tabId)
    if (!tab) throw new DomainError(`Unknown tab: ${tabId}`)
    const next = withTabs(state, new Map(state.tabs))
    next.tabs.set(tabId, { ...tab, userLabel: label && label.length > 0 ? label : null })
    return next
}
