import { For, Show, createEffect, createMemo, createSignal } from "solid-js"

import type { ContainerId, TabId } from "../../../shared/protocol"
import type { SidebarVisibility } from "../../../shared/settings"
import { childRow, neighborRow, parentRow } from "../../../shared/tree-display"
import { Icon } from "../../ui/Icon"
import { requestOmniboxFocus, useTabTreeFocus } from "../focus"
import { useContainerTabs, useSnapshot, useTreeMeta, type TreeMeta } from "../snapshot"
import { ContainerChip } from "./ContainerChip"
import { createSwipeTracker } from "./swipe"
import { TabRow } from "./TabRow"

import "./Sidebar.css"

export const Sidebar = (props: {
    visibility: SidebarVisibility
    open: boolean
    onFocusChange: (focused: boolean) => void
    onDismiss: () => void
}) => {
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
                void window.arbor.createContainer({})
                return
            }
            const target = snap.containers[index + direction]
            if (target) void window.arbor.switchContainer({ containerId: target.id })
        },
    })
    const onSwipeWheel = (event: WheelEvent): void => {
        if (!swipeTracker.handle(event.deltaX, event.deltaY)) return
        event.preventDefault()
    }

    let keyboardFocus = false
    const onFocusIn = (): void => {
        if (keyboardFocus) props.onFocusChange(true)
    }
    const onFocusOut = (event: FocusEvent & { currentTarget: HTMLElement }): void => {
        const next = event.relatedTarget
        if (next instanceof Node && event.currentTarget.contains(next)) return
        keyboardFocus = false
        props.onFocusChange(false)
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
            onFocusIn={onFocusIn}
            onFocusOut={onFocusOut}
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
                                                containerId: container.id,
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
                                onClick={() => void window.arbor.createContainer({})}
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
                                    focusRequest={useTabTreeFocus()()}
                                    onKeyboardFocus={() => (keyboardFocus = true)}
                                    onDismiss={props.onDismiss}
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
                        await window.arbor.createTab({})
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

const TabPage = (props: {
    containerId: ContainerId
    active: boolean
    treeMeta: TreeMeta
    focusRequest: number
    onKeyboardFocus: () => void
    onDismiss: () => void
}) => {
    const snapshot = useSnapshot()
    const tabs = useContainerTabs(props.containerId)
    const [focusedId, setFocusedId] = createSignal<TabId | null>(null)
    const [pendingFocus, setPendingFocus] = createSignal<TabId | null>(null)
    const rowElements = new Map<TabId, HTMLDivElement>()

    const focusRow = (tabId: TabId | null): void => {
        if (tabId === null) return
        const row = rowElements.get(tabId)
        if (!row) return
        props.onKeyboardFocus()
        setFocusedId(tabId)
        row.focus({ preventScroll: true })
        row.scrollIntoView({ block: "nearest" })
    }

    const registerRow = (tabId: TabId, el: HTMLDivElement | undefined): void => {
        if (el) rowElements.set(tabId, el)
        else rowElements.delete(tabId)
    }

    /** Focus the active tab, expanding collapsed ancestors so its row exists. */
    const focusActive = (): void => {
        const snap = snapshot()
        const activeId = snap?.activeTabId ?? null
        if (snap === null || activeId === null) return
        if (tabs().some((row) => row.id === activeId)) {
            focusRow(activeId)
            return
        }
        const byId = new Map(snap.tabs.map((tab) => [tab.id, tab]))
        const collapsedAncestors: TabId[] = []
        let current = byId.get(activeId)
        while (current?.parentId) {
            const parent = byId.get(current.parentId)
            if (!parent) break
            if (parent.collapsed) collapsedAncestors.push(parent.id)
            current = parent
        }
        if (collapsedAncestors.length === 0) return
        setPendingFocus(activeId)
        for (const ancestor of collapsedAncestors) {
            void window.arbor.setCollapsed({ tabId: ancestor, collapsed: false })
        }
    }

    // Cmd/Ctrl+0 focuses the active tab; all other pages ignore the request.
    let handledRequest = 0
    createEffect(
        () => props.focusRequest,
        (request) => {
            if (request === handledRequest) return
            handledRequest = request
            if (props.active) focusActive()
        },
    )

    // Forget rows that left the tree, and keep the keyboard on a live row after a close.
    createEffect(
        () => [tabs(), pendingFocus()] as const,
        ([rows, pending]) => {
            const visible = new Set(rows.map((row) => row.id))
            for (const id of rowElements.keys()) {
                if (!visible.has(id)) rowElements.delete(id)
            }
            if (pending !== null && visible.has(pending)) {
                setPendingFocus(null)
                focusRow(pending)
                return
            }
            const focused = focusedId()
            if (focused !== null && !visible.has(focused)) {
                focusActive()
                if (snapshot()?.activeTabId === null) setFocusedId(null)
            }
        },
    )

    const closeProtected = (): boolean => {
        const snap = snapshot()
        return snap !== null && snap.containers.length === 1 && snap.tabs.length === 1
    }

    const onKeyDown = (event: KeyboardEvent): void => {
        const focused = focusedId()
        if (focused === null || !props.active) return
        // Buttons in a row keep their own keyboard behavior.
        if (event.target instanceof HTMLElement && event.target.closest("button")) return

        const rows = tabs()
        const tab = rows.find((row) => row.id === focused)
        if (!tab) return
        const hasChildren = props.treeMeta.parentIds.has(focused)
        const collapsed = props.treeMeta.collapsedIds.has(focused)

        const grab = (target: TabId | null): void => {
            event.preventDefault()
            focusRow(target)
        }

        switch (event.key) {
            case "ArrowDown":
                grab(neighborRow(rows, focused, 1))
                return
            case "ArrowUp":
                grab(neighborRow(rows, focused, -1))
                return
            case "ArrowRight":
                if (hasChildren && collapsed) {
                    event.preventDefault()
                    void window.arbor.setCollapsed({ tabId: focused, collapsed: false })
                } else if (hasChildren) {
                    grab(childRow(rows, focused))
                }
                return
            case "ArrowLeft":
                if (hasChildren && !collapsed) {
                    event.preventDefault()
                    void window.arbor.setCollapsed({ tabId: focused, collapsed: true })
                } else {
                    grab(parentRow(rows, focused))
                }
                return
            case "Home":
                grab(rows[0]?.id ?? null)
                return
            case "End":
                grab(rows.at(-1)?.id ?? null)
                return
            case " ":
                event.preventDefault()
                if (!hasChildren) return
                void window.arbor.setCollapsed({ tabId: focused, collapsed: !collapsed })
                return
            case "Enter":
                event.preventDefault()
                void window.arbor.selectTab({ tabId: focused })
                return
            case "Delete":
            case "Backspace":
                event.preventDefault()
                if (!closeProtected()) void window.arbor.closeTab({ tabId: focused })
                return
            case "F2":
                event.preventDefault()
                window.arbor.openRenameModal({ kind: "tab", tabId: focused })
                return
            case "Escape":
                event.preventDefault()
                if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
                props.onDismiss()
                return
            default:
                return
        }
    }

    return (
        <div class="tab-page" inert={props.active ? undefined : true} onKeyDown={onKeyDown}>
            <For each={tabs()}>
                {(tab) => (
                    <TabRow
                        tab={tab}
                        hasChildren={props.treeMeta.parentIds.has(tab.id)}
                        collapsed={props.treeMeta.collapsedIds.has(tab.id)}
                        tabbable={
                            focusedId() === tab.id ||
                            (focusedId() === null && snapshot()?.activeTabId === tab.id)
                        }
                        registerRow={(el) => registerRow(tab.id, el)}
                        onFocus={() => setFocusedId(tab.id)}
                        onRename={() =>
                            window.arbor.openRenameModal({ kind: "tab", tabId: tab.id })
                        }
                    />
                )}
            </For>
        </div>
    )
}
