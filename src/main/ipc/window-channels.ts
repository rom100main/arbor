/**
 * The handler of every Arbor IPC channel, for one open window.
 * Every Arbor renderer lives in that window (shell, overlays, `arbor://` tabs),
 * so the channels are served from its scope and go away with it.
 */

import { Effect, Option } from "effect"
import { Menu } from "electron"

import { DefaultBrowserFailed, NoActionPopup } from "../../shared/errors"
import type { FindStatus, OmniboxActivation, RenameTarget, TabId } from "../../shared/protocol"
import { DEFAULT_SEARCH_TEMPLATE } from "../../shared/settings"
import { omniboxTarget } from "../../shared/url"
import { getDefaultBrowserStatus, setDefaultBrowser } from "../default-browser"
import type { DownloadsService } from "../downloads/downloads"
import type { ExtensionsService } from "../extension/extensions"
import type { PermissionPromptsService } from "../extension/prompts"
import type { FavoritesService } from "../favorites/service"
import type { HistoryService } from "../history/service"
import type { SettingsService } from "../settings"
import { closeEmptiesContainer } from "../state/close-reopen"
import { snapshot, type DomainState } from "../state/state"
import type { StoreService } from "../state/store"
import type { UpdaterService } from "../update/updater"
import { sessionForContainer } from "../windows/electron-host"
import { runFindClear, runFindSearch, runFindStep } from "../windows/find-in-page"
import {
    navAvailability,
    type HistoryStep,
    type ViewHandle,
    type WindowHandle,
} from "../windows/host"
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
    readonly favorites: FavoritesService
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

