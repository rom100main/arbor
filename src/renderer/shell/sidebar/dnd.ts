import { createSignal } from "solid-js"

import type { BrowserSnapshot, ContainerId, TabId } from "../../../shared/protocol"

export type DropPosition = "before" | "after" | "child"
export type ContainerOrderPosition = "before" | "after"

export interface TabDropTarget {
    tabId: TabId
    position: DropPosition
}

export interface ContainerOrderDrop {
    containerId: ContainerId
    position: ContainerOrderPosition
}

// DataTransfer.getData is unavailable during dragover, so track the dragged tab in-module.
let draggedTabId: TabId | null = null
let draggedContainerId: ContainerId | null = null

export const getDraggedTabId = (): TabId | null => draggedTabId

export const setDraggedTabId = (tabId: TabId | null): void => {
    draggedTabId = tabId
}

export const getDraggedContainerId = (): ContainerId | null => draggedContainerId

export const setDraggedContainerId = (containerId: ContainerId | null): void => {
    draggedContainerId = containerId
}

const [tabDropTarget, setTabDropTarget] = createSignal<TabDropTarget | null>(null)
const [containerDropTarget, setContainerDropTarget] = createSignal<ContainerId | null>(null)
const [containerOrderDrop, setContainerOrderDropTarget] = createSignal<ContainerOrderDrop | null>(
    null,
)

export { containerDropTarget, containerOrderDrop, setContainerDropTarget, tabDropTarget }

export const setTabDrop = (next: TabDropTarget | null): void => {
    setTabDropTarget((prev) =>
        prev?.tabId === next?.tabId && prev?.position === next?.position ? prev : next,
    )
}

export const setContainerOrderDrop = (next: ContainerOrderDrop | null): void => {
    setContainerOrderDropTarget((prev) =>
        prev?.containerId === next?.containerId && prev?.position === next?.position ? prev : next,
    )
}

export const clearDragState = (): void => {
    draggedTabId = null
    draggedContainerId = null
    setTabDrop(null)
    setContainerDropTarget(null)
    setContainerOrderDrop(null)
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

export const containerOrderPosition = (event: DragEvent): ContainerOrderPosition | null => {
    const chip = event.currentTarget
    if (!(chip instanceof HTMLElement)) return null
    const rect = chip.getBoundingClientRect()
    const ratio = (event.clientX - rect.left) / rect.width
    return ratio < 0.5 ? "before" : "after"
}

/** Final container index for a before/after drop, computed against the list without the dragged container. */
export const containerReorderIndex = (
    snap: BrowserSnapshot,
    draggedId: ContainerId,
    targetId: ContainerId,
    position: ContainerOrderPosition,
): number => {
    const without = snap.containers.filter((c) => c.id !== draggedId)
    const targetIndex = without.findIndex((c) => c.id === targetId)
    if (targetIndex === -1) return without.length
    return position === "before" ? targetIndex : targetIndex + 1
}

export const leftRow = (event: DragEvent): boolean => {
    const entering = event.relatedTarget
    const row = event.currentTarget
    if (entering instanceof Node && row instanceof Node && row.contains(entering)) return false
    return true
}
