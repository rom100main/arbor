import type { ContainerMeta } from "../../../shared/protocol"
import { Icon } from "../../ui/Icon"
import { useSnapshot } from "../snapshot"
import {
    clearDragState,
    containerDropTarget,
    containerOrderDrop,
    containerOrderPosition,
    containerReorderIndex,
    getDraggedContainerId,
    getDraggedTabId,
    leftRow,
    setContainerDropTarget,
    setContainerOrderDrop,
    setDraggedContainerId,
} from "./dnd"

import "./ContainerChip.css"

export const ContainerChip = (props: { container: ContainerMeta; onRename: () => void }) => {
    const snapshot = useSnapshot()
    const active = () => snapshot()?.activeContainerId === props.container.id
    const orderDrop = () => containerOrderDrop()
    const orderClass = (position: "before" | "after"): boolean =>
        orderDrop()?.containerId === props.container.id && orderDrop()?.position === position
    return (
        <button
            class={{
                "container-chip": true,
                active: active(),
                "drop-target": containerDropTarget() === props.container.id,
                "drop-before": orderClass("before"),
                "drop-after": orderClass("after"),
            }}
            style={{
                color: active() ? "var(--color-accent-contrast)" : props.container.color,
                "background-color": active() ? props.container.color : undefined,
            }}
            type="button"
            title={props.container.name}
            aria-label={props.container.name}
            onClick={() => void window.arbor.switchContainer({ containerId: props.container.id })}
            onContextMenu={(event) => {
                event.preventDefault()
                props.onRename()
            }}
            draggable="true"
            onDragStart={(event) => {
                setDraggedContainerId(props.container.id)
                event.dataTransfer!.effectAllowed = "move"
                event.dataTransfer!.setData("text/plain", props.container.id)
            }}
            onDragOver={(event) => {
                const draggedContainer = getDraggedContainerId()
                if (draggedContainer) {
                    if (draggedContainer === props.container.id) return
                    const position = containerOrderPosition(event)
                    if (!position) return
                    event.preventDefault()
                    event.dataTransfer!.dropEffect = "move"
                    setContainerOrderDrop({ containerId: props.container.id, position })
                    return
                }
                if (!getDraggedTabId()) return
                const dragged = snapshot()?.tabs.find((t) => t.id === getDraggedTabId())
                if (!dragged || dragged.containerId === props.container.id) return
                event.preventDefault()
                event.dataTransfer!.dropEffect = "move"
                setContainerDropTarget((prev) =>
                    prev === props.container.id ? prev : props.container.id,
                )
            }}
            onDragLeave={(event) => {
                if (containerOrderDrop()?.containerId === props.container.id && leftRow(event)) {
                    setContainerOrderDrop(null)
                }
                if (containerDropTarget() !== props.container.id) return
                if (!leftRow(event)) return
                setContainerDropTarget(null)
            }}
            onDrop={(event) => {
                event.preventDefault()
                const draggedContainer = getDraggedContainerId()
                const snap = snapshot()
                if (draggedContainer && snap) {
                    const target = containerOrderDrop()
                    if (
                        draggedContainer !== props.container.id &&
                        target?.containerId === props.container.id
                    ) {
                        const toIndex = containerReorderIndex(
                            snap,
                            draggedContainer,
                            props.container.id,
                            target.position,
                        )
                        void window.arbor.reorderContainer({
                            containerId: draggedContainer,
                            toIndex,
                        })
                    }
                    clearDragState()
                    return
                }
                const dragId = getDraggedTabId()
                if (dragId)
                    void window.arbor.moveToContainer({
                        tabId: dragId,
                        containerId: props.container.id,
                    })
                clearDragState()
            }}
            onDragEnd={clearDragState}
        >
            <Icon name={props.container.icon} />
        </button>
    )
}
