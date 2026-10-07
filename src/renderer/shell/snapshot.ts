import { createMemo, createSignal } from "solid-js"

import type { BrowserSnapshot, DisplayTab, TabId } from "../../shared/protocol"
import { displayTabs } from "../../shared/tree-display"
import { createInit } from "./init-store"

const [snapshot, setSnapshot] = createSignal<BrowserSnapshot | null>(null)

export const initState = createInit<BrowserSnapshot | null>({
    subscribe: (callback) => window.arbor.onState(callback),
    fetch: () => window.arbor.getSnapshot(),
    apply: (value) => setSnapshot(value),
})

export const useSnapshot = () => snapshot

// Solid's <For> keys rows by item reference,
// so fresh DisplayTab objects on every commit would remount every row
// (the favicon <img> visibly blinks on collapse).
// Reuse the previous DisplayTab unless a field the row renders changed.
// `collapsed` and `order` are intentionally excluded:
// collapsed arrives via useTreeMeta,
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

export interface TreeMeta {
    readonly parentIds: ReadonlySet<TabId>
    readonly collapsedIds: ReadonlySet<TabId>
}

const EMPTY_META: TreeMeta = { parentIds: new Set(), collapsedIds: new Set() }

export const useTreeMeta = () => {
    return createMemo((): TreeMeta => {
        const snap = snapshot()
        if (!snap) return EMPTY_META
        const parentIds = new Set<TabId>()
        const collapsedIds = new Set<TabId>()
        for (const tab of snap.tabs) {
            if (tab.parentId !== null) parentIds.add(tab.parentId)
            if (tab.collapsed) collapsedIds.add(tab.id)
        }
        return { parentIds, collapsedIds }
    })
}
