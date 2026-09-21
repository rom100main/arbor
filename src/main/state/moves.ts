import type { ContainerId, TabId } from "../../shared/protocol"
import {
    childrenOf,
    containerOf,
    DomainError,
    reindex,
    removeContainer,
    siblingsOf,
    subtreeOf,
    tabCount,
    withTabs,
    type DomainState,
} from "./state"

const contains = (state: DomainState, ancestorId: TabId, tabId: TabId): boolean => {
    let current = state.tabs.get(tabId)
    while (current?.parentId) {
        if (current.parentId === ancestorId) return true
        current = state.tabs.get(current.parentId)
    }
    return false
}

export interface MoveTabOptions {
    tabId: TabId
    parentId: TabId | null
    index: number
}

export const moveTab = (state: DomainState, options: MoveTabOptions): DomainState => {
    const tab = state.tabs.get(options.tabId)
    if (!tab) throw new DomainError(`Unknown tab: ${options.tabId}`)
    if (options.parentId !== null) {
        const parent = state.tabs.get(options.parentId)
        if (!parent) throw new DomainError(`Unknown tab: ${options.parentId}`)
        if (parent.containerId !== tab.containerId) {
            throw new DomainError("Use moveToContainer for cross-container moves")
        }
        if (options.parentId === tab.id || contains(state, tab.id, options.parentId)) {
            throw new DomainError("Cannot move a tab into its own subtree")
        }
    }

    const next = withTabs(state, new Map(state.tabs))
    const oldSiblings = siblingsOf(state, tab).filter((s) => s.id !== tab.id)
    for (const updated of reindex(oldSiblings)) next.tabs.set(updated.id, updated)

    const moved = { ...tab, parentId: options.parentId }
    const targetSiblings = [...childrenOf(state, tab.containerId, options.parentId)]
    const withoutSelf = targetSiblings.filter((s) => s.id !== tab.id)
    withoutSelf.splice(Math.max(0, Math.min(options.index, withoutSelf.length)), 0, moved)
    for (const updated of reindex(withoutSelf)) next.tabs.set(updated.id, updated)
    return next
}

/** Move a tab and its subtree to another container; the tab becomes a root there. */
export const moveToContainer = (
    state: DomainState,
    tabId: TabId,
    containerId: ContainerId,
): DomainState => {
    const tab = state.tabs.get(tabId)
    if (!tab) throw new DomainError(`Unknown tab: ${tabId}`)
    const target = containerOf(state, containerId)
    if (tab.containerId === containerId) return state
    const source = containerOf(state, tab.containerId)

    const subtree = subtreeOf(state, tabId)
    const next = withTabs(state, new Map(state.tabs))
    const oldSiblings = siblingsOf(state, tab).filter((s) => s.id !== tab.id)
    for (const updated of reindex(oldSiblings)) next.tabs.set(updated.id, updated)

    const movedRoot = { ...tab, containerId: target.id, parentId: null }
    const targetRoots = childrenOf(state, target.id, null)
    movedRoot.order = targetRoots.length
    for (const node of subtree) {
        next.tabs.set(node.id, node.id === tabId ? movedRoot : { ...node, containerId: target.id })
    }

    let result: DomainState = { ...next }
    if (tabCount(result, source.id) === 0 && result.containers.length > 1) {
        const containers = result.containers
        const index = containers.findIndex((c) => c.id === source.id)
        result = removeContainer(result, source.id)
        if (result.activeContainerId === source.id) {
            const neighbor = containers[index + 1] ?? containers[index - 1]
            result = { ...result, activeContainerId: neighbor?.id ?? null }
        }
    }
    result = {
        ...result,
        activeContainerId: target.id,
        containers: result.containers.map((c) =>
            c.id === target.id ? { ...c, activeTabId: tabId } : c,
        ),
    }
    return result
}
