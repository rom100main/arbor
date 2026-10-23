import { For, Show, createEffect, createMemo, createSignal } from "solid-js"

import type { ContainerId } from "../../../shared/protocol"
import type { SidebarVisibility } from "../../../shared/settings"
import { Icon } from "../../ui/Icon"
import { requestOmniboxFocus } from "../focus"
import { useContainerTabs, useSnapshot, useTreeMeta, type TreeMeta } from "../snapshot"
import { ContainerChip } from "./ContainerChip"
import { createSwipeTracker } from "./swipe"
import { TabRow } from "./TabRow"

import "./Sidebar.css"

export const Sidebar = (props: { visibility: SidebarVisibility; open: boolean }) => {
    const snapshot = useSnapshot()
    const treeMeta = useTreeMeta()
    const containerIds = createMemo(() => snapshot()?.containers.map((c) => c.id) ?? [])
    const activeIndex = createMemo(() => {
        const snap = snapshot()
        return snap ? snap.containers.findIndex((c) => c.id === snap.activeContainerId) : -1
    })
    const activeContainer = () => {
        const snap = snapshot()
        return snap?.containers.find((c) => c.id === snap.activeContainerId) ?? null
    }
    const collapsed = () => props.visibility === "compact" && !props.open

    let strip: HTMLDivElement | undefined

    // Keep the active container chip centered when the strip overflows.
    createEffect(
        () => snapshot()?.activeContainerId ?? null,
        (id) => {
            if (id === null || !strip) return
            const chip = strip.querySelector<HTMLButtonElement>(".container-chip.active")
            if (!chip) return
            strip.scrollTo({
                left: chip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2,
                behavior: "smooth",
            })
        },
    )

    // --- pages: one tab tree per container, side by side, slid like a phone's home screens

    // Slide only once the first page is in place, so startup does not sweep across every container.
    const [animated, setAnimated] = createSignal(false)
    createEffect(activeIndex, (index) => {
        if (index < 0 || animated()) return
        requestAnimationFrame(() => requestAnimationFrame(() => setAnimated(true)))
    })

    // Trackpad swipe (deltaX): fingers right → next container, left → previous.
    // One swipe moves exactly one container.
    // Swiping past the last container auto-creates one.
    const swipeTracker = createSwipeTracker({
        onSwipe: (direction) => {
            const snap = snapshot()
            if (!snap) return
            const index = activeIndex()
            if (index === -1) return
            if (direction === 1 && index === snap.containers.length - 1) {
                void window.arbor.createContainer()
                return
            }
            const target = snap.containers[index + direction]
            if (target) void window.arbor.switchContainer(target.id)
        },
    })
    const onSwipeWheel = (event: WheelEvent): void => {
        if (!swipeTracker.handle(event.deltaX, event.deltaY)) return
        event.preventDefault()
    }

    return (
        <aside
            class={{
                sidebar: true,
                collapsed: collapsed(),
                stowed: props.visibility === "hidden" && !props.open,
                floating: props.visibility !== "displayed" && props.open,
            }}
            onWheel={onSwipeWheel}
        >
            <div class="sidebar-inner">
                <div class="sidebar-header">
                    <div class="container-strip" ref={(el) => (strip = el)}>
                        <div class="container-strip-inner">
                            <For each={snapshot()?.containers ?? []}>
                                {(container) => (
                                    <ContainerChip
                                        container={container}
                                        onRename={() =>
                                            window.arbor.openRenameModal({
                                                kind: "container",
                                                container,
                                            })
                                        }
                                    />
                                )}
                            </For>
                            <button
                                class="container-chip add"
                                type="button"
                                aria-label="New container"
                                title="New container"
                                onClick={() => void window.arbor.createContainer()}
                            >
                                <Icon name="plus" />
                            </button>
                        </div>
                    </div>
                    {/* Compact strip: the open container alone, standing in for the whole strip. */}
                    <Show when={activeContainer()}>
                        {(container) => (
                            <span
                                class="container-chip compact-container"
                                aria-hidden="true"
                                style={{
                                    color: "var(--color-accent-contrast)",
                                    "background-color": container().color,
                                }}
                            >
                                <Icon name={container().icon} />
                            </span>
                        )}
                    </Show>
                </div>
                <div class="tab-pager">
                    <div
                        class={{ "tab-track": true, animated: animated() }}
                        style={{ transform: `translateX(${-Math.max(0, activeIndex()) * 100}%)` }}
                    >
                        <For each={containerIds()}>
                            {(containerId) => (
                                <TabPage
                                    containerId={containerId}
                                    active={snapshot()?.activeContainerId === containerId}
                                    treeMeta={treeMeta()}
                                />
                            )}
                        </For>
                    </div>
                </div>
                <button
                    class="new-tab"
                    type="button"
                    aria-label="New tab"
                    onClick={async () => {
                        await window.arbor.createTab()
                        requestOmniboxFocus()
                    }}
                >
                    <Icon name="plus" size={14} />
                    <span class="new-tab-label">New tab</span>
                </button>
            </div>
        </aside>
    )
}

const TabPage = (props: { containerId: ContainerId; active: boolean; treeMeta: TreeMeta }) => {
    const tabs = useContainerTabs(props.containerId)
    return (
        <div class="tab-page" inert={props.active ? undefined : true}>
            <For each={tabs()}>
                {(tab) => (
                    <TabRow
                        tab={tab}
                        hasChildren={props.treeMeta.parentIds.has(tab.id)}
                        collapsed={props.treeMeta.collapsedIds.has(tab.id)}
                        onRename={() => window.arbor.openRenameModal({ kind: "tab", tab })}
                    />
                )}
            </For>
        </div>
    )
}
