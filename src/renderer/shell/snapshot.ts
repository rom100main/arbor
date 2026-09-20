import { createSignal } from "solid-js"

import type { BrowserSnapshot, DisplayTab, TabId } from "../../shared/protocol"
import { displayTabs } from "../../shared/tree-display"

const [snapshot, setSnapshot] = createSignal<BrowserSnapshot | null>(null)

let initialized = false

export const initState = async (): Promise<void> => {
    if (initialized) return
    initialized = true
    setSnapshot(await window.arbor.getSnapshot())
    window.arbor.onState(setSnapshot)
}

export const useSnapshot = () => snapshot

// Solid's <For> keys rows by item reference,
// so fresh DisplayTab objects on every commit would remount every row
// (the favicon <img> visibly blinks on collapse).
// Reuse the previous DisplayTab unless a field the row renders changed.
// `collapsed` and `order` are intentionally excluded:
// collapsed is read live from the snapshot inside TabRow,
// and order only affects the array position,
// which <For> applies by moving existing nodes.
const displayCache = new Map<TabId, DisplayTab>()

const sameDisplay = (a: DisplayTab, b: DisplayTab): boolean =>
    a.containerId === b.containerId &&
    a.parentId === b.parentId &&
    a.depth === b.depth &&
    a.url === b.url &&
    a.title === b.title &&
    a.favicon === b.favicon &&
    a.userLabel === b.userLabel

const stableDisplayTabs = (tabs: DisplayTab[]): DisplayTab[] => {
    const visible = new Set<TabId>()
    const next = tabs.map((tab) => {
        visible.add(tab.id)
        const cached = displayCache.get(tab.id)
        if (cached && sameDisplay(cached, tab)) return cached
        displayCache.set(tab.id, tab)
        return tab
    })
    for (const id of displayCache.keys()) {
        if (!visible.has(id)) displayCache.delete(id)
    }
    return next
}

export const useActiveContainerTabs = () => {
    return () => {
        const snap = snapshot()
        if (!snap || snap.activeContainerId === null) return []
        return stableDisplayTabs(displayTabs(snap.tabs, snap.activeContainerId))
    }
}
