import { For, createEffect } from "solid-js"

import { Icon } from "../../ui/Icon"
import { requestOmniboxFocus } from "../focus"
import { useActiveContainerTabs, useSnapshot } from "../snapshot"
import { ContainerChip } from "./ContainerChip"
import { createSwipeTracker } from "./swipe"
import { TabRow } from "./TabRow"

import "./Sidebar.css"

export const Sidebar = () => {
    const snapshot = useSnapshot()
    const activeTabs = useActiveContainerTabs()

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

    // Trackpad swipe (deltaX): fingers right → next container, left → previous.
    // One swipe moves exactly one container.
    // Swiping past the last container auto-creates one.
    const swipeTracker = createSwipeTracker({
        onSwipe: (direction) => {
            const snap = snapshot()
            if (!snap) return
            const index = snap.containers.findIndex((c) => c.id === snap.activeContainerId)
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
        <aside class="sidebar" onWheel={onSwipeWheel}>
            <div class="container-strip" ref={(el) => (strip = el)}>
                <div class="container-strip-inner">
                    <For each={snapshot()?.containers ?? []}>
                        {(container) => (
                            <ContainerChip
                                container={container}
                                onRename={() =>
                                    window.arbor.openRenameModal({ kind: "container", container })
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
            <div class="tab-tree">
                <For each={activeTabs()}>
                    {(tab) => (
                        <TabRow
                            tab={tab}
                            onRename={() => window.arbor.openRenameModal({ kind: "tab", tab })}
                        />
                    )}
                </For>
            </div>
            <button
                class="new-tab"
                type="button"
                onClick={async () => {
                    await window.arbor.createTab()
                    requestOmniboxFocus()
                }}
            >
                <Icon name="plus" size={14} />
                New tab
            </button>
        </aside>
    )
}
