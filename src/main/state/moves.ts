import { Result } from "effect"

import { InvalidMove } from "../../shared/errors"
import type { ContainerId, TabId, TabNode } from "../../shared/protocol"
import {
    childrenOf,
    containerOf,
    reindex,
    removeContainer,
    siblingsOf,
    subtreeOf,
    tabCount,
    tabOf,
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

export const moveTab = (state: DomainState, options: MoveTabOptions) =>
    Result.gen(function* () {
        const tab = yield* tabOf(state, options.tabId)
        if (options.parentId !== null) {
            const parent = yield* tabOf(state, options.parentId)
            if (parent.containerId !== tab.containerId) {
                return yield* Result.fail(new InvalidMove({ reason: "across-containers" }))
            }
            if (options.parentId === tab.id || contains(state, tab.id, options.parentId)) {
                return yield* Result.fail(new InvalidMove({ reason: "into-own-subtree" }))
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
    })

/** Move a tab and its subtree to another container; the tab becomes a root there. */
export const moveToContainer = (state: DomainState, tabId: TabId, containerId: ContainerId) =>
    Result.gen(function* () {
        const tab = yield* tabOf(state, tabId)
        const target = yield* containerOf(state, containerId)
        if (tab.containerId === containerId) return state
        const source = yield* containerOf(state, tab.containerId)

        const subtree = subtreeOf(state, tab)
        const subtreeIds = new Set(subtree.map((n) => n.id))
        const next = withTabs(state, new Map(state.tabs))
        const oldSiblings = siblingsOf(state, tab).filter((s) => s.id !== tab.id)
        for (const updated of reindex(oldSiblings)) next.tabs.set(updated.id, updated)

        const targetRoots = childrenOf(state, target.id, null)
        const movedRoot: TabNode = {
            ...tab,
            containerId: target.id,
            parentId: null,
            order: targetRoots.length,
        }
        for (const node of subtree) {
            next.tabs.set(
                node.id,
                node.id === tabId ? movedRoot : { ...node, containerId: target.id },
            )
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
        } else if (source.activeTabId !== null && subtreeIds.has(source.activeTabId)) {
            // Repair the source container's active pointer when it referenced the moved subtree.
            const remaining = [...next.tabs.values()].find(
                (t) => t.containerId === source.id && !subtreeIds.has(t.id),
            )
            result = {
                ...result,
                containers: result.containers.map((c) =>
                    c.id === source.id ? { ...c, activeTabId: remaining?.id ?? null } : c,
                ),
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
    })
