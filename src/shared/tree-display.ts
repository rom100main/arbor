import type { ContainerId, DisplayTab, TabId, TabNode } from "./protocol"

/** Depth-first display order of a container's tree, pruning collapsed subtrees. */
export const displayTabs = (tabs: TabNode[], containerId: ContainerId): DisplayTab[] => {
    const childrenByParent = new Map<string | null, TabNode[]>()
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
    const walk = (parentId: string | null, depth: number): void => {
        for (const tab of childrenByParent.get(parentId) ?? []) {
            out.push({ ...tab, depth })
            if (!tab.collapsed) walk(tab.id, depth + 1)
        }
    }
    walk(null, 0)
    return out
}

/**
 * Next/previous tab in visual tree order (Ctrl+Tab),
 * cyclic within the container's currently visible rows.
 */
export const stepVisibleTab = (
    tabs: Iterable<TabNode> | ReadonlyMap<TabId, TabNode>,
    containerId: ContainerId,
    activeTabId: TabId | null,
    delta: 1 | -1,
): TabId | null => {
    const list = tabs instanceof Map ? [...tabs.values()] : [...tabs]
    const visible = displayTabs(list, containerId)
    if (visible.length === 0) return null
    if (activeTabId === null) {
        return (delta === 1 ? visible[0] : visible[visible.length - 1]).id
    }
    const index = visible.findIndex((tab) => tab.id === activeTabId)
    if (index === -1) return (delta === 1 ? visible[0] : visible[visible.length - 1]).id
    const next = visible[(index + delta + visible.length) % visible.length]
    return next.id
}
