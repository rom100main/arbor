import { BrowserWindow, nativeTheme } from "electron"

import type { Settings } from "../../shared/settings"
import { hideOmniboxPopup, repositionRenameModal } from "./overlays"
import { loadRenderer, preloadPath } from "./paths"
import { layoutViews } from "./tab-views"

/**
 * The window background behind the renderer, so a dark theme does not flash white before first paint.
 */
const windowBackground = (settings: Settings): string =>
    settings.theme === "system"
        ? nativeTheme.shouldUseDarkColors
            ? "#111315"
            : "#ffffff"
        : settings.theme === "dark"
          ? "#111315"
          : "#ffffff"

export const createWindow = async (settings: Settings): Promise<BrowserWindow> => {
    const win = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 720,
        minHeight: 480,
        show: false,
        title: "Arbor",
        backgroundColor: windowBackground(settings),
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
