import { BrowserWindow, type BrowserWindow as ParentWindow } from "electron"

import type { PermissionPromptRequest, RenameTarget } from "../../shared/protocol"
import { loadRenderer, preloadPath } from "./paths"

// --- omnibox popup

const POPUP_GAP = 6
const DEFAULT_HEIGHT = 160
const MAX_HEIGHT = 400

let popup: BrowserWindow | null = null
let anchor: { x: number; y: number; width: number } | null = null
let popupHeight = DEFAULT_HEIGHT
let lastQuery = ""

export const popupWebContents = (): Electron.WebContents | null =>
    popup && !popup.isDestroyed() ? popup.webContents : null

const repositionPopup = (win: ParentWindow): void => {
    if (!popup || popup.isDestroyed() || !anchor) return
    const bounds = win.getContentBounds()
    popup.setBounds({
        x: Math.round(bounds.x + anchor.x),
        y: Math.round(bounds.y + anchor.y - popupHeight - POPUP_GAP),
        width: Math.round(anchor.width),
        height: Math.round(popupHeight),
    })
}

export const showOmniboxPopup = (
    win: ParentWindow,
    rect: { x: number; y: number; width: number },
    query: string,
): void => {
    anchor = rect
    lastQuery = query
    if (!popup || popup.isDestroyed()) {
        const bounds = win.getContentBounds()
        popup = new BrowserWindow({
            x: Math.round(bounds.x + rect.x),
            y: Math.round(bounds.y + rect.y - popupHeight - POPUP_GAP),
            width: Math.round(rect.width),
            height: Math.round(popupHeight),
            show: false,
            frame: false,
            transparent: true,
            resizable: false,
            movable: false,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            skipTaskbar: true,
            focusable: false,
            hasShadow: false,
            parent: win,
            webPreferences: { preload: preloadPath },
        })
        popup.on("closed", () => {
            popup = null
        })
        // Queries sent while the popup renderer is still loading would be lost.
        popup.webContents.on("did-finish-load", () => {
            popup?.webContents.send("arbor:omnibox:query", lastQuery)
        })
        void loadRenderer(popup, "omnibox")
    }
    repositionPopup(win)
    popup.webContents.send("arbor:omnibox:query", lastQuery)
    popup.showInactive()
}

export const setOmniboxPopupHeight = (win: ParentWindow, height: number): void => {
    if (typeof height !== "number" || !Number.isFinite(height) || height <= 0) return
    popupHeight = Math.min(MAX_HEIGHT, Math.round(height))
    repositionPopup(win)
}

export const hideOmniboxPopup = (): void => {
    if (popup && !popup.isDestroyed()) popup.hide()
}

// --- extensions popup

const EXTENSIONS_POPUP_WIDTH = 320
const EXTENSIONS_POPUP_DEFAULT_HEIGHT = 72
const EXTENSIONS_POPUP_MAX_HEIGHT = 480

let extensionsPopup: BrowserWindow | null = null
let extensionsAnchor: { x: number; y: number; width: number } | null = null
let extensionsPopupHeight = EXTENSIONS_POPUP_DEFAULT_HEIGHT

const repositionExtensionsPopup = (win: ParentWindow): void => {
    if (!extensionsPopup || extensionsPopup.isDestroyed() || !extensionsAnchor) return
    const bounds = win.getContentBounds()
    extensionsPopup.setBounds({
        x: Math.round(
            bounds.x + extensionsAnchor.x + extensionsAnchor.width - EXTENSIONS_POPUP_WIDTH,
        ),
        y: Math.round(bounds.y + extensionsAnchor.y - extensionsPopupHeight - POPUP_GAP),
        width: EXTENSIONS_POPUP_WIDTH,
        height: Math.round(extensionsPopupHeight),
    })
}

