import { BrowserWindow, type BrowserWindow as ParentWindow } from "electron"

import type { RenameTarget } from "../../shared/protocol"
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
