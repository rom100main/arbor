import { Effect, Stream } from "effect"
import { BrowserWindow, ipcMain } from "electron"

import type {
    Anchor,
    BrowserSnapshot,
    ExtensionMenuRequest,
    OmniboxActivation,
    RenameTarget,
    TabId,
} from "../../shared/protocol"
import { DEFAULT_SEARCH_TEMPLATE, type Settings } from "../../shared/settings"
import { omniboxTarget } from "../../shared/url"
import { runBackground } from "../exec"
import { attachExtensionTab, openExtensionMenu } from "../extension/loader"
import { AppRuntime } from "../runtime"
import type { SettingsService } from "../settings"
import { snapshot as toSnapshot, type DomainState } from "../state/state"
import type { StoreService } from "../state/store"
import {
    closeRenameModal,
    hideExtensionsPopup,
    hideOmniboxPopup,
    openRenameModal,
    popupWebContents,
    respondPermissionPrompt,
    setExtensionsPopupHeight,
    setOmniboxPopupHeight,
    showOmniboxPopup,
    toggleExtensionsPopup,
} from "../windows/overlays"
import { setShellRaised, shellWebContents } from "../windows/shell-view"
import {
    destroyView,
    ensureView,
    internalViewWebContents,
    navigateTab,
    sessionMismatch,
    showTab,
    viewForTab,
} from "../windows/tab-views"

/** Mutable host runtime owned by index.ts boot. */
export interface HostRuntime {
    win: BrowserWindow | null
    store: StoreService
    settings: SettingsService
    readonly getState: () => DomainState
    readonly getSettings: () => Settings
    previousActiveTab: TabId | null
    lastOmniboxQuery: string
    rebuildMenu: () => void
}

/** Every settings change goes to every renderer, the first emission is what they already have. */
export const registerSettingsBroadcast = (settings: SettingsService): void => {
    AppRuntime.runFork(
        settings.changes.pipe(
            Stream.drop(1),
            Stream.runForEach((next) =>
                Effect.sync(() => {
                    for (const window of BrowserWindow.getAllWindows()) {
                        window.webContents.send("arbor:settings:changed", next)
                    }
                    shellWebContents()?.send("arbor:settings:changed", next)
                    for (const wc of internalViewWebContents()) {
                        wc.send("arbor:settings:changed", next)
                    }
                }).pipe(
                    Effect.catchCause((cause) =>
                        Effect.logError("Settings broadcast failed", cause),
                    ),
                ),
            ),
        ),
    )
}

export const makeWindowSync = (rt: HostRuntime): ((next: DomainState) => void) => {
    let previous: DomainState | null = null
    return (next) => {
        const before = previous ?? next
        previous = next

        for (const tabId of before.tabs.keys()) {
            if (!next.tabs.has(tabId)) destroyView(tabId)
        }
        // Cross-container moves must reload under the target container's session,
        // and so must a tab that navigated to or from an arbor:// internal page.
        for (const [tabId, tab] of next.tabs) {
            const was = before.tabs.get(tabId)
            if (was && was.containerId !== tab.containerId) destroyView(tabId)
            else if (sessionMismatch(tabId, tab.containerId, tab.url)) destroyView(tabId)
        }

        const snapshot: BrowserSnapshot = toSnapshot(next)
        const activeTabId = snapshot.activeTabId
        if (activeTabId !== null && rt.win !== null) {
            const tab = next.tabs.get(activeTabId)
            if (tab && (activeTabId !== rt.previousActiveTab || !viewForTab(activeTabId))) {
                const view = ensureView({ store: rt.store, getState: rt.getState }, tab.id, tab.url)
                showTab(rt.win, tab.id)
                attachExtensionTab(rt.win, view.webContents)
            }
            rt.previousActiveTab = activeTabId
        }

        // The popup window renders omnibox suggestions, so state goes to every window.
        for (const window of BrowserWindow.getAllWindows()) {
            window.webContents.send("arbor:state", snapshot)
        }
        shellWebContents()?.send("arbor:state", snapshot)
    }
}

export const makeOmniboxActivator =
    (rt: HostRuntime) =>
    async (payload: OmniboxActivation): Promise<void> => {
        const { store } = rt
        if (payload.kind === "tab") {
            void runBackground(store.selectTab(payload.tabId))
        } else if (payload.query.trim().length > 0) {
            const snapshot = toSnapshot(rt.getState())
            const tabId = snapshot.activeTabId
            if (tabId !== null && viewForTab(tabId)) {
                const target = omniboxTarget(
                    payload.query,
                    rt.getSettings().searchTemplate ?? DEFAULT_SEARCH_TEMPLATE,
                )
                await navigateTab({ store, getState: rt.getState }, tabId, target)
            }
        }
        hideOmniboxPopup()
        shellWebContents()?.send("arbor:omnibox:activated")
    }

/** Fire-and-forget overlay channels previously inline in index.ts. */
export const registerOverlayEvents = (
    rt: HostRuntime,
    handleOmniboxActivate: (payload: OmniboxActivation) => Promise<void>,
): void => {
    ipcMain.on(
        "arbor:omnibox:update",
        (_event, payload: { query: string; rect: Anchor | null }) => {
            rt.lastOmniboxQuery = payload.query
            if (!rt.win) return
            if (!payload.rect || payload.query.trim().length === 0) {
                hideOmniboxPopup()
                return
            }
            showOmniboxPopup(rt.win, payload.rect, payload.query)
        },
    )
    ipcMain.on("arbor:omnibox:move-selection", (_event, delta: number) => {
        popupWebContents()?.send("arbor:omnibox:move-selection", delta)
    })
    ipcMain.on("arbor:omnibox:activate-selected", () => {
        const webContents = popupWebContents()
        if (webContents) {
            webContents.send("arbor:omnibox:activate-selected")
            return
        }
        // Popup not loaded yet: fall back to the go/search action.
        const fallback = rt.lastOmniboxQuery.trim()
        if (fallback.length > 0) void handleOmniboxActivate({ kind: "go", query: fallback })
    })
    ipcMain.on("arbor:omnibox:popup-height", (_event, height: number) => {
        if (rt.win) setOmniboxPopupHeight(rt.win, height)
    })
    ipcMain.on("arbor:omnibox:activate", (_event, payload: OmniboxActivation) => {
        void handleOmniboxActivate(payload)
    })
    // The rename modal renders in a transparent child window above the web view.
    ipcMain.on("arbor:rename-modal:open", (_event, target: RenameTarget) => {
        if (!rt.win) return
        hideOmniboxPopup()
        openRenameModal(rt.win, target)
    })
    ipcMain.on("arbor:rename-modal:close", () => closeRenameModal())
    ipcMain.on("arbor:extensions:toggle", (_event, rect: Anchor) => {
        if (rt.win) toggleExtensionsPopup(rt.win, rect)
    })
    ipcMain.on("arbor:extensions:close", () => hideExtensionsPopup())
    ipcMain.on("arbor:extensions:popup-height", (_event, height: number) => {
        if (rt.win) setExtensionsPopupHeight(rt.win, height)
    })
    ipcMain.on("arbor:extensions:menu", (_event, payload: ExtensionMenuRequest) => {
        void openExtensionMenu(payload)
    })
    ipcMain.on("arbor:permission:respond", (_event, allowed: boolean) => {
        respondPermissionPrompt(allowed)
    })
    // A revealed bar floats over the page, so the shell rises above it for as long as one is out.
    ipcMain.on("arbor:shell:raise", (_event, raised: boolean) => {
        setShellRaised(raised)
    })
}
