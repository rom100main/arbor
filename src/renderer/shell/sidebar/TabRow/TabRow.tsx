import { Show } from "solid-js"

import type { DisplayTab } from "../../../../shared/protocol"
import { displayTabLabel } from "../../../../shared/url"
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
} from "../../../common/dnd"
import { Favicon } from "../../../common/Favicon/Favicon"
import { Icon } from "../../../common/Icon/Icon"
import { useSnapshot } from "../../../common/store/snapshot"
import { TreeRow } from "../../../common/TreeRow/TreeRow"

import "./TabRow.css"

export const TabRow = (props: {
    tab: DisplayTab
    hasChildren: boolean
    collapsed: boolean
    tabbable: boolean
    registerRow: (el: HTMLDivElement | undefined) => void
    onFocus: () => void
}) => {
    const snapshot = useSnapshot()
    const label = () => displayTabLabel(props.tab)
    // The last tab of the last container cannot be closed (domain guard).
    const closeProtected = () => {
        const snap = snapshot()
        return snap !== null && snap.containers.length === 1 && snap.tabs.length === 1
    }
    const close = (): void => {
        if (closeProtected()) return
        void window.arbor.closeTab({ tabId: props.tab.id })
    }
    const drop = () => tabDropTarget()

    return (
        <TreeRow
            class={{ "tab-row": true, unloaded: props.tab.hibernated }}
            depth={props.tab.depth}
            active={snapshot()?.activeTabId === props.tab.id}
            drop={drop()?.tabId === props.tab.id ? (drop()?.position ?? null) : null}
            tabbable={props.tabbable}
            ref={(el) => props.registerRow(el)}
            draggable
            onClick={() => void window.arbor.selectTab({ tabId: props.tab.id })}
            onAuxClick={(event) => {
                // Middle click ("wheel click") closes the tab.
                if (event.button !== 1) return
                event.preventDefault()
                event.stopPropagation()
                close()
            }}
            onFocus={props.onFocus}
            onContextMenu={(event) => {
                event.preventDefault()
                window.arbor.tabMenu({
                    tabId: props.tab.id,
                    x: event.clientX,
                    y: event.clientY,
                })
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
            <div class={{ "row-leading": true, "has-children": props.hasChildren }}>
                <Favicon url={props.tab.favicon} grayscale={props.tab.hibernated} />
                <Show when={props.hasChildren}>
                    <button
                        class="chevron overlay"
                        type="button"
                        aria-label={props.collapsed ? "Expand" : "Collapse"}
                        onClick={(event) => {
                            event.stopPropagation()
                            void window.arbor.setCollapsed({
                                tabId: props.tab.id,
                                collapsed: !props.collapsed,
                            })
                        }}
                    >
                        <Icon name={props.collapsed ? "chevron-right" : "chevron-down"} size={12} />
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
                        close()
                    }}
                >
                    <Icon name="x" size={12} />
                </button>
            </Show>
        </TreeRow>
    )
}
