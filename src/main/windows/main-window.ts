import { BrowserWindow, nativeTheme } from "electron"

import type { Settings } from "../../shared/settings"
import { hideOmniboxPopup, repositionRenameModal } from "./overlays"
import { createShellView, layoutShell } from "./shell-view"
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

export const createWindow = async (getSettings: () => Settings): Promise<BrowserWindow> => {
    const settings = getSettings()
    const win = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 720,
        minHeight: 480,
        show: false,
        title: "Arbor",
        backgroundColor: windowBackground(settings),
    })

    const shell = await createShellView(win, getSettings)
    win.show()
    if (process.env.VITE_DEV_SERVER_URL) shell.webContents.openDevTools({ mode: "detach" })

    return win
}

/** Resize/move/blur wiring previously inline in index.ts. */
export const attachWindowEvents = (win: BrowserWindow): void => {
    win.on("resize", () => {
        layoutShell()
        layoutViews(win)
        repositionRenameModal(win)
    })
    win.on("move", () => {
        hideOmniboxPopup()
        repositionRenameModal(win)
    })
    win.on("blur", () => hideOmniboxPopup())
}
