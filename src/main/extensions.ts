import { existsSync, readdirSync } from "node:fs"
import path from "node:path"

import { Effect } from "effect"
import { app, session, type Session, type WebContents } from "electron"
import { ElectronChromeExtensions } from "electron-chrome-extensions"
import { installChromeWebStore } from "electron-chrome-web-store"

import type { StoreService } from "./state/store"
import { attachExtensionPopupPositioning, isExtensionPopupView } from "./windows/overlays"
import { extensionShimPath } from "./windows/paths"

/** Bridge between the domain store/views and the per-container extension systems. */
interface ExtensionDeps {
    readonly store: StoreService
    readonly getWindow: () => Electron.BrowserWindow | null
    readonly viewForTab: (tabId: string) => Electron.WebContentsView | undefined
    readonly ensureView: (tabId: string, url: string) => Electron.WebContentsView
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

/**
 * MV3 service workers sometimes fail the first `startWorkerForScope` right after loadExtension
 * (electron-chrome-web-store swallows that rejection).
 * Retry a few times and log the real error only if every attempt fails.
 */
const startWorkerWithRetry = async (
    ses: Session,
    scopes: readonly string[],
    attemptsLeft: number,
): Promise<void> => {
    const scope = scopes[0]
    try {
        await ses.serviceWorkers.startWorkerForScope(scope)
    } catch (error) {
        if (scopes.length > 1) {
            await startWorkerWithRetry(ses, scopes.slice(1), attemptsLeft)
            return
        }
        if (attemptsLeft <= 1) throw error
        await new Promise((resolve) => setTimeout(resolve, 400))
        await startWorkerWithRetry(ses, scopes, attemptsLeft - 1)
    }
}

const startMv3Workers = async (ses: Session, attempts = 3): Promise<void> => {
    const extensionsApi = ses.extensions
    if (!extensionsApi) return
    const startOne = async (extensionId: string, scopes: readonly string[]): Promise<void> => {
        try {
            await startWorkerWithRetry(ses, scopes, attempts)
            console.debug(`[arbor] MV3 worker started for ${extensionId}`)
        } catch (error) {
            console.error(`Failed to start worker for extension ${extensionId}:`, error)
        }
    }
    const tasks = extensionsApi.getAllExtensions().flatMap((extension) => {
        if (extension.manifest.manifest_version !== 3) return []
        const background: unknown = extension.manifest.background
        if (typeof background !== "object" || background === null) return []
        if (!("service_worker" in background)) return []
        const worker: unknown = background.service_worker
        if (typeof worker !== "string" || worker.length === 0) return []
        // electron-chrome-web-store uses no trailing slash; the event bus uses one.
        const scopes = [`chrome-extension://${extension.id}/`, `chrome-extension://${extension.id}`]
        return [startOne(extension.id, scopes)]
    })
    await Promise.all(tasks)
}

const loadExtensionSources = async (ses: Session): Promise<void> => {
    // Web Store installs; update checks run per session over the shared store dir.
    try {
        await installChromeWebStore({ session: ses })
    } catch (error) {
        console.error("Failed to install Chrome Web Store support:", error)
    }
    if (!app.isPackaged) await loadUnpackedExtensions(ses)
    // Give Electron a beat to finish registering MV3 backgrounds after loadExtension.
    await new Promise((resolve) => setTimeout(resolve, 500))
    await startMv3Workers(ses)
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
            try {
                const tabId = await Effect.runPromise(d.store.createTab(url))
                const win = d.getWindow()
                let view = win ? d.viewForTab(tabId) : undefined
                // onCommit creates the active tab's view; if the commit path was skipped
                // (e.g. popup opened a tab before the window was attached), force it.
                if (win && !view) view = d.ensureView(tabId, url)
                if (!win || !view) {
                    throw new Error(`No view created for tab: ${tabId}`)
                }
                return [view.webContents, win]
            } catch (error) {
                console.error(`[arbor] extension tabs.create failed url=${url}:`, error)
                throw error
            }
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
        // chrome.permissions.request: auto-grant (no consent dialog in v1).
        requestPermissions: async (_extension, permissions) => {
            console.debug("[arbor] auto-grant extension permissions:", permissions)
            return true
        },
    })

    // Re-anchor action popups (chrome.action popups) above the toolbar button
    // and give them a readable minimum size. window.open fallback creates a tab.
    extensions.on("browser-action-popup-created", (...popupEvent: unknown[]) => {
        const popup = popupEvent[0]
        if (!isExtensionPopupView(popup)) return
        attachExtensionPopupPositioning(popup, (url) => {
            void runQuiet(d.store.createTab(url))
        })
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
