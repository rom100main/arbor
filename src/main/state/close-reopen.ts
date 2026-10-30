import { LastTab, NoContainer, NothingToReopen, UnknownTab } from "../../shared/errors"
import type { ClosedSubtree, ContainerId, TabId, TabNode } from "../../shared/protocol"
import {
    childrenOf,
    containerOf,
    descendantsOf,
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
 * an expanded tab promotes its direct children, inheriting its position and order.
 */
export const closeTab = (state: DomainState, tabId: TabId, now?: number): DomainState => {
    const tab = state.tabs.get(tabId)
    if (!tab) throw new UnknownTab({ tabId: tabId })
    const container = containerOf(state, tab.containerId)

    const descendants = descendantsOf(state, tabId)
    const expands = descendants.length > 0 && !tab.collapsed

    const removedCount = expands ? 1 : 1 + descendants.length
    if (removedCount >= state.tabs.size) {
        throw new LastTab()
    }

    const siblings = siblingsOf(state, tab)
    const indexBefore = siblings.findIndex((s) => s.id === tabId)

    const next = withTabs(state, new Map(state.tabs))
    next.tabs.delete(tabId)
    for (const node of descendants) next.tabs.delete(node.id)

    if (expands) {
        // Promotion: only direct children inherit the closed tab's position.
        const directChildren = descendants.filter((child) => child.parentId === tabId)
        const promoted = directChildren.map((child) => ({ ...child, parentId: tab.parentId }))
        siblings.splice(indexBefore, 1, ...promoted)
        for (const updated of reindex(siblings)) next.tabs.set(updated.id, updated)
        // Deeper descendants keep their existing parent links.
        for (const node of descendants) {
            if (node.parentId !== tabId) next.tabs.set(node.id, node)
        }
    } else {
        for (const updated of reindex(siblings.filter((s) => s.id !== tabId))) {
            next.tabs.set(updated.id, updated)
        }
    }

    const emptiesContainer = tabCount(next, container.id) === 0
    const entry: ClosedSubtree = {
        nodes: [tab, ...descendants],
        containerId: container.id,
        parentIdBefore: tab.parentId,
        indexBefore,
        containerMetaBefore: emptiesContainer ? container : null,
    }

    let result: DomainState = { ...next, closeHistory: [entry, ...next.closeHistory] }

    if (emptiesContainer) {
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
            if (fallbackTab) result.tabs.set(fallback, touch(fallbackTab, now))
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

/**
 * Reopen the most recently closed subtree at its original position.
 *
 * When the original parent has moved to another container or no longer exists,
 * the reopened root becomes a root in a valid restored/original container.
 */
export const reopenTab = (state: DomainState, now?: number): DomainState => {
    const [entry, ...rest] = state.closeHistory
    if (!entry) throw new NothingToReopen()

    // Restore the container if it was auto-deleted on close.
    if (
        entry.containerMetaBefore !== null &&
        !state.containers.some((c) => c.id === entry.containerId)
    ) {
        const restored = { ...entry.containerMetaBefore, activeTabId: null }
        state = { ...state, containers: [...state.containers, restored] }
        if (state.activeContainerId === null) state = { ...state, activeContainerId: restored.id }
    }

    // Resolve a valid container: fall back when the original is gone and unrestorable.
    let containerId = entry.containerId
    if (!state.containers.some((c) => c.id === containerId)) {
        containerId = state.activeContainerId ?? state.containers[0]?.id
        if (!containerId) throw new NoContainer()
    }

    // Keep the original parent only when it exists and lives in the same container.
    const parent = entry.parentIdBefore !== null ? state.tabs.get(entry.parentIdBefore) : undefined
    const parentId = parent && parent.containerId === containerId ? entry.parentIdBefore : null

    const root: TabNode = { ...entry.nodes[0], containerId, parentId }
    const descendants = entry.nodes.slice(1).map((node) => ({ ...node, containerId }))

    const next = withTabs(state, new Map(state.tabs))

    // Exclude restored descendants from the sibling list so reindex stays correct
    // even when a close promoted them into the parent's children.
    const descendantIds = new Set(entry.nodes.slice(1).map((n) => n.id))
    const siblings = childrenOf(state, containerId, parentId).filter(
        (s) => !descendantIds.has(s.id),
    )
    const index = Math.min(entry.indexBefore, siblings.length)
    siblings.splice(index, 0, root)
    for (const updated of reindex(siblings)) next.tabs.set(updated.id, updated)
    for (const node of descendants) next.tabs.set(node.id, node)
    next.tabs.set(root.id, touch(root, now))

    return {
        ...next,
        closeHistory: rest,
        activeContainerId: containerId,
        containers: next.containers.map((c) =>
            c.id === containerId ? { ...c, activeTabId: root.id } : c,
        ),
    }
}
