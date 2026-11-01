/**
 * Small windows over the main window:
 * the omnibox popup, the extensions popup, extension action popups and the rename modal.
 */

import { Predicate } from "effect"
import { BrowserWindow, type BrowserWindowConstructorOptions } from "electron"

import type { Anchor, Rect, RenameTarget } from "../../shared/protocol"
import type { Pusher } from "../ipc/router"
import { loadRenderer, preloadPath } from "./paths"

const OVERLAY_DEFAULTS = {
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
} satisfies BrowserWindowConstructorOptions

/** A frameless child window of `parent`. */
const overlayWindow = (
    parent: BrowserWindow,
    options: BrowserWindowConstructorOptions,
): BrowserWindow => new BrowserWindow({ ...OVERLAY_DEFAULTS, ...options, parent })

/** The click that closes a popup by blurring it also hits its toggle: ignore a reopen just after. */
const dismissGuard = (windowMs: number) => {
    let last: { readonly key: string; readonly at: number } | null = null
    return {
        mark: (key: string): void => {
            last = { key, at: Date.now() }
        },
        suppressed: (key: string): boolean =>
            last !== null && last.key === key && Date.now() - last.at < windowMs,
    }
}

const DISMISS_WINDOW_MS = 400
const POPUP_GAP = 6

const OMNIBOX_MAX_HEIGHT = 400

const EXTENSIONS_POPUP_WIDTH = 320
const EXTENSIONS_POPUP_DEFAULT_HEIGHT = 72
const EXTENSIONS_POPUP_MAX_HEIGHT = 480

const ACTION_POPUP_MIN_WIDTH = 360
const ACTION_POPUP_MIN_HEIGHT = 480
const ACTION_POPUP_GAP = 5

/** Shape of electron-chrome-extensions' PopupView used for re-anchoring. */
export interface ExtensionPopupView {
    parent?: Electron.BaseWindow
    browserWindow?: Electron.BrowserWindow
    extensionId?: string
}

export const isExtensionPopupView = (value: unknown): value is ExtensionPopupView =>
    Predicate.hasProperty(value, "browserWindow") && Predicate.hasProperty(value, "parent")

const alive = (win: BrowserWindow | null): win is BrowserWindow =>
    win !== null && !win.isDestroyed()

/** A height a popup renderer reports, within bounds. `null` for a nonsense value. */
const clampHeight = (height: number, max: number): number | null =>
    Number.isFinite(height) && height > 0 ? Math.min(max, Math.round(height)) : null

export interface Overlays {
    readonly showOmnibox: (anchor: Anchor, query: string) => void
    readonly hideOmnibox: () => void
    readonly setOmniboxHeight: (height: number) => void
    /** Whether the omnibox popup exists, so it can take Enter itself. */
    readonly omniboxOpen: () => boolean

    readonly toggleExtensions: (anchor: Anchor) => void
    readonly closeExtensions: () => void
    readonly setExtensionsHeight: (height: number) => void

    /** Open (or, clicked again, close) a pinned extension's action popup above its toolbar button. */
    readonly toggleActionPopup: (options: {
        readonly extensionId: string
        readonly popupUrl: string
        readonly anchor: Rect | null
        readonly session: Electron.Session
        readonly onWindowOpen: (url: string) => void
    }) => void
    /**
     * Re-anchor an action popup the extension library opened, and give it a readable minimum size.
     * `window.open` from the popup goes to `onWindowOpen`
     * (some extensions fall back to it when `browser.tabs` is missing).
     */
    readonly positionLibraryPopup: (
        view: ExtensionPopupView,
        onWindowOpen: (url: string) => void,
    ) => void

    readonly openRename: (target: RenameTarget) => void
    readonly closeRename: () => void

    /** Destroy every overlay: the window is closing. */
    readonly closeAll: () => void
}

