import { BrowserWindow } from "electron"

import { hideOmniboxPopup, repositionRenameModal } from "./overlays"
import { loadRenderer, preloadPath } from "./paths"
import { layoutViews } from "./tab-views"

export const createWindow = async (): Promise<BrowserWindow> => {
    const win = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 720,
        minHeight: 480,
        show: false,
        title: "Arbor",
        backgroundColor: "#ffffff",
        webPreferences: { preload: preloadPath },
    })

    win.on("ready-to-show", () => win.show())

    await loadRenderer(win)
    if (process.env.VITE_DEV_SERVER_URL) win.webContents.openDevTools()

    return win
}

/** Resize/move/blur wiring previously inline in index.ts. */
export const attachWindowEvents = (win: BrowserWindow): void => {
    win.on("resize", () => {
        layoutViews(win)
        repositionRenameModal(win)
    })
    win.on("move", () => {
        hideOmniboxPopup()
        repositionRenameModal(win)
    })
    win.on("blur", () => hideOmniboxPopup())
}