/** The active tab's view, if it has one. */
const activeView = (ctx: WindowContext): Effect.Effect<ViewHandle | undefined> =>
    Effect.map(ctx.store.state, (state) => {
        const { activeTabId } = snapshot(state)
        return activeTabId !== null ? ctx.viewOf(activeTabId) : undefined
    })

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
    const { store, settings, overlays, extensions, downloads, history, favorites, pushes } = ctx
    // The active match over all frames: stepping needs the current position, not a fresh search.
    const lastFindStatus: { current: FindStatus } = {
        current: { total: 0, activeIndex: -1, error: null },
    }

    // Closing a container's last tab asks first:
    // the shell shows the confirmation popup, and only its `confirmed` close reaches the store.
    const closeTab = (tabId: TabId, confirmed?: boolean) =>
        Effect.gen(function* () {
            if (confirmed !== true) {
                const state = yield* store.state
                if (closeEmptiesContainer(state, tabId)) {
                    const tab = state.tabs.get(tabId)
                    if (tab) {
                        const container = state.containers.find((c) => c.id === tab.containerId)
                        yield* pushes.push("confirmCloseContainer", {
                            tabId,
                            containerId: tab.containerId,
                            containerName: container?.name ?? "",
                        })
                        return
                    }
                }
            }
            yield* store.closeTab(tabId)
        })
    return {
        // The store's snapshot cannot see live pages: enrich it with the active tab's history,
        // so a shell loading late still greys Back/Forward correctly.
        getSnapshot: () =>
            Effect.gen(function* () {
                const state = yield* store.state
                const snap = snapshot(state)
                return snapshot(
                    state,
                    navAvailability(
                        snap.activeTabId !== null ? ctx.viewOf(snap.activeTabId) : undefined,
                    ),
                )
            }),
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
        closeTab: ({ tabId, confirmed }) => closeTab(tabId, confirmed),
        renameTab: ({ tabId, label }) => store.renameTab(tabId, label),
        hibernateTab: ({ tabId }) => store.hibernateTab(tabId),
        hibernateContainer: ({ containerId }) => store.hibernateContainer(containerId),
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
        extensionsOpenDevFolder: () => ctx.extensions.openDevExtensionsFolder,

        historyList: (query) => history.list(query),
        historyRemove: ({ ids }) => history.remove(ids),
        historyClearBefore: ({ cutoff }) => history.clearBefore(cutoff),
        historyClearAfter: ({ cutoff }) => history.clearAfter(cutoff),
        historyClearAll: () => history.clearBefore(Number.MAX_SAFE_INTEGER),

        favoritesList: () => favorites.snapshot,
        favoritesOpen: ({ url, newTab }) =>
            Effect.gen(function* () {
                const { activeTabId } = snapshot(yield* store.state)
                if (newTab || activeTabId === null) {
                    yield* store.createTab(url).pipe(Effect.ignore)
                    return
                }
                yield* ctx.navigate(activeTabId, url)
            }),
        favoritesAdd: (input) => favorites.add(input),
        favoritesUpdate: ({ id, name, url, favicon }) =>
            favorites.update(id, { name, url, favicon }),
        favoritesRemove: ({ id }) => favorites.remove(id),
        favoritesCreateFolder: (input) => favorites.createFolder(input),
        favoritesMove: ({ id, parentId, index }) => favorites.move(id, parentId, index),

        getUpdateStatus: () => ctx.updater.status,
        installUpdate: () => ctx.updater.install,

        getDefaultBrowserStatus: () => Effect.sync(getDefaultBrowserStatus),
        setDefaultBrowser: () =>
            Effect.gen(function* () {
                const ok = yield* Effect.sync(setDefaultBrowser)
                if (!ok) {
                    return yield* new DefaultBrowserFailed({
                        message:
                            "The OS did not make Arbor the default browser. On macOS you may need to confirm in System Settings. On Linux Arbor must be installed with its .desktop file.",
                    })
                }
                return getDefaultBrowserStatus()
            }),

        findSearch: (find) =>
            Effect.gen(function* () {
                const view = yield* activeView(ctx)
                if (!view) return { total: 0, activeIndex: -1, error: null } satisfies FindStatus
                const status = yield* Effect.promise(() => runFindSearch(view.webContents, find))
                lastFindStatus.current = status
                return status
            }),
        findStep: ({ forward }) =>
            Effect.gen(function* () {
                const view = yield* activeView(ctx)
                if (!view) return lastFindStatus.current
                const status = yield* Effect.promise(() =>
                    runFindStep(view.webContents, lastFindStatus.current, forward),
                )
                lastFindStatus.current = status
                return status
            }),
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
            } else if (payload.kind === "favorite") {
                const favorite = (yield* ctx.favorites.snapshot).nodes.find(
                    (n) => n.id === payload.favoriteId,
                )
                if (favorite?.url) {
                    const { activeTabId } = snapshot(yield* store.state)
                    if (activeTabId !== null) yield* ctx.navigate(activeTabId, favorite.url)
                    else yield* store.createTab(favorite.url).pipe(Effect.ignore)
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
        // The OS menu at the cursor: Rename, or Hibernate (greyed when the page is already gone).
        tabMenu: ({ tabId, x, y }) =>
            Effect.gen(function* () {
                const state = yield* store.state
                const current = renameTarget(state, { kind: "tab", tabId })
                if (!current) return
                const hibernated = state.tabs.get(tabId)?.hibernated ?? false
                yield* Effect.sync(() =>
                    Menu.buildFromTemplate([
                        {
                            label: "Rename",
                            click: () => {
                                overlays.hideOmnibox()
                                overlays.openRename(current)
                            },
                        },
                        {
                            label: "Hibernate",
                            enabled: !hibernated,
                            click: () => ctx.background(store.hibernateTab(tabId)),
                        },
                    ]).popup({ window: ctx.handle.native, x, y }),
                )
            }),
        containerMenu: ({ containerId, x, y }) =>
            Effect.gen(function* () {
                const state = yield* store.state
                const current = renameTarget(state, { kind: "container", containerId })
                if (!current) return
                const tabs = [...state.tabs.values()].filter((t) => t.containerId === containerId)
                const hibernated = tabs.length > 0 && tabs.every((t) => t.hibernated)
                yield* Effect.sync(() =>
                    Menu.buildFromTemplate([
                        {
                            label: "Rename",
                            click: () => {
                                overlays.hideOmnibox()
                                overlays.openRename(current)
                            },
                        },
                        {
                            label: "Hibernate",
                            enabled: !hibernated,
                            click: () => ctx.background(store.hibernateContainer(containerId)),
                        },
                    ]).popup({ window: ctx.handle.native, x, y }),
                )
            }),
        extensionsToggle: (anchor) => Effect.sync(() => overlays.toggleExtensions(anchor)),
        extensionsClose: () => Effect.sync(() => overlays.closeExtensions()),
        extensionsSetPopupHeight: (height) =>
            Effect.sync(() => overlays.setExtensionsHeight(height)),
        downloadsToggle: (anchor) => Effect.sync(() => overlays.toggleDownloads(anchor)),
        downloadsClose: () => Effect.sync(() => overlays.closeDownloads()),
        downloadsSetPopupHeight: (height) => Effect.sync(() => overlays.setDownloadsHeight(height)),
        favoritesToggle: ({ anchor, mode, favoriteId }) =>
            Effect.sync(() => overlays.toggleFavorites(anchor, mode, favoriteId)),
        favoritesClose: () => Effect.sync(() => overlays.closeFavorites()),
        favoritesSetPopupHeight: (height) => Effect.sync(() => overlays.setFavoritesHeight(height)),
        extensionsMenu: (request) => ctx.extensions.openMenu(request),
        permissionRespond: (allowed) => ctx.prompts.respond(allowed),
        shellRaise: (raised) => ctx.handle.raiseShell(raised),
        titlebarReveal: (open) => ctx.handle.setWindowButtons(open),
        findClose: () =>
            Effect.gen(function* () {
                overlays.hideFindBar()
                const view = yield* activeView(ctx)
                if (!view) return
                yield* Effect.promise(() => runFindClear(view.webContents))
                yield* Effect.sync(() => view.webContents.focus())
            }),
    }
}
