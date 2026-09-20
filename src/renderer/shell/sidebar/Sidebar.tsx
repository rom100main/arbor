import { For, createEffect } from "solid-js"

import { Icon } from "../../ui/Icon"
import { requestOmniboxFocus } from "../focus"
import { useActiveContainerTabs, useSnapshot } from "../snapshot"
import { ContainerChip } from "./ContainerChip"
import { TabRow } from "./TabRow"

import "./Sidebar.css"

const SWIPE_THRESHOLD = 48
const SWIPE_GESTURE_END_MS = 250

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
    // One continuous swipe moves exactly one container; the gesture resets after a pause.
    // Swiping past the last container auto-creates one.
    let swipeAccum = 0
    let swipeConsumed = false
    let lastSwipeTime = 0
    const onSwipeWheel = (event: WheelEvent) => {
        if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return
        event.preventDefault()
        const now = performance.now()
        if (now - lastSwipeTime > SWIPE_GESTURE_END_MS) {
            swipeAccum = 0
            swipeConsumed = false
        }
        lastSwipeTime = now
        if (swipeConsumed) return
        swipeAccum += event.deltaX
        if (Math.abs(swipeAccum) < SWIPE_THRESHOLD) return
        const goNext = swipeAccum > 0
        swipeAccum = 0
        swipeConsumed = true

        const snap = snapshot()
        if (!snap) return
        const index = snap.containers.findIndex((c) => c.id === snap.activeContainerId)
        if (index === -1) return
        if (goNext && index === snap.containers.length - 1) {
            void window.arbor.createContainer()
            return
        }
        const target = snap.containers[index + (goNext ? 1 : -1)]
        if (target) void window.arbor.switchContainer(target.id)
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
