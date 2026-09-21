import type { ClosedSubtree, ContainerId, TabId, TabNode } from "../../shared/protocol"
import {
    childrenOf,
    containerOf,
    descendantsOf,
    DomainError,
    reindex,
    removeContainer,
    siblingsOf,
    tabCount,
    touch,
    withTabs,
    type DomainState,
} from "./state"

const successorTab = (state: DomainState, removed: TabNode): TabId | null => {
    const siblings = siblingsOf(state, removed)
    const index = siblings.findIndex((s) => s.id === removed.id)
    const nextSibling = siblings[index + 1] ?? siblings[index - 1]
    if (nextSibling) return nextSibling.id
    if (removed.parentId !== null) return removed.parentId
    const roots = childrenOf(state, removed.containerId, null)
    return roots[0]?.id ?? null
}

/**
 * Close semantics:
 * a collapsed tab takes its whole subtree;
 * an expanded tab promotes its children, inheriting its position and order.
 */
export const closeTab = (state: DomainState, tabId: TabId): DomainState => {
    const tab = state.tabs.get(tabId)
    if (!tab) throw new DomainError(`Unknown tab: ${tabId}`)
    const container = containerOf(state, tab.containerId)
    if (state.containers.length === 1 && tabCount(state, container.id) === 1) {
        throw new DomainError("Cannot close the last tab of the last container")
    }

    const descendants = descendantsOf(state, tabId)
    const expands = descendants.length > 0 && !tab.collapsed

    const siblings = siblingsOf(state, tab)
    const indexBefore = siblings.findIndex((s) => s.id === tabId)

    const next = withTabs(state, new Map(state.tabs))
    next.tabs.delete(tabId)
    for (const node of descendants) next.tabs.delete(node.id)

    if (expands) {
        const promoted = descendants.map((child) => ({ ...child, parentId: tab.parentId }))
        siblings.splice(indexBefore, 1, ...promoted)
        for (const updated of reindex(siblings)) next.tabs.set(updated.id, updated)
    } else {
        for (const updated of reindex(siblings.filter((s) => s.id !== tabId))) {
            next.tabs.set(updated.id, updated)
        }
    }

    const entry: ClosedSubtree = {
        nodes: [tab, ...descendants],
        containerId: container.id,
        parentIdBefore: tab.parentId,
        indexBefore,
        containerMetaBefore: null,
    }

    let result: DomainState = { ...next, closeHistory: [entry, ...next.closeHistory] }

    if (tabCount(result, container.id) === 0) {
        entry.containerMetaBefore = { ...container }
        const containers = result.containers
        const index = containers.findIndex((c) => c.id === container.id)
        result = removeContainer(result, container.id)
        if (result.activeContainerId === container.id) {
            const neighbor = containers[index + 1] ?? containers[index - 1]
            result = { ...result, activeContainerId: neighbor?.id ?? null }
        }
        return result
    }

    if (
        container.activeTabId === tabId ||
        descendants.some((d) => d.id === container.activeTabId)
    ) {
        const fallback = expands
            ? (promotedSuccessor(result, container.id, tab.parentId, indexBefore) ?? null)
            : successorTab(result, tab)
        if (fallback) {
            const fallbackTab = result.tabs.get(fallback)
            if (fallbackTab) result.tabs.set(fallback, touch(fallbackTab))
        }
        result = {
            ...result,
            containers: result.containers.map((c) =>
                c.id === container.id ? { ...c, activeTabId: fallback } : c,
            ),
        }
    }
    return result
}

const promotedSuccessor = (
    state: DomainState,
    containerId: ContainerId,
    parentId: TabId | null,
    indexBefore: number,
): TabId | null => {
    const siblings = childrenOf(state, containerId, parentId)
    return siblings[Math.min(indexBefore, siblings.length - 1)]?.id ?? null
}

/** Reopen the most recently closed subtree at its original position. */
export const reopenTab = (state: DomainState): DomainState => {
    const [entry, ...rest] = state.closeHistory
    if (!entry) throw new DomainError("No closed tab to reopen")
    if (
        entry.containerMetaBefore !== null &&
        !state.containers.some((c) => c.id === entry.containerId)
    ) {
        const restored = { ...entry.containerMetaBefore, activeTabId: null }
        state = { ...state, containers: [...state.containers, restored] }
        if (state.activeContainerId === null) state = { ...state, activeContainerId: restored.id }
    }
    const container = containerOf(state, entry.containerId)

    const next = withTabs(state, new Map(state.tabs))
    const siblings = childrenOf(state, container.id, entry.parentIdBefore)
    const index = Math.min(entry.indexBefore, siblings.length)
    siblings.splice(index, 0, entry.nodes[0])
    const reindexed = new Map<TabId, TabNode>()
    for (const updated of reindex(siblings)) reindexed.set(updated.id, updated)
    for (const node of entry.nodes.slice(1)) reindexed.set(node.id, node)
    for (const [id, node] of reindexed) next.tabs.set(id, node)
    next.tabs.set(entry.nodes[0].id, touch(entry.nodes[0]))

    return {
        ...next,
        closeHistory: rest,
        activeContainerId: container.id,
        containers: next.containers.map((c) =>
            c.id === container.id ? { ...c, activeTabId: entry.nodes[0].id } : c,
        ),
    }
}
