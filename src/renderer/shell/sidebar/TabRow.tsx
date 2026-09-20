import { Show } from "solid-js"

import type { DisplayTab } from "../../../shared/protocol"
import { Favicon } from "../../ui/Favicon"
import { Icon } from "../../ui/Icon"
import { useSnapshot } from "../snapshot"
import {
    clearDragState,
    dropPosition,
    getDraggedTabId,
    isDescendantOf,
    leftRow,
    setDraggedTabId,
    setTabDrop,
    siblingIndex,
    tabDropTarget,
    type DropPosition,
} from "./dnd"

export const TabRow = (props: { tab: DisplayTab; onRename: () => void }) => {
    const snapshot = useSnapshot()
    const hasChildren = () => snapshot()!.tabs.some((t) => t.parentId === props.tab.id)
    // The DisplayTab item is reused across commits (stable <For> identity),
    // so `collapsed` must be read from the live snapshot to stay reactive.
    const collapsed = () =>
        snapshot()?.tabs.find((t) => t.id === props.tab.id)?.collapsed ?? props.tab.collapsed
    const label = () => props.tab.userLabel || props.tab.title || props.tab.url
    // The last tab of the last container cannot be closed (domain guard).
    const closeProtected = () => {
        const snap = snapshot()
        return snap !== null && snap.containers.length === 1 && snap.tabs.length === 1
    }
    const drop = () => tabDropTarget()
    const dropClass = (position: DropPosition): boolean =>
        drop()?.tabId === props.tab.id && drop()?.position === position

    return (
        <div
            class={{
                "tab-row": true,
                active: snapshot()?.activeTabId === props.tab.id,
                "drop-before": dropClass("before"),
                "drop-after": dropClass("after"),
                "drop-child": dropClass("child"),
            }}
            style={{ "padding-left": `${6 + props.tab.depth * 14}px` }}
            draggable="true"
            onClick={() => void window.arbor.selectTab(props.tab.id)}
            onContextMenu={(event) => {
                event.preventDefault()
                props.onRename()
            }}
            onDragStart={(event) => {
                setDraggedTabId(props.tab.id)
                event.dataTransfer!.effectAllowed = "move"
                event.dataTransfer!.setData("text/plain", props.tab.url)
            }}
            onDragOver={(event) => {
                const dragId = getDraggedTabId()
                if (!dragId || dragId === props.tab.id) return
                const position = dropPosition(event)
                if (!position) return
                const snap = snapshot()
                if (!snap) return
                if (position === "child" && isDescendantOf(snap, props.tab.id, dragId)) return
                event.preventDefault()
                event.dataTransfer!.dropEffect = "move"
                setTabDrop({ tabId: props.tab.id, position })
            }}
            onDragLeave={(event) => {
                if (drop()?.tabId !== props.tab.id) return
                if (!leftRow(event)) return
                setTabDrop(null)
            }}
            onDrop={(event) => {
                event.preventDefault()
                const target = drop()
                const dragId = getDraggedTabId()
                const snap = snapshot()
                if (!target || !dragId || !snap) return
                if (target.position === "child") {
                    void window.arbor.moveTab({ tabId: dragId, parentId: props.tab.id, index: 0 })
                } else {
                    void window.arbor.moveTab({
                        tabId: dragId,
                        parentId: props.tab.parentId,
                        index: siblingIndex(snap, dragId, props.tab.id, target.position),
                    })
                }
                clearDragState()
            }}
            onDragEnd={clearDragState}
        >
            <div class={{ "row-leading": true, "has-children": hasChildren() }}>
                <Favicon url={props.tab.favicon} />
                <Show when={hasChildren()}>
                    <button
                        class="chevron overlay"
                        type="button"
                        aria-label={collapsed() ? "Expand" : "Collapse"}
                        onClick={(event) => {
                            event.stopPropagation()
                            void window.arbor.setCollapsed(props.tab.id, !collapsed())
                        }}
                    >
                        <Icon name={collapsed() ? "chevron-right" : "chevron-down"} size={12} />
                    </button>
                </Show>
            </div>
            <span class="tab-title">{label()}</span>{" "}
            <Show when={!closeProtected()}>
                <button
                    class="tab-close"
                    type="button"
                    aria-label="Close tab"
                    onClick={(event) => {
                        event.stopPropagation()
                        void window.arbor.closeTab(props.tab.id)
                    }}
                >
                    <Icon name="x" size={12} />
                </button>
            </Show>
        </div>
    )
}
