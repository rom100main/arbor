import path from "node:path"
import { fileURLToPath } from "node:url"

import type { BrowserWindow, WebContents } from "electron"

const here = path.dirname(fileURLToPath(import.meta.url))

export const preloadPath = path.join(here, "../preload/index.cjs")
export const extensionShimPath = path.join(here, "../preload/extension-shim.cjs")
export const extensionStorageShimPath = path.join(here, "../preload/extension-storage-shim.cjs")

export const rendererPath = path.join(here, "../../client/index.html")

/** Dev server vs. packaged file loader shared by all windows and the shell view. */
export const loadRenderer = (win: BrowserWindow | WebContents, query?: string): Promise<void> => {
    if (process.env.VITE_DEV_SERVER_URL) {
        const url = query
            ? `${process.env.VITE_DEV_SERVER_URL}?${query}`
            : process.env.VITE_DEV_SERVER_URL
        return win.loadURL(url)
    }
    if (query) return win.loadFile(rendererPath, { search: query })
    return win.loadFile(rendererPath)
}
