/**
 * The handler of every Arbor IPC channel, for one open window.
 * Every Arbor renderer lives in that window (shell, overlays, `arbor://` tabs),
 * so the channels are served from its scope and go away with it.
 */

import { Effect, Option } from "effect"

import { NoActionPopup } from "../../shared/errors"
import type { OmniboxActivation, RenameTarget, TabId } from "../../shared/protocol"
import { DEFAULT_SEARCH_TEMPLATE } from "../../shared/settings"
import { omniboxTarget } from "../../shared/url"
import type { DownloadsService } from "../downloads/downloads"
import type { ExtensionsService } from "../extension/extensions"
import type { PermissionPromptsService } from "../extension/prompts"
import type { HistoryService } from "../history/service"
import type { SettingsService } from "../settings"
import { snapshot, type DomainState } from "../state/state"
import type { StoreService } from "../state/store"
import type { UpdaterService } from "../update/updater"
import { sessionForContainer } from "../windows/electron-host"
import type { HistoryStep, ViewHandle, WindowHandle } from "../windows/host"
import type { Overlays } from "../windows/overlays"
import type { EventHandlers, IpcPushService, RequestHandlers } from "./router"

export interface WindowContext {
    readonly store: StoreService
    readonly settings: SettingsService
    readonly pushes: IpcPushService
    readonly prompts: PermissionPromptsService
    readonly extensions: ExtensionsService
    readonly updater: UpdaterService
    readonly downloads: DownloadsService
    readonly history: HistoryService
    readonly handle: WindowHandle
    readonly overlays: Overlays
    readonly viewOf: (tabId: TabId) => ViewHandle | undefined
    /** Record the tab's new URL and load it. Never waits for the page. */
    readonly navigate: (tabId: TabId, url: string) => Effect.Effect<void>
    /** Run from an Electron callback, for the life of the window. Failures are logged. */
    readonly background: (effect: Effect.Effect<unknown, unknown>) => void
}

const navHistory = (ctx: WindowContext, tabId: TabId, step: HistoryStep): Effect.Effect<void> => {
    const view = ctx.viewOf(tabId)
    return view ? ctx.handle.history(view, step) : Effect.void
}

/**
 * Middle click on Back/Forward:
 * open the entry it would visit as a child tab, in the background, so the current page stays put.
 */
const historyInBackground = (
    ctx: WindowContext,
    tabId: TabId,
    step: "back" | "forward",
): Effect.Effect<void> => {
    const view = ctx.viewOf(tabId)
    if (!view) return Effect.void
    const nav = view.webContents.navigationHistory
    if (step === "back" ? !nav.canGoBack() : !nav.canGoForward()) return Effect.void
    const entry = nav.getEntryAtIndex(nav.getActiveIndex() + (step === "back" ? -1 : 1))
    if (!entry) return Effect.void
    return Effect.ignore(ctx.store.createChildTab(tabId, entry.url, true))
}

export const windowRequests = (ctx: WindowContext): RequestHandlers<never> => {
    const { store, settings, overlays, extensions, downloads, history } = ctx
    return {
        getSnapshot: () => store.snapshot,
        getSettings: () => settings.get,
        setSettings: (patch) => settings.set(patch),

        extensionActionInfo: ({ extensionId }) => extensions.actionInfo(extensionId),
        openExtensionActionPopup: ({ extensionId, anchor }) =>
            Effect.gen(function* () {
                const { popupUrl } = yield* extensions.actionInfo(extensionId)
                if (!popupUrl) return yield* new NoActionPopup({ extensionId })
                const { activeContainerId } = yield* store.state
                // The popup runs where the extension does: preferably the active Container's session.
                const preferred = Option.map(
                    Option.fromNullishOr(activeContainerId),
                    sessionForContainer,
                )
                const session = yield* extensions.sessionFor(extensionId, preferred)
                return overlays.toggleActionPopup({
                    extensionId,
                    popupUrl,
                    anchor,
                    session,
                    onWindowOpen: (url) => ctx.background(store.createTab(url)),
                })
            }),

        createContainer: ({ name, color }) => store.createContainer(name, color),
        switchContainer: ({ containerId }) => store.switchContainer(containerId),
        renameContainer: ({ containerId, name }) => store.renameContainer(containerId, name),
        setContainerColor: ({ containerId, color }) => store.setContainerColor(containerId, color),
        setContainerIcon: ({ containerId, icon }) => store.setContainerIcon(containerId, icon),
        reorderContainer: ({ containerId, toIndex }) =>
            store.reorderContainer(containerId, toIndex),

        createTab: ({ url }) => store.createTab(url),
        selectTab: ({ tabId }) => store.selectTab(tabId),
        setCollapsed: ({ tabId, collapsed }) => store.setCollapsed(tabId, collapsed),
        closeTab: ({ tabId }) => store.closeTab(tabId),
        renameTab: ({ tabId, label }) => store.renameTab(tabId, label),
        moveTab: (move) => store.moveTab(move),
        moveToContainer: ({ tabId, containerId }) => store.moveToContainer(tabId, containerId),

        // Do nothing for a tab with no live view.
        goBack: ({ tabId, background }) =>
            background ? historyInBackground(ctx, tabId, "back") : navHistory(ctx, tabId, "back"),
        goForward: ({ tabId, background }) =>
            background
                ? historyInBackground(ctx, tabId, "forward")
                : navHistory(ctx, tabId, "forward"),
        reload: ({ tabId }) => navHistory(ctx, tabId, "reload"),

        downloadsList: () => downloads.snapshot,
        downloadCancel: ({ id }) => downloads.cancel(id),
        downloadRemove: ({ id }) => downloads.remove(id),
        downloadClear: () => downloads.clearSettled,
        downloadReveal: ({ id }) => downloads.reveal(id),
        downloadOpen: ({ id }) => downloads.open(id),
        downloadsOpenFolder: () => downloads.openFolder,

        historyList: (query) => history.list(query),
        historyRemove: ({ ids }) => history.remove(ids),
        historyClearBefore: ({ cutoff }) => history.clearBefore(cutoff),
        historyClearAfter: ({ cutoff }) => history.clearAfter(cutoff),
        historyClearAll: () => history.clearBefore(Number.MAX_SAFE_INTEGER),

        getUpdateStatus: () => ctx.updater.status,
        installUpdate: () => ctx.updater.install,
    }
}

