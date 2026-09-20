import type { ContainerMeta } from "../../../shared/protocol"
import { Icon } from "../../ui/Icon"
import { useSnapshot } from "../snapshot"
import {
    clearDragState,
    containerDropTarget,
    getDraggedTabId,
    leftRow,
    setContainerDropTarget,
} from "./dnd"

export const ContainerChip = (props: { container: ContainerMeta; onRename: () => void }) => {
    const snapshot = useSnapshot()
    const active = () => snapshot()?.activeContainerId === props.container.id
    return (
        <button
            class={{
                "container-chip": true,
                active: active(),
                "drop-target": containerDropTarget() === props.container.id,
            }}
            style={{
                color: active() ? "#ffffff" : props.container.color,
                "background-color": active() ? props.container.color : undefined,
            }}
            type="button"
            title={props.container.name}
            aria-label={props.container.name}
            onClick={() => void window.arbor.switchContainer(props.container.id)}
            onContextMenu={(event) => {
                event.preventDefault()
                props.onRename()
            }}
            onDragOver={(event) => {
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
                if (containerDropTarget() !== props.container.id) return
                if (!leftRow(event)) return
                setContainerDropTarget(null)
            }}
            onDrop={(event) => {
                event.preventDefault()
                const dragId = getDraggedTabId()
                if (dragId) void window.arbor.moveToContainer(dragId, props.container.id)
                clearDragState()
            }}
        >
            <Icon name={props.container.icon} />
        </button>
    )
}