export const toggleExtensionsPopup = (
    win: ParentWindow,
    rect: { x: number; y: number; width: number },
): void => {
    const open = extensionsPopup
    if (open && !open.isDestroyed()) {
        extensionsPopup = null
        open.destroy()
        return
    }
    extensionsAnchor = rect
    extensionsPopupHeight = EXTENSIONS_POPUP_DEFAULT_HEIGHT
    const bounds = win.getContentBounds()
    extensionsPopup = new BrowserWindow({
        x: Math.round(bounds.x + rect.x + rect.width - EXTENSIONS_POPUP_WIDTH),
        y: Math.round(bounds.y + rect.y - extensionsPopupHeight - POPUP_GAP),
        width: EXTENSIONS_POPUP_WIDTH,
        height: Math.round(extensionsPopupHeight),
        show: false,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        focusable: false,
        hasShadow: false,
        parent: win,
        webPreferences: { preload: preloadPath },
    })
    extensionsPopup.on("closed", () => {
        extensionsPopup = null
    })
    void loadRenderer(extensionsPopup, "extensions")
    repositionExtensionsPopup(win)
    extensionsPopup.showInactive()
}

export const setExtensionsPopupHeight = (win: ParentWindow, height: number): void => {
    if (typeof height !== "number" || !Number.isFinite(height) || height <= 0) return
    extensionsPopupHeight = Math.min(EXTENSIONS_POPUP_MAX_HEIGHT, Math.round(height))
    repositionExtensionsPopup(win)
}

export const hideExtensionsPopup = (): void => {
    const open = extensionsPopup
    if (open && !open.isDestroyed()) {
        extensionsPopup = null
        open.destroy()
    }
}

// --- extension action popups (chrome.action popup windows)

const EXTENSION_POPUP_MIN_WIDTH = 360
const EXTENSION_POPUP_MIN_HEIGHT = 480
const EXTENSION_POPUP_GAP = 5

/** Toolbar anchor for a pinned extension's action popup, in window content coords. */
type ExtensionAnchor = { x: number; y: number; width: number; height: number }

const extensionAnchors = new Map<string, ExtensionAnchor>()

/** Remember where a pinned toolbar icon sits so its action popup opens above it. */
export const setExtensionAnchor = (extensionId: string, rect: ExtensionAnchor): void => {
    extensionAnchors.set(extensionId, rect)
}

/** Shape of electron-chrome-extensions' PopupView used for re-anchoring. */
export interface ExtensionPopupView {
    parent?: Electron.BaseWindow
    browserWindow?: Electron.BrowserWindow
    extensionId?: string
}

export const isExtensionPopupView = (value: unknown): value is ExtensionPopupView =>
    typeof value === "object" && value !== null && "browserWindow" in value && "parent" in value

/**
 * Re-anchor action popups above the toolbar button
 * and enforce a readable minimum size.
 * Routes window.open from the popup through `onWindowOpen`
 * (some extension falls back to window.open when browser.tabs is missing).
 */
export const attachExtensionPopupPositioning = (
    view: ExtensionPopupView,
    onWindowOpen?: (url: string) => void,
): void => {
    const popupWin = view.browserWindow
    if (!popupWin || popupWin.isDestroyed()) return
    const origSetBounds = popupWin.setBounds.bind(popupWin)
    popupWin.setBounds = (rect: Electron.Rectangle): void => {
        const width = Math.max(rect.width, EXTENSION_POPUP_MIN_WIDTH)
        const height = Math.max(rect.height, EXTENSION_POPUP_MIN_HEIGHT)
        let x = rect.x
        let y = rect.y
        const parentWin = view.parent
        // Pinned toolbar icon when present, else the puzzle button that lists extensions.
        const actionAnchor =
            (view.extensionId ? extensionAnchors.get(view.extensionId) : undefined) ??
            extensionsAnchor
        if (actionAnchor && parentWin && !parentWin.isDestroyed()) {
            const content = parentWin.getContentBounds()
            x = Math.round(content.x + actionAnchor.x + actionAnchor.width - width)
            y = Math.round(content.y + actionAnchor.y - height - EXTENSION_POPUP_GAP)
        }
        origSetBounds({ x, y, width, height })
    }
    popupWin.webContents.setWindowOpenHandler(({ url }) => {
        if (url && url !== "about:blank") onWindowOpen?.(url)
        return { action: "deny" }
    })
}

