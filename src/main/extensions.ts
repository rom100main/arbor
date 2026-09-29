import { existsSync, readdirSync } from "node:fs"
import path from "node:path"

import { Effect } from "effect"
import { app, Menu, MenuItem, session, type Session, type WebContents } from "electron"
import { ElectronChromeExtensions } from "electron-chrome-extensions"
import { installChromeWebStore, uninstallExtension } from "electron-chrome-web-store"

import type { ExtensionGrant, ExtensionMenuRequest } from "../shared/protocol"
import { parseManifest, type ParsedManifest } from "./extension-manifest"
import {
    emptyGrant,
    isRequestCovered,
    manifestGranted,
    mergeGrant,
    optionalScope,
    toPromptRequest,
} from "./extension-permissions"
import { bindExtensionStorageToSession, purgeExtensionStorage } from "./extension-storage"
import { readJsonFile } from "./persistence"
import type { StoreService } from "./state/store"
import {
    attachExtensionPopupPositioning,
    hideExtensionsPopup,
    isExtensionPopupView,
    openPermissionPrompt,
} from "./windows/overlays"
import { extensionShimPath, extensionStorageShimPath } from "./windows/paths"

/** Bridge between the domain store/views and the per-container extension systems. */
interface ExtensionDeps {
    readonly store: StoreService
    readonly getWindow: () => Electron.BrowserWindow | null
    readonly viewForTab: (tabId: string) => Electron.WebContentsView | undefined
    readonly ensureView: (tabId: string, url: string) => Electron.WebContentsView
    readonly tabIdForWebContents: (wc: WebContents) => string | null
}

let deps: ExtensionDeps | null = null
const configured = new Set<Session>()

/** Every session extensions are wired into (default + one per container). */
export const extensionSessions = (): Session[] => [...configured]

const runQuiet = async (effect: Effect.Effect<unknown, unknown>): Promise<void> => {
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

// --- consent (install + permissions.request)

/** Unpacked installs are keyed by source path until `loadExtension` reveals their id. */
const readUnpackedManifest = (extensionPath: string): ParsedManifest =>
    parseManifest(readJsonFile(path.join(extensionPath, "manifest.json")))

const consentFor = async (
    keys: readonly (string | undefined)[],
): Promise<Record<string, ExtensionGrant>> => {
    const store = deps?.store
    if (!store) return {}
    try {
        const ledger = await Effect.runPromise(store.extensionConsent)
        return Object.fromEntries(
            keys.flatMap((key) => (key && ledger[key] ? [[key, ledger[key]]] : [])),
        )
    } catch {
        return {}
    }
}

/** Manifest scope plus everything the user has accepted for this extension. */
const grantedScope = async (extension: {
    id: string
    path?: string
    manifest: ParsedManifest
}): Promise<ExtensionGrant> => {
    const held = await consentFor([extension.id, extension.path])
    const fromLedger = mergeGrant(
        held[extension.id] ?? emptyGrant(),
        (extension.path ? held[extension.path] : undefined) ?? emptyGrant(),
    )
    return mergeGrant(manifestGranted(extension.manifest), fromLedger)
}

/**
 * Dev-only install consent for an unpacked extension, keyed by its source path.
 * Concurrent asks for the same path share one prompt (every container session loads these).
 */
const installPrompts = new Map<string, Promise<boolean>>()

const ensureUnpackedConsent = (extensionPath: string): Promise<boolean> => {
    const pending = installPrompts.get(extensionPath)
    if (pending) return pending
    const ask = (async (): Promise<boolean> => {
        try {
            return await askUnpackedConsent(extensionPath)
        } finally {
            installPrompts.delete(extensionPath)
        }
    })()
    installPrompts.set(extensionPath, ask)
    return ask
}

const askUnpackedConsent = async (extensionPath: string): Promise<boolean> => {
    const d = deps
    if (!d) return false
    const manifest = readUnpackedManifest(extensionPath)
    const scope = manifestGranted(manifest)
    const held = await consentFor([extensionPath])
    if (held[extensionPath]) return true
    const allowed = await openPermissionPrompt(d.getWindow(), {
        kind: "install",
        id: extensionPath,
        name: manifest.name || path.basename(extensionPath),
        permissions: scope.permissions,
        origins: scope.origins,
        icon: null,
    })
    if (!allowed) return false
    await runQuiet(d.store.setExtensionConsent(extensionPath, scope))
    return true
}

// --- dev unpacked loader

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
                // Consent before load: a denied extension never runs, not even its worker.
                if (!(await ensureUnpackedConsent(extensionPath))) return
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
        await installChromeWebStore({ session: ses, beforeInstall: consentStoreInstall })
    } catch (error) {
        console.error("Failed to install Chrome Web Store support:", error)
    }
    if (!app.isPackaged) await loadUnpackedExtensions(ses)
    // Give Electron a beat to finish registering MV3 backgrounds after loadExtension.
    await new Promise((resolve) => setTimeout(resolve, 500))
    await startMv3Workers(ses)
}

