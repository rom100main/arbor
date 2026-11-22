import { createEffect, createSignal, onCleanup } from "solid-js"

import type { CloseContainerConfirmation } from "../../shared/protocol"
import {
    chromeInsets,
    effectiveVisibilities,
    HISTORY_URL,
    SETTINGS_URL,
    SIDEBAR_COMPACT_WIDTH,
    SIDEBAR_WIDTH,
    TITLEBAR_HEIGHT,
    TOOLBAR_HEIGHT,
} from "../../shared/settings"
import { displayUrl } from "../../shared/url"
import { Button } from "../common/Button/Button"
import { requestTabTreeFocus } from "../common/store/focus"
import { useSettings } from "../common/store/settings"
import { initState, useSnapshot } from "../common/store/snapshot"
import { ConfirmCloseContainer } from "./ConfirmCloseContainer/ConfirmCloseContainer"
import { createReveal, REVEAL_MS, revealZones } from "./reveal"
import { Sidebar } from "./Sidebar"
import { DownloadButton } from "./toolbar/DownloadButton/DownloadButton"
import { FavoritesListButton } from "./toolbar/FavoritesList/FavoritesList"
import { NavButtons } from "./toolbar/NavButtons/NavButtons"
import { OmniboxInput } from "./toolbar/OmniboxInput/OmniboxInput"
import { PinnedActions } from "./toolbar/PinnedActions/PinnedActions"
import { UpdateButton } from "./toolbar/UpdateButton/UpdateButton"

import "./MainShell.css"

