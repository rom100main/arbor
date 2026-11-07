// Should be Effect free

import type { ContainerId, DisplayTab, TabId, TabNode } from "./protocol"

/** Depth-first display order of a container's tree, pruning collapsed subtrees. */
export const displayTabs = (tabs: readonly TabNode[], containerId: ContainerId): DisplayTab[] => {
    const childrenByParent = new Map<TabId | null, TabNode[]>()
    for (const tab of tabs) {
        if (tab.containerId !== containerId) continue
        const key = tab.parentId ?? null
        const siblings = childrenByParent.get(key) ?? []
        siblings.push(tab)
        childrenByParent.set(key, siblings)
    }
    for (const siblings of childrenByParent.values()) {
        siblings.sort((a, b) => a.order - b.order)
    }

    const out: DisplayTab[] = []
    const walk = (parentId: TabId | null, depth: number): void => {
        for (const tab of childrenByParent.get(parentId) ?? []) {
            out.push({ ...tab, depth })
            if (!tab.collapsed) walk(tab.id, depth + 1)
        }
    }
    walk(null, 0)
    return out
}
