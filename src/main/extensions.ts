import { existsSync, readdirSync } from "node:fs"
import path from "node:path"

import { Effect } from "effect"
import { app, session, type Session, type WebContents } from "electron"
import { ElectronChromeExtensions } from "electron-chrome-extensions"
import { installChromeWebStore } from "electron-chrome-web-store"

import type { StoreService } from "./state/store"
import { extensionShimPath } from "./windows/paths"

/** Bridge between the domain store/views and the per-container extension systems. */
interface ExtensionDeps {
    readonly store: StoreService
    readonly getWindow: () => Electron.BrowserWindow | null
    readonly viewForTab: (tabId: string) => Electron.WebContentsView | undefined
    readonly tabIdForWebContents: (wc: WebContents) => string | null
}

let deps: ExtensionDeps | null = null
const configured = new WeakSet<Session>()

const runQuiet = async (effect: Effect.Effect<void, unknown>): Promise<void> => {
    try {
        await Effect.runPromise(effect)
    } catch {
        // The tab may already be gone; extension commands are best-effort.
    }
}

/**
 * Registers the crx:// protocol on the session that hosts <browser-action-list>
 * (the main window renderer). Must run after app.whenReady().
 *
 * A bare instance on the default session hosts the shared crx IPC handler from startup,
 * so the action list never races container-session creation.
 */
export const initExtensions = (d: ExtensionDeps): void => {
    deps = d
    ElectronChromeExtensions.handleCRXProtocol(session.defaultSession)
    setupSessionExtensions(session.defaultSession, false)
}

/** Dev-only auto-loader for unpacked extensions in ./extensions at the project root. */
const unpackedExtensionsDir = (): string => {
    const candidates = [
        path.join(app.getAppPath(), "extensions"),
        path.join(process.cwd(), "extensions"),
    ]
    return candidates.find((dir) => existsSync(dir)) ?? candidates[0]
}

const loadUnpackedExtensions = async (ses: Session): Promise<void> => {
    const dir = unpackedExtensionsDir()
    const manifestDirs = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(dir, entry.name))
        .filter((extensionPath) => existsSync(path.join(extensionPath, "manifest.json")))
    await Promise.all(
        manifestDirs.map(async (extensionPath) => {
            try {
                await ses.extensions.loadExtension(extensionPath, { allowFileAccess: true })
            } catch (error) {
                console.error(`Failed to load extension ${path.basename(extensionPath)}:`, error)
            }
        }),
    )
}

const loadExtensionSources = async (ses: Session): Promise<void> => {
    // Web Store installs; update checks run per session over the shared store dir.
    try {
        await installChromeWebStore({ session: ses })
    } catch (error) {
        console.error("Failed to install Chrome Web Store support:", error)
    }
    if (!app.isPackaged) await loadUnpackedExtensions(ses)
}

/** One ElectronChromeExtensions instance per session, created lazily. */
export const setupSessionExtensions = (ses: Session, loadSources = true): void => {
    if (configured.has(ses)) return
    if (!deps) throw new Error("initExtensions must run before container sessions are created")
    configured.add(ses)
    const d = deps

    // Extensions gate on the UA (Proton Pass: /electron/i) and refuse to work
    // under Electron; match electron-browser-shell's Chrome-like UA.
    const userAgent = ses
        .getUserAgent()
        .replace(/\sElectron\/\S+/, "")
        .replace(new RegExp(`\\s${app.getName()}/\\S+`), "")
    ses.setUserAgent(userAgent)

    const extensions: ElectronChromeExtensions = new ElectronChromeExtensions({
        license: "GPL-3.0",
        session: ses,
        // chrome.tabs.create: a new active tab in the active container.
        createTab: async (details) => {
            const url = details.url ?? extensions.getURLOverrides().newtab
            const tabId = await Effect.runPromise(d.store.createTab(url))
            const win = d.getWindow()
            const view = win ? d.viewForTab(tabId) : undefined
            if (!win || !view) throw new Error(`No view created for tab: ${tabId}`)
            return [view.webContents, win]
        },
        // chrome.tabs.update({ active: true }).
        selectTab: (tab) => {
            const tabId = d.tabIdForWebContents(tab)
            if (tabId) void runQuiet(d.store.selectTab(tabId))
        },
        // chrome.tabs.remove.
        removeTab: (tab) => {
            const tabId = d.tabIdForWebContents(tab)
            if (tabId) void runQuiet(d.store.closeTab(tabId))
        },
        // v1 is single-window: chrome.windows.create becomes a new active tab.
        createWindow: async (details) => {
            const url = Array.isArray(details.url) ? details.url[0] : details.url
            await Effect.runPromise(d.store.createTab(url))
            const win = d.getWindow()
            if (!win) throw new Error("No browser window available")
            return win
        },
    })

    // Stubs for chrome.* events the library lacks
    // (MV3 background scripts crash without them).
    // Registered after the crx preloads so it patches on top.
    ses.registerPreloadScript({
        id: "arbor-crx-shim-frame",
        type: "frame",
        filePath: extensionShimPath,
    })
    ses.registerPreloadScript({
        id: "arbor-crx-shim-service-worker",
        type: "service-worker",
        filePath: extensionShimPath,
    })

    if (loadSources) void loadExtensionSources(ses)
}

/** Registers a view's webContents as an extension tab and marks it active. */
export const attachExtensionTab = (win: Electron.BrowserWindow, wc: WebContents): void => {
    const extensions = ElectronChromeExtensions.fromSession(wc.session)
    if (!extensions) return
    extensions.addTab(wc, win)
    extensions.selectTab(wc)
}
