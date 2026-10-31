import { Effect, Stream } from "effect"
import type { BrowserWindow } from "electron"

import type {
    BrowserSnapshot,
    ContainerId,
    OmniboxActivation,
    RenameTarget,
    TabId,
} from "../../shared/protocol"
import { DEFAULT_SEARCH_TEMPLATE, type Settings } from "../../shared/settings"
import { omniboxTarget } from "../../shared/url"
import { runBackground } from "../exec"
import { attachExtensionTab, openExtensionMenu } from "../extension/loader"
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
import { setShellRaised } from "../windows/shell-view"
import {
    destroyView,
    ensureView,
    navigateTab,
    sessionMismatch,
    showTab,
    viewForTab,
} from "../windows/tab-views"
import type { EventHandlers, IpcPushService, Pusher } from "./router"

/** Mutable host runtime owned by index.ts boot. */
export interface HostRuntime {
    win: BrowserWindow | null
    store: StoreService
    settings: SettingsService
    readonly ipc: Pusher
    readonly getState: () => DomainState
    readonly getSettings: () => Settings
    previousActiveTab: TabId | null
    lastOmniboxQuery: string
    rebuildMenu: () => void
}

/** Every settings change goes to every renderer, the first emission is what they already have. */
export const broadcastSettings = (
    settings: SettingsService,
    pushes: IpcPushService,
): Effect.Effect<void> =>
    settings.changes.pipe(
        Stream.drop(1),
        Stream.runForEach((next) => pushes.push("settings", next)),
    )

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
                const view = ensureView(rt, tab.id, tab.url)
                showTab(rt.win, tab.id)
                attachExtensionTab(rt.win, view.webContents)
            }
            rt.previousActiveTab = activeTabId
        }

        rt.ipc.push("state", snapshot)
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
                await navigateTab(rt, tabId, target)
            }
        }
        hideOmniboxPopup()
        rt.ipc.push("omniboxActivated")
    }

/** Rename the container or tab as it is now, not as the renderer last saw it. */
const renameTarget = (
    state: DomainState,
    target: { kind: "container"; containerId: ContainerId } | { kind: "tab"; tabId: TabId },
): RenameTarget | null => {
    if (target.kind === "tab") {
        const tab = state.tabs.get(target.tabId)
        return tab ? { kind: "tab", tab } : null
    }
    const container = state.containers.find((c) => c.id === target.containerId)
    return container ? { kind: "container", container } : null
}

export const eventHandlers = (
    rt: HostRuntime,
    activateOmnibox: (payload: OmniboxActivation) => Promise<void>,
): EventHandlers<never> => ({
    omniboxUpdate: ({ query, rect }) =>
        Effect.sync(() => {
            rt.lastOmniboxQuery = query
            if (!rt.win) return
            if (!rect || query.trim().length === 0) {
                hideOmniboxPopup()
                return
            }
            showOmniboxPopup(rt.win, rect, query, rt.ipc)
        }),
    omniboxSetPopupHeight: (height) =>
        Effect.sync(() => {
            if (rt.win) setOmniboxPopupHeight(rt.win, height)
        }),
    omniboxActivate: (payload) => Effect.promise(() => activateOmnibox(payload)),
    omniboxMoveSelection: (delta) => Effect.sync(() => rt.ipc.push("omniboxMoveSelection", delta)),
    omniboxActivateSelected: () =>
        Effect.promise(async () => {
            if (popupWebContents()) {
                rt.ipc.push("omniboxActivateSelected")
                return
            }
            // Popup not loaded yet: fall back to the go/search action.
            const fallback = rt.lastOmniboxQuery.trim()
            if (fallback.length > 0) await activateOmnibox({ kind: "go", query: fallback })
        }),
    // The rename modal renders in a transparent child window above the web view.
    openRenameModal: (target) =>
        Effect.sync(() => {
            const win = rt.win
            const current = renameTarget(rt.getState(), target)
            if (!win || !current) return
            hideOmniboxPopup()
            openRenameModal(win, current, rt.ipc)
        }),
    closeRenameModal: () => Effect.sync(() => closeRenameModal()),
    extensionsToggle: (anchor) =>
        Effect.sync(() => {
            if (rt.win) toggleExtensionsPopup(rt.win, anchor, rt.ipc)
        }),
    extensionsClose: () => Effect.sync(() => hideExtensionsPopup()),
    extensionsSetPopupHeight: (height) =>
        Effect.sync(() => {
            if (rt.win) setExtensionsPopupHeight(rt.win, height)
        }),
    extensionsMenu: (request) => Effect.promise(() => openExtensionMenu(request)),
    permissionRespond: (allowed) => Effect.sync(() => respondPermissionPrompt(allowed)),
    shellRaise: (raised) => Effect.sync(() => setShellRaised(raised)),
})
