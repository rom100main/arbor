import { Effect } from "effect"
import { BrowserWindow, ipcMain } from "electron"

import type {
    BrowserSnapshot,
    ExtensionMenuRequest,
    OmniboxActivation,
    RenameTarget,
    TabId,
} from "../../shared/protocol"
import { omniboxTarget } from "../../shared/url"
import { attachExtensionTab, openExtensionMenu } from "../extensions"
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
import { destroyView, ensureView, showTab, viewForTab } from "../windows/tab-views"

/** Mutable host runtime owned by index.ts start(). */
export interface HostRuntime {
    win: BrowserWindow | null
    store: StoreService | null
    latest: DomainState
    previousActiveTab: TabId | null
    lastOmniboxQuery: string
    rebuildMenu: () => void
}

/** State commit -> view sync + broadcast, extracted from index.ts onCommit. */
export const makeOnCommit =
    (rt: HostRuntime) =>
    (next: DomainState): void => {
        if (!rt.store) return
        const previous = rt.latest
        rt.latest = next

        for (const tabId of previous.tabs.keys()) {
            if (!next.tabs.has(tabId)) destroyView(tabId)
        }
        // Cross-container moves must reload under the target container's session.
        for (const [tabId, tab] of next.tabs) {
            const before = previous.tabs.get(tabId)
            if (before && before.containerId !== tab.containerId) destroyView(tabId)
        }

        const snapshot: BrowserSnapshot = toSnapshot(next)
        const activeTabId = snapshot.activeTabId
        if (activeTabId !== null && rt.win !== null) {
            const tab = next.tabs.get(activeTabId)
            if (tab && (activeTabId !== rt.previousActiveTab || !viewForTab(activeTabId))) {
                const view = ensureView(
                    { store: rt.store, getState: () => rt.latest },
                    tab.id,
                    tab.url,
                )
                showTab(rt.win, tab.id)
                attachExtensionTab(rt.win, view.webContents)
            }
            rt.previousActiveTab = activeTabId
        }

        // The popup window renders omnibox suggestions, so state goes to every window.
        for (const window of BrowserWindow.getAllWindows()) {
            window.webContents.send("arbor:state", snapshot)
        }
        rt.rebuildMenu()
    }

export const makeOmniboxActivator =
    (rt: HostRuntime) =>
    async (payload: OmniboxActivation): Promise<void> => {
        const { store } = rt
        if (payload.kind === "tab") {
            if (store)
                await Effect.runPromise(store.selectTab(payload.tabId)).catch(() => undefined)
        } else if (payload.query.trim().length > 0 && store) {
            const snapshot = toSnapshot(rt.latest)
            const tabId = snapshot.activeTabId
            if (tabId !== null) {
                const target = omniboxTarget(payload.query)
                const view = viewForTab(tabId)
                if (view) {
                    await Effect.runPromise(store.updateTabMeta(tabId, { url: target }))
                    void view.webContents.loadURL(target)
                }
            }
        }
        hideOmniboxPopup()
        rt.win?.webContents.send("arbor:omnibox:activated")
    }

/** Fire-and-forget overlay channels previously inline in index.ts. */
export const registerOverlayEvents = (
    rt: HostRuntime,
    handleOmniboxActivate: (payload: OmniboxActivation) => Promise<void>,
): void => {
    ipcMain.on(
        "arbor:omnibox:update",
        (
            _event,
            payload: { query: string; rect: { x: number; y: number; width: number } | null },
        ) => {
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
    ipcMain.on(
        "arbor:extensions:toggle",
        (_event, rect: { x: number; y: number; width: number }) => {
            if (rt.win) toggleExtensionsPopup(rt.win, rect)
        },
    )
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
}