// --- rename modal

let modal: BrowserWindow | null = null
let pendingTarget: RenameTarget | null = null

export const closeRenameModal = (): void => {
    if (modal && !modal.isDestroyed()) modal.destroy()
    modal = null
    pendingTarget = null
}

export const repositionRenameModal = (win: BrowserWindow): void => {
    if (!modal || modal.isDestroyed()) return
    modal.setBounds(win.getContentBounds())
}

export const openRenameModal = (win: BrowserWindow, target: RenameTarget): void => {
    closeRenameModal()
    pendingTarget = target

    const bounds = win.getContentBounds()
    modal = new BrowserWindow({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
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
        parent: win,
        webPreferences: { preload: preloadPath },
    })
    modal.on("closed", () => {
        modal = null
        pendingTarget = null
    })
    // The renderer registers its target listener during load; replay afterwards.
    modal.webContents.on("did-finish-load", () => {
        modal?.webContents.send("arbor:rename:target", pendingTarget)
    })
    void loadRenderer(modal, "rename")
    modal.show()
}

// --- permission prompt modal (extension install / permissions.request)

interface PendingPrompt {
    request: PermissionPromptRequest
    settle: (allowed: boolean) => void
}

let permissionModal: BrowserWindow | null = null
let activePrompt: PendingPrompt | null = null
let promptParent: BrowserWindow | null = null
const promptQueue: PendingPrompt[] = []

const showPrompt = (prompt: PendingPrompt): void => {
    activePrompt = prompt
    const win = promptParent && !promptParent.isDestroyed() ? promptParent : null
    const bounds = win?.getContentBounds()
    permissionModal = new BrowserWindow({
        x: bounds?.x,
        y: bounds?.y,
        width: bounds?.width,
        height: bounds?.height,
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
        ...(win ? { parent: win } : {}),
        webPreferences: { preload: preloadPath },
    })
    permissionModal.on("closed", () => {
        permissionModal = null
        // Closing the dialog without answering is a refusal.
        settlePrompt(false)
    })
    // The renderer registers its request listener during load; replay afterwards.
    permissionModal.webContents.on("did-finish-load", () => {
        permissionModal?.webContents.send("arbor:permission:request", activePrompt?.request ?? null)
    })
    void loadRenderer(permissionModal, "permission")
    permissionModal.show()
}

const settlePrompt = (allowed: boolean): void => {
    const prompt = activePrompt
    if (!prompt) return
    activePrompt = null
    const promptWindow = permissionModal
    permissionModal = null
    if (promptWindow && !promptWindow.isDestroyed()) {
        // Already closing (or about to): don't let "closed" settle the next answer.
        promptWindow.removeAllListeners("closed")
        promptWindow.destroy()
    }
    prompt.settle(allowed)
    const next = promptQueue.shift()
    if (next) showPrompt(next)
}

/** Resolves `true` on Allow, `false` on Deny or when the dialog is closed. One at a time. */
export const openPermissionPrompt = (
    win: ParentWindow | null,
    request: PermissionPromptRequest,
): Promise<boolean> =>
    new Promise((resolve) => {
        if (win && !win.isDestroyed()) promptParent = win
        const prompt: PendingPrompt = { request, settle: resolve }
        if (activePrompt) {
            promptQueue.push(prompt)
            return
        }
        showPrompt(prompt)
    })

/** Answer for the visible prompt (`arbor:permission:respond`). */
export const respondPermissionPrompt = (allowed: boolean): void => {
    settlePrompt(allowed)
}