export const createOverlays = (win: BrowserWindow, ipc: Pusher): Overlays => {
    const dismissed = dismissGuard(DISMISS_WINDOW_MS)

    // --- omnibox popup

    let omnibox: BrowserWindow | null = null
    let omniboxAnchor: Anchor | null = null
    let omniboxHeight = 12
    let lastQuery = ""

    const placeOmnibox = (): void => {
        if (!alive(omnibox) || !omniboxAnchor) return
        const bounds = win.getContentBounds()
        omnibox.setBounds({
            x: Math.round(bounds.x + omniboxAnchor.x),
            y: Math.round(bounds.y + omniboxAnchor.y - omniboxHeight - POPUP_GAP),
            width: Math.round(omniboxAnchor.width),
            height: Math.round(omniboxHeight),
        })
    }

    const showOmnibox = (anchor: Anchor, query: string): void => {
        omniboxAnchor = anchor
        lastQuery = query
        if (!alive(omnibox)) {
            const created = overlayWindow(win, {
                focusable: false,
                webPreferences: { preload: preloadPath },
            })
            omnibox = created
            created.on("closed", () => {
                if (omnibox === created) omnibox = null
            })
            ipc.attach(created.webContents)
            // Queries sent while the popup renderer is still loading would be lost.
            created.webContents.on("did-finish-load", () => ipc.push("omniboxQuery", lastQuery))
            void loadRenderer(created, "omnibox")
        }
        placeOmnibox()
        ipc.push("omniboxQuery", lastQuery)
        omnibox?.showInactive()
    }

    const hideOmnibox = (): void => {
        if (alive(omnibox)) omnibox.hide()
    }

    // --- extensions popup

    let extensions: BrowserWindow | null = null
    let extensionsAnchor: Anchor | null = null
    let extensionsHeight = EXTENSIONS_POPUP_DEFAULT_HEIGHT

    const closeExtensions = (markDismissed = false): void => {
        if (alive(extensions)) {
            if (markDismissed) dismissed.mark("extensions")
            extensions.destroy()
        }
        extensions = null
    }

    const placeExtensions = (): void => {
        if (!alive(extensions) || !extensionsAnchor) return
        const bounds = win.getContentBounds()
        extensions.setBounds({
            x: Math.round(
                bounds.x + extensionsAnchor.x + extensionsAnchor.width - EXTENSIONS_POPUP_WIDTH,
            ),
            y: Math.round(bounds.y + extensionsAnchor.y - extensionsHeight - POPUP_GAP),
            width: EXTENSIONS_POPUP_WIDTH,
            height: Math.round(extensionsHeight),
        })
    }

    const toggleExtensions = (anchor: Anchor): void => {
        if (alive(extensions)) {
            closeExtensions()
            return
        }
        // Clicking the puzzle button to close an open popup races with its blur-close.
        if (dismissed.suppressed("extensions")) return
        extensionsAnchor = anchor
        extensionsHeight = EXTENSIONS_POPUP_DEFAULT_HEIGHT
        const created = overlayWindow(win, {
            width: EXTENSIONS_POPUP_WIDTH,
            height: extensionsHeight,
            webPreferences: { preload: preloadPath },
        })
        extensions = created
        created.on("closed", () => {
            if (extensions === created) extensions = null
        })
        created.on("blur", () => closeExtensions(true))
        ipc.attach(created.webContents)
        void loadRenderer(created, "extensions")
        placeExtensions()
        created.show()
    }

    // --- extension action popups

    const actionAnchors = new Map<string, Rect>()

    const anchorAbove = (
        rect: Electron.Rectangle,
        parent: Electron.BaseWindow | undefined,
        extensionId: string | undefined,
    ): Electron.Rectangle => {
        const width = Math.max(rect.width, ACTION_POPUP_MIN_WIDTH)
        const height = Math.max(rect.height, ACTION_POPUP_MIN_HEIGHT)
        // The pinned button when there is one, else the puzzle button that lists extensions.
        const target =
            (extensionId ? actionAnchors.get(extensionId) : undefined) ?? extensionsAnchor
        if (!target || !parent || parent.isDestroyed())
            return { x: rect.x, y: rect.y, width, height }
        const content = parent.getContentBounds()
        return {
            x: Math.round(content.x + target.x + target.width - width),
            y: Math.round(content.y + target.y - height - ACTION_POPUP_GAP),
            width,
            height,
        }
    }

    const positionLibraryPopup = (
        view: ExtensionPopupView,
        onWindowOpen: (url: string) => void,
    ): void => {
        const popupWin = view.browserWindow
        if (!popupWin || popupWin.isDestroyed()) return
        const setBounds = popupWin.setBounds.bind(popupWin)
        popupWin.setBounds = (rect: Electron.Rectangle): void => {
            setBounds(anchorAbove(rect, view.parent, view.extensionId))
        }
        popupWin.webContents.setWindowOpenHandler(({ url }) => {
            if (url && url !== "about:blank") onWindowOpen(url)
            return { action: "deny" }
        })
    }

    /**
     * A pinned button's popup, opened by Arbor rather than by electron-chrome-extensions:
     * the library only opens popups from its own surfaces, and pinned buttons are Arbor's UI.
     */
    let actionPopup: { readonly win: BrowserWindow; readonly extensionId: string } | null = null

    const closeActionPopup = (markDismissed = false): void => {
        const open = actionPopup
        actionPopup = null
        if (!open || open.win.isDestroyed()) return
        // Records the close, so the click that caused it is not mistaken for a reopen.
        if (markDismissed) dismissed.mark(`action:${open.extensionId}`)
        open.win.destroy()
    }

    const toggleActionPopup: Overlays["toggleActionPopup"] = (options) => {
        const { extensionId } = options
        if (options.anchor) actionAnchors.set(extensionId, options.anchor)
        // Clicking the same button again closes the popup.
        if (actionPopup?.extensionId === extensionId) {
            closeActionPopup()
            return
        }
        // Clicking the button to close an open popup races with the popup's blur-close.
        if (dismissed.suppressed(`action:${extensionId}`)) return
        closeActionPopup()

        const bounds = win.getContentBounds()
        const created = new BrowserWindow({
            ...OVERLAY_DEFAULTS,
            transparent: false,
            hasShadow: true,
            x: bounds.x,
            y: bounds.y,
            width: ACTION_POPUP_MIN_WIDTH,
            height: ACTION_POPUP_MIN_HEIGHT,
            parent: win,
            webPreferences: { session: options.session },
        })
        actionPopup = { win: created, extensionId }
        created.on("closed", () => {
            if (actionPopup?.win === created) actionPopup = null
        })
        positionLibraryPopup(
            { browserWindow: created, parent: win, extensionId },
            options.onWindowOpen,
        )
        created.setBounds(created.getBounds())
        created.show()
        created.on("blur", () => closeActionPopup(true))
        void created.loadURL(options.popupUrl)
    }

    // --- rename modal

    let rename: BrowserWindow | null = null
    let renameTarget: RenameTarget | null = null

    const closeRename = (): void => {
        if (alive(rename)) rename.destroy()
        rename = null
        renameTarget = null
    }

    const openRename = (target: RenameTarget): void => {
        closeRename()
        renameTarget = target
        const bounds = win.getContentBounds()
        const created = overlayWindow(win, { ...bounds, webPreferences: { preload: preloadPath } })
        rename = created
        created.on("closed", () => {
            if (rename !== created) return
            rename = null
            renameTarget = null
        })
        ipc.attach(created.webContents)
        // Sent once the page has loaded.
        created.webContents.on("did-finish-load", () => {
            if (renameTarget) ipc.push("renameTarget", renameTarget)
        })
        void loadRenderer(created, "rename")
        created.show()
    }

    // --- window wiring

    win.on("resize", () => {
        if (alive(rename)) rename.setBounds(win.getContentBounds())
    })
    win.on("move", () => {
        hideOmnibox()
        if (alive(rename)) rename.setBounds(win.getContentBounds())
    })
    win.on("blur", hideOmnibox)

    return {
        showOmnibox,
        hideOmnibox,
        setOmniboxHeight: (height) => {
            const next = clampHeight(height, OMNIBOX_MAX_HEIGHT)
            if (next === null) return
            omniboxHeight = next
            placeOmnibox()
        },
        omniboxOpen: () => alive(omnibox),
        toggleExtensions,
        closeExtensions: () => closeExtensions(),
        setExtensionsHeight: (height) => {
            const next = clampHeight(height, EXTENSIONS_POPUP_MAX_HEIGHT)
            if (next === null) return
            extensionsHeight = next
            placeExtensions()
        },
        toggleActionPopup,
        positionLibraryPopup,
        openRename,
        closeRename,
        closeAll: () => {
            if (alive(omnibox)) omnibox.destroy()
            closeExtensions()
            closeActionPopup()
            closeRename()
        },
    }
}
