import { Effect } from "effect"
import {
    WebContentsView,
    session,
    type BrowserWindow,
    type Session,
    type WebContents,
} from "electron"
import buildChromeContextMenu from "electron-chrome-context-menu"

import { isInternalUrl } from "../../shared/internal-pages"
import type { ContainerId } from "../../shared/protocol"
import { extensionsReady, setupSessionExtensions } from "../extension/loader"
import type { DomainState } from "../state/state"
import type { StoreService } from "../state/store"
import { internalSession } from "./internal-pages"

const SIDEBAR_WIDTH = 240
const TOOLBAR_HEIGHT = 44

export interface ViewDeps {
    readonly store: StoreService
    readonly getState: () => DomainState
}

const views = new Map<string, WebContentsView>()

/**
 * The session a tab loads on: Arbor's own for `arbor://`, its Container's otherwise.
 *
 * Each Container gets a private session so cookies, storage and extensions stay separate.
 * The settings page belongs to no Container,
 * and it needs Arbor's own session to reach the preload bridge that talks to Arbor.
 */
export const sessionForTab = (containerId: ContainerId, url: string): Session =>
    isInternalUrl(url) ? internalSession() : sessionForContainer(containerId)

// --- per-container sessions

const partitions = new Map<ContainerId, Session>()

export const sessionForContainer = (containerId: ContainerId): Session => {
    const existing = partitions.get(containerId)
    if (existing) return existing
    const partition = session.fromPartition(`persist:container-${containerId}`)
    setupSessionExtensions(partition)
    partitions.set(containerId, partition)
    return partition
}

// --- tab views

export const viewForTab = (tabId: string): WebContentsView | undefined => views.get(tabId)

/**
 * The web contents of tabs showing an Arbor page, the only ones carrying the preload bridge.
 *
 * Tabs are `WebContentsView`s rather than windows,
 * so broadcasting to `BrowserWindow.getAllWindows()` skipped them
 * and the settings page never heard about settings changes.
 * The internal session is what identifies them.
 */
export const internalViewWebContents = (): WebContents[] => {
    const ses = internalSession()
    return [...views.values()]
        .filter((view) => view.webContents.session === ses)
        .map((view) => view.webContents)
}

/**
 * Whether a tab's live view sits on the wrong session for its URL and must be rebuilt.
 *
 * A view's session is fixed when it is constructed, so a tab moving between a web page and
 * an `arbor://` page cannot reuse its view. Rebuilding costs a brief reload.
 */
export const sessionMismatch = (tabId: string, containerId: ContainerId, url: string): boolean => {
    const view = views.get(tabId)
    if (!view) return false
    return view.webContents.session !== sessionForTab(containerId, url)
}

export const tabIdForWebContents = (wc: WebContents): string | null => {
    for (const [tabId, view] of views) {
        if (view.webContents === wc) return tabId
    }
    return null
}

const openChildTab = async (
    store: StoreService,
    parentTabId: string,
    url: string,
    disposition: string,
): Promise<void> => {
    await Effect.runPromise(store.createChildTab(parentTabId, url))
    // Background opens must not steal focus from the originating tab.
    if (disposition === "background-tab") await Effect.runPromise(store.selectTab(parentTabId))
}

export const ensureView = (deps: ViewDeps, tabId: string, url: string): WebContentsView => {
    const existing = views.get(tabId)
    if (existing) return existing
    const tab = deps.getState().tabs.get(tabId)
    if (!tab) throw new Error(`Cannot create view for unknown tab: ${tabId}`)
    const view = new WebContentsView({
        webPreferences: { session: sessionForTab(tab.containerId, url) },
    })
    // target=_blank, ctrl+click and window.open all become child tabs of the opener.
    view.webContents.setWindowOpenHandler(({ url: target, disposition }) => {
        void openChildTab(deps.store, tabId, target, disposition)
        return { action: "deny" }
    })
    view.webContents.on("context-menu", (_event, params) => {
        const menu = buildChromeContextMenu({
            params,
            webContents: view.webContents,
            openLink: (target, disposition) => {
                void openChildTab(deps.store, tabId, target, disposition)
            },
        })
        menu.popup()
    })
    views.set(tabId, view)
    trackPageMeta(deps.store, tabId, view)
    void loadTabUrl(tabId, tab.containerId, url, view)
    return view
}

/**
 * Loads a tab's URL, waiting for the container's extensions first when the URL points at one:
 * a `chrome-extension://` navigation is refused with ERR_BLOCKED_BY_CLIENT
 * until its extension is actually installed.
 * A view torn down while waiting never loads.
 */
const loadTabUrl = async (
    tabId: string,
    containerId: ContainerId,
    url: string,
    view: WebContentsView,
): Promise<void> => {
    if (url.startsWith("chrome-extension://")) {
        await extensionsReady(sessionForContainer(containerId))
    }
    if (views.get(tabId) !== view) return
    await view.webContents.loadURL(url)
}

export const destroyView = (tabId: string): void => {
    const view = views.get(tabId)
    if (!view) return
    views.delete(tabId)
    view.webContents.close()
}

/**
 * Record a tab's new URL, then load it.
 *
 * Crossing the `arbor://` boundary changes which session the tab needs,
 * so there the URL is only recorded: `onCommit` then sees the mismatch,
 * rebuilds the view on the right session, and loads it.
 * Loading here would target the session just discarded.
 */
export const navigateTab = async (deps: ViewDeps, tabId: string, url: string): Promise<void> => {
    const tab = deps.getState().tabs.get(tabId)
    if (!tab) return
    await Effect.runPromise(deps.store.updateTabMeta(tabId, { url }))
    if (sessionMismatch(tabId, tab.containerId, url)) return
    await viewForTab(tabId)?.webContents.loadURL(url)
}

export const showTab = (win: BrowserWindow, tabId: string): void => {
    const view = views.get(tabId)
    if (!view) return
    for (const other of views.values()) {
        if (other !== view) win.contentView.removeChildView(other)
    }
    win.contentView.addChildView(view)
    layoutViews(win)
}

export const layoutViews = (win: BrowserWindow): void => {
    const { width, height } = win.getContentBounds()
    for (const view of win.contentView.children) {
        view.setBounds({
            x: SIDEBAR_WIDTH,
            y: 0,
            width: Math.max(0, width - SIDEBAR_WIDTH),
            height: Math.max(0, height - TOOLBAR_HEIGHT),
        })
    }
}

const trackPageMeta = (store: StoreService, tabId: string, view: WebContentsView): void => {
    const { webContents } = view
    // updateTabMeta builds a lazy Effect, voiding it would discard it unexecuted.
    const runMeta = (effect: Effect.Effect<void>): void => {
        void Effect.runPromiseExit(effect)
    }
    webContents.on("page-title-updated", (_event, title) => {
        runMeta(store.updateTabMeta(tabId, { title }))
    })
    webContents.on("did-navigate", (_event, url) => {
        runMeta(store.updateTabMeta(tabId, { url, title: "", favicon: null }))
    })
    webContents.on("did-navigate-in-page", (_event, url) => {
        runMeta(store.updateTabMeta(tabId, { url }))
    })
    webContents.on("page-favicon-updated", (_event, icons) => {
        // "data:," is Chromium's marker for "this page has no favicon".
        const favicon = icons.filter((icon) => icon !== "data:,").at(-1) ?? null
        runMeta(store.updateTabMeta(tabId, { favicon }))
    })
}
