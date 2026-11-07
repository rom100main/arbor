import type { ContainerId, TabId, TabNode } from "../../shared/protocol"
import { displayTabs } from "../../shared/tree-display"

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