export const MainShell = () => {
    void initState()
    const snapshot = useSnapshot()
    const settings = useSettings()
    const activeTabId = () => snapshot()?.activeTabId ?? null
    const activeTabUrl = () => {
        const snap = snapshot()
        const url = snap?.tabs.find((t) => t.id === snap.activeTabId)?.url ?? ""
        return displayUrl(url)
    }

    // --- fullscreen: both bars are hidden, whatever the settings say

    const [fullscreen, setFullscreen] = createSignal(false)
    onCleanup(window.arbor.onFullscreen(setFullscreen))
    // Leaving fullscreen goes back through this accessor to the settings' values.
    const effective = () => effectiveVisibilities(settings(), fullscreen())

    // --- confirm closing a container

    const [confirmClose, setConfirmClose] = createSignal<CloseContainerConfirmation | null>(null)
    onCleanup(window.arbor.onConfirmCloseContainer(setConfirmClose))
    const confirmCloseContainer = (): void => {
        const request = confirmClose()
        setConfirmClose(null)
        if (request) void window.arbor.closeTab({ tabId: request.tabId, confirmed: true })
    }

    // --- revealing bars

    const zones = () =>
        revealZones(effective(), { width: window.innerWidth, height: window.innerHeight })
    const sidebar = createReveal(() => zones().sidebar)
    const toolbar = createReveal(() => zones().toolbar)
    const titlebar = createReveal(() => zones().titlebar)

    const onPointer = (event: MouseEvent): void => {
        const { clientX, clientY } = event
        sidebar.pointer(clientX, clientY)
        toolbar.pointer(clientX, clientY)
        titlebar.pointer(clientX, clientY)
    }
    const onLeave = (): void => {
        sidebar.leave()
        toolbar.leave()
        // No leave() for the title bar:
        // its keep zone overlaps the native window buttons,
        // so moving onto them fires mouseleave without actually leaving the title bar.
    }
    const onResize = (): void => {
        sidebar.sync()
        toolbar.sync()
        titlebar.sync()
    }
    document.addEventListener("mousemove", onPointer)
    document.documentElement.addEventListener("mouseleave", onLeave)
    window.addEventListener("resize", onResize)
    onCleanup(() => {
        document.removeEventListener("mousemove", onPointer)
        document.documentElement.removeEventListener("mouseleave", onLeave)
        window.removeEventListener("resize", onResize)
    })
    onCleanup(
        window.arbor.onShellEdge((edge) =>
            (edge === "left" ? sidebar : edge === "bottom" ? toolbar : titlebar).reveal(),
        ),
    )
    // The native window buttons (traffic lights / window controls) only follow the title bar.
    createEffect(
        () => titlebar.open(),
        (open) => window.arbor.titlebarReveal(open),
    )
    onCleanup(
        window.arbor.onFocusTabTree(() => {
            sidebar.reveal()
            requestTabTreeFocus()
        }),
    )
    // A toolbar popup hangs over the page: keep the bar it belongs to out until it closes.
    onCleanup(window.arbor.onToolbarPopup((open) => toolbar.setPinned(open)))

    createEffect(
        () => [effective().sidebarVisibility, effective().urlBarVisibility, fullscreen()] as const,
        () => {
            sidebar.sync()
            toolbar.sync()
        },
    )

    // Stay above the page while any bar is out, and until the last one has finished leaving.
    let raised = false
    let lowerTimer: ReturnType<typeof setTimeout> | undefined
    const setRaised = (next: boolean): void => {
        clearTimeout(lowerTimer)
        if (next === raised) return
        raised = next
        window.arbor.shellRaise(next)
    }
    onCleanup(() => clearTimeout(lowerTimer))
    createEffect(
        () => sidebar.open() || toolbar.open() || titlebar.open() || confirmClose() !== null,
        (anyOpen) => {
            if (anyOpen) {
                setRaised(true)
                return
            }
            clearTimeout(lowerTimer)
            lowerTimer = setTimeout(() => setRaised(false), REVEAL_MS)
        },
    )

    // While raised, the bare shell covers the page: a click there means "back to the page",
    // so give it back at once rather than after the closing animation.
    const onShellMouseDown = (event: MouseEvent): void => {
        if (event.target !== event.currentTarget) return
        if (confirmClose() !== null) {
            setConfirmClose(null)
            if (!sidebar.isOpen() && !toolbar.isOpen() && !titlebar.isOpen()) setRaised(false)
            return
        }
        sidebar.dismiss()
        toolbar.dismiss()
        titlebar.dismiss()
        if (!sidebar.isOpen() && !toolbar.isOpen() && !titlebar.isOpen()) setRaised(false)
    }

    // Typing in the URL bar keeps it out even once the pointer has left it.
    // Only the input counts: clicked buttons keep focus too, and would pin the bar open.
    const onToolbarFocusIn = (event: FocusEvent): void => {
        toolbar.setFocused(event.target instanceof HTMLInputElement)
    }
    const onToolbarFocusOut = (event: FocusEvent & { currentTarget: HTMLElement }): void => {
        const next = event.relatedTarget
        toolbar.setFocused(next instanceof HTMLInputElement && event.currentTarget.contains(next))
    }

    // --- toolbar actions

    let button: HTMLButtonElement | undefined

    const toggleExtensions = (): void => {
        if (!button) return
        const rect = button.getBoundingClientRect()
        window.arbor.extensionsToggle({ x: rect.x, y: rect.y, width: rect.width })
    }

    const openSettings = (): void => {
        const snap = snapshot()
        const existing = snap?.tabs.find((tab) => tab.url.startsWith(SETTINGS_URL))
        if (existing) {
            void window.arbor.selectTab({ tabId: existing.id })
            return
        }
        void window.arbor.createTab({ url: SETTINGS_URL })
    }

    const openHistory = (): void => {
        const snap = snapshot()
        const existing = snap?.tabs.find((tab) => tab.url.startsWith(HISTORY_URL))
        if (existing) {
            void window.arbor.selectTab({ tabId: existing.id })
            return
        }
        void window.arbor.createTab({ url: HISTORY_URL })
    }

    return (
        <div
            class="shell"
            style={{
                "--sidebar-width": `${SIDEBAR_WIDTH}px`,
                "--sidebar-compact-width": `${SIDEBAR_COMPACT_WIDTH}px`,
                "--toolbar-height": `${TOOLBAR_HEIGHT}px`,
                "--titlebar-height": `${TITLEBAR_HEIGHT}px`,
                "--toolbar-inset": `${chromeInsets(settings(), fullscreen()).bottom}px`,
                "--reveal-duration": `${REVEAL_MS}ms`,
            }}
            onMouseDown={onShellMouseDown}
        >
            <ConfirmCloseContainer
                request={confirmClose()}
                onConfirm={confirmCloseContainer}
                onCancel={() => setConfirmClose(null)}
            />
            <section
                aria-label="Title bar"
                class={{
                    titlebar: true,
                    stowed: !titlebar.open(),
                    floating: titlebar.open(),
                }}
            >
                Arbor
            </section>
            <Sidebar
                visibility={effective().sidebarVisibility}
                open={sidebar.open()}
                onFocusChange={sidebar.setFocused}
                onDismiss={sidebar.dismiss}
            />
            <section
                aria-label="URL bar"
                class={{
                    toolbar: true,
                    stowed: effective().urlBarVisibility === "hidden" && !toolbar.open(),
                    floating: effective().urlBarVisibility === "hidden" && toolbar.open(),
                }}
                onFocusIn={onToolbarFocusIn}
                onFocusOut={onToolbarFocusOut}
            >
                <NavButtons
                    tabId={activeTabId()}
                    navigation={snapshot()?.navigation ?? { canGoBack: false, canGoForward: false }}
                />
                <OmniboxInput tabId={activeTabId()} url={activeTabUrl()} />
                <PinnedActions />
                <UpdateButton />
                <div class="extensions">
                    <Button
                        icon="puzzle"
                        ariaLabel="Extensions"
                        ref={(el) => (button = el)}
                        onClick={toggleExtensions}
                    />
                    <DownloadButton />
                    <FavoritesListButton />
                    <Button icon="history" ariaLabel="History" onClick={openHistory} />
                    <Button icon="settings" ariaLabel="Settings" onClick={openSettings} />
                </div>
            </section>
        </div>
    )
}