/**
 * Install consent for Web Store installs.
 * Restored installs load without asking (Chrome parity: "already installed").
 * `manifest` stays `unknown` because the package's `chrome.runtime.Manifest`
 * type is not reachable from its public exports.
 */
interface StoreInstallDetails {
    id: string
    localizedName: string
    manifest: unknown
    icon?: { toDataURL?: () => string }
}

const consentStoreInstall = async (
    details: StoreInstallDetails,
): Promise<{ action: "allow" | "deny" }> => {
    const d = deps
    if (!d) return { action: "deny" }
    const manifest = parseManifest(details.manifest)
    const scope = manifestGranted(manifest)
    const allowed = await openPermissionPrompt(d.getWindow(), {
        kind: "install",
        id: details.id,
        name: details.localizedName || manifest.name || details.id,
        permissions: scope.permissions,
        origins: scope.origins,
        icon: details.icon?.toDataURL?.() ?? null,
    })
    if (allowed) await runQuiet(d.store.setExtensionConsent(details.id, scope))
    return { action: allowed ? "allow" : "deny" }
}

/** One ElectronChromeExtensions instance per session, created lazily. */
export const setupSessionExtensions = (ses: Session, loadSources = true): void => {
    if (configured.has(ses)) return
    if (!deps) throw new Error("initExtensions must run before container sessions are created")
    configured.add(ses)
    const d = deps

    // Extensions gate on the User Agent refuse to work under Electron;
    // match electron-browser-shell's Chrome-like UA.
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
        // chrome.permissions.request: Allow / Deny over the consent ledger.
        requestPermissions: async (extension, permissions) =>
            requestExtensionPermissions(extension, permissions),
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

    // Shared chrome.storage between container
    // (Firefox-style: containers isolate web storage, not extensions).
    // After both crx + shim so it owns the final `chrome.storage` binding.
    ses.registerPreloadScript({
        id: "arbor-ext-storage-frame",
        type: "frame",
        filePath: extensionStorageShimPath,
    })
    ses.registerPreloadScript({
        id: "arbor-ext-storage-service-worker",
        type: "service-worker",
        filePath: extensionStorageShimPath,
    })
    // SW ipcRenderer.invoke rides ServiceWorkerMain.ipc, not ipcMain.
    bindExtensionStorageToSession(ses)

    if (loadSources) void loadExtensionSources(ses)
}

/** Registers a view's webContents as an extension tab and marks it active. */
export const attachExtensionTab = (win: Electron.BrowserWindow, wc: WebContents): void => {
    const extensions = ElectronChromeExtensions.fromSession(wc.session)
    if (!extensions) return
    extensions.addTab(wc, win)
    extensions.selectTab(wc)
}

// --- permissions.request

/**
 * Scopes the user already accepted (manifest + consent ledger) come back `true`
 * without a prompt and the library applies the grant; anything else asks.
 * Asks the manifest never declared throw, like Chrome.
 */