/** Rename the container or tab as it is now, not as the renderer last saw it. */
const renameTarget = (
    state: DomainState,
    target: { kind: "container"; containerId: string } | { kind: "tab"; tabId: TabId },
): RenameTarget | null => {
    if (target.kind === "tab") {
        const tab = state.tabs.get(target.tabId)
        return tab ? { kind: "tab", tab } : null
    }
    const container = state.containers.find((c) => c.id === target.containerId)
    return container ? { kind: "container", container } : null
}

export const windowEvents = (ctx: WindowContext): EventHandlers<never> => {
    const { store, settings, pushes, overlays } = ctx
    /** What the address bar holds, also once the popup is hidden: Enter may come before the popup loads. */
    let lastQuery = ""

    const activateOmnibox = (payload: OmniboxActivation): Effect.Effect<void> =>
        Effect.gen(function* () {
            if (payload.kind === "tab") {
                yield* store.selectTab(payload.tabId).pipe(Effect.ignore)
            } else if (payload.kind === "history") {
                const entry = (yield* ctx.history.list({})).entries.find(
                    (e) => e.id === payload.entryId,
                )
                if (entry) {
                    const { activeTabId } = snapshot(yield* store.state)
                    if (activeTabId !== null) yield* ctx.navigate(activeTabId, entry.url)
                    else yield* store.createTab(entry.url).pipe(Effect.ignore)
                }
            } else if (payload.query.trim().length > 0) {
                const { activeTabId } = snapshot(yield* store.state)
                if (activeTabId !== null) {
                    const { searchTemplate } = yield* settings.get
                    const target = omniboxTarget(
                        payload.query,
                        searchTemplate || DEFAULT_SEARCH_TEMPLATE,
                    )
                    yield* ctx.navigate(activeTabId, target)
                }
            }
            overlays.hideOmnibox()
            yield* pushes.push("omniboxActivated")
        })

    return {
        omniboxUpdate: ({ query, rect }) =>
            Effect.sync(() => {
                lastQuery = query
                if (!rect || query.trim().length === 0) overlays.hideOmnibox()
                else overlays.showOmnibox(rect, query)
            }),
        omniboxSetPopupHeight: (height) => Effect.sync(() => overlays.setOmniboxHeight(height)),
        omniboxActivate: activateOmnibox,
        omniboxMoveSelection: (delta) => pushes.push("omniboxMoveSelection", delta),
        omniboxActivateSelected: () =>
            Effect.suspend(() => {
                if (overlays.omniboxOpen()) return pushes.push("omniboxActivateSelected")
                // Popup not loaded yet: fall back to the go/search action.
                const fallback = lastQuery.trim()
                return fallback.length > 0
                    ? activateOmnibox({ kind: "go", query: fallback })
                    : Effect.void
            }),
        // The rename modal renders in a transparent child window above the web view.
        openRenameModal: (target) =>
            Effect.gen(function* () {
                const current = renameTarget(yield* store.state, target)
                if (!current) return
                overlays.hideOmnibox()
                overlays.openRename(current)
            }),
        closeRenameModal: () => Effect.sync(() => overlays.closeRename()),
        extensionsToggle: (anchor) => Effect.sync(() => overlays.toggleExtensions(anchor)),
        extensionsClose: () => Effect.sync(() => overlays.closeExtensions()),
        extensionsSetPopupHeight: (height) =>
            Effect.sync(() => overlays.setExtensionsHeight(height)),
        downloadsToggle: (anchor) => Effect.sync(() => overlays.toggleDownloads(anchor)),
        downloadsClose: () => Effect.sync(() => overlays.closeDownloads()),
        downloadsSetPopupHeight: (height) => Effect.sync(() => overlays.setDownloadsHeight(height)),
        extensionsMenu: (request) => ctx.extensions.openMenu(request),
        permissionRespond: (allowed) => ctx.prompts.respond(allowed),
        shellRaise: (raised) => ctx.handle.raiseShell(raised),
    }
}
