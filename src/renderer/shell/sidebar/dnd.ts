import { createSignal } from "solid-js"

import type { BrowserSnapshot, ContainerId, TabId } from "../../../shared/protocol"

export type DropPosition = "before" | "after" | "child"

export interface TabDropTarget {
    tabId: TabId
    position: DropPosition
}

// DataTransfer.getData is unavailable during dragover, so track the dragged tab in-module.
let draggedTabId: TabId | null = null

export const getDraggedTabId = (): TabId | null => draggedTabId

export const setDraggedTabId = (tabId: TabId | null): void => {
    draggedTabId = tabId
}

const [tabDropTarget, setTabDropTarget] = createSignal<TabDropTarget | null>(null)
const [containerDropTarget, setContainerDropTarget] = createSignal<ContainerId | null>(null)

export { containerDropTarget, setContainerDropTarget, tabDropTarget }

export const setTabDrop = (next: TabDropTarget | null): void => {
    setTabDropTarget((prev) =>
        prev?.tabId === next?.tabId && prev?.position === next?.position ? prev : next,
    )
}

export const clearDragState = (): void => {
    draggedTabId = null
    setTabDrop(null)
    setContainerDropTarget(null)
}

export const isDescendantOf = (snap: BrowserSnapshot, ancestorId: TabId, tabId: TabId): boolean => {
    let current = snap.tabs.find((t) => t.id === tabId)
    while (current?.parentId) {
        if (current.parentId === ancestorId) return true
        current = snap.tabs.find((t) => t.id === current!.parentId)
    }
    return false
}

/** Index of the drop slot among the target's siblings, excluding the dragged tab. */
export const siblingIndex = (
    snap: BrowserSnapshot,
    draggedId: TabId,
    targetId: TabId,
    position: "before" | "after",
): number => {
    const target = snap.tabs.find((t) => t.id === targetId)
    if (!target) return 0
    const siblings = snap.tabs
        .filter(
            (t) =>
                t.containerId === target.containerId &&
                t.parentId === target.parentId &&
                t.id !== draggedId,
        )
        .sort((a, b) => a.order - b.order)
    const targetIndex = siblings.findIndex((t) => t.id === targetId)
    return position === "before" ? targetIndex : targetIndex + 1
}

export const dropPosition = (event: DragEvent): DropPosition | null => {
    const row = event.currentTarget
    if (!(row instanceof HTMLElement)) return null
    const rect = row.getBoundingClientRect()
    const ratio = (event.clientY - rect.top) / rect.height
    if (ratio < 0.28) return "before"
    if (ratio > 0.72) return "after"
    return "child"
}

export const leftRow = (event: DragEvent): boolean => {
    const entering = event.relatedTarget
    const row = event.currentTarget
    if (entering instanceof Node && row instanceof Node && row.contains(entering)) return false
    return true
}