const requestExtensionPermissions = async (
    extension: Electron.Extension,
    request: { permissions?: string[]; origins?: string[] },
): Promise<boolean> => {
    const d = deps
    if (!d) return false
    const manifest = parseManifest(extension.manifest)
    const held = await grantedScope({ id: extension.id, path: extension.path, manifest })
    if (isRequestCovered(request, held)) return true
    if (!isRequestCovered(request, optionalScope(manifest))) {
        // The library already rejects undeclared API names; this covers origins.
        throw new Error("Permissions request includes undeclared permission")
    }
    const allowed = await openPermissionPrompt(
        d.getWindow(),
        toPromptRequest(extension.id, extension.name, request),
    )
    if (!allowed) return false
    const prior = await consentFor([extension.id])
    await runQuiet(
        d.store.setExtensionConsent(
            extension.id,
            mergeGrant(prior[extension.id] ?? emptyGrant(), request),
        ),
    )
    return true
}

// --- extension context menu + uninstall

const findExtension = (extensionId: string): Electron.Extension | null => {
    for (const ses of extensionSessions()) {
        const extension = ses.extensions?.getExtension(extensionId)
        if (extension) return extension
    }
    return null
}

const optionsUrlFor = (extension: Electron.Extension): string | null => {
    const page = parseManifest(extension.manifest).optionsPage
    return page ? `${extension.url}/${page.replace(/^\//, "")}` : null
}

/** Native Options / Pin / Uninstall menu at the cursor. */
export const openExtensionMenu = async ({
    extensionId,
    screenX,
    screenY,
}: ExtensionMenuRequest): Promise<void> => {
    const d = deps
    if (!d) return
    const extension = findExtension(extensionId)
    if (!extension) return
    const snapshot = await Effect.runPromise(d.store.snapshot).catch(() => null)
    const pinned = snapshot?.pinnedExtensionIds.includes(extensionId) ?? false
    const optionsUrl = optionsUrlFor(extension)
    const menu = new Menu()
    menu.append(
        new MenuItem({
            label: "Options",
            enabled: optionsUrl !== null,
            click: () => {
                if (optionsUrl) void runQuiet(d.store.createTab(optionsUrl))
            },
        }),
    )
    menu.append(new MenuItem({ type: "separator" }))
    menu.append(
        new MenuItem({
            label: pinned ? "Unpin from toolbar" : "Pin to toolbar",
            click: () => {
                void runQuiet(
                    pinned
                        ? d.store.unpinExtension(extensionId)
                        : d.store.pinExtension(extensionId),
                )
            },
        }),
    )
    menu.append(new MenuItem({ type: "separator" }))
    menu.append(
        new MenuItem({
            label: "Uninstall",
            click: () => {
                void uninstallExtensionEverywhere(extensionId)
            },
        }),
    )
    menu.popup({ window: d.getWindow() ?? undefined, x: screenX, y: screenY })
}

/**
 * Full teardown: nothing about the extension survives.
 * The unpacked source folder is the user's code and is never deleted.
 */
export const uninstallExtensionEverywhere = async (extensionId: string): Promise<void> => {
    const d = deps
    if (!d) return
    // Unpacked installs keep a path-keyed consent record; read it before the extension goes.
    const sourcePath = findExtension(extensionId)?.path ?? null
    await Promise.all(
        extensionSessions().map(async (ses) => {
            try {
                await uninstallExtension(extensionId, { session: ses })
            } catch (error) {
                console.error(`[arbor] failed to uninstall ${extensionId}:`, error)
            }
        }),
    )
    purgeExtensionStorage(extensionId)
    await runQuiet(d.store.clearExtensionConsent(extensionId))
    if (sourcePath) await runQuiet(d.store.clearExtensionConsent(sourcePath))
    await runQuiet(d.store.unpinExtension(extensionId))
    hideExtensionsPopup()
}
