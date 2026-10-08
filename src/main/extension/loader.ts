import { existsSync, readdirSync } from "node:fs"
import path from "node:path"

import { Deferred, Effect, Schedule } from "effect"
import { app, ipcMain, Menu, MenuItem, session, type Session, type WebContents } from "electron"
import { ElectronChromeExtensions } from "electron-chrome-extensions"
import { installChromeWebStore, uninstallExtension } from "electron-chrome-web-store"

import type { ExtensionGrant, ExtensionMenuRequest } from "../../shared/protocol"
import { runBackground } from "../exec"
import { readJsonFile } from "../persistence"
import type { SettingsStore } from "../settings"
import type { StoreService } from "../state/store"
import {
    attachExtensionPopupPositioning,
    hideExtensionsPopup,
    isExtensionPopupView,
    openPermissionPrompt,
} from "../windows/overlays"
import { extensionShimPath, extensionStorageShimPath } from "../windows/paths"
import { forgetExtensionIcon, manifestFor } from "./action"
import { parseManifest, type ParsedManifest } from "./manifest"
import {
    emptyGrant,
    isRequestCovered,
    manifestGranted,
    mergeGrant,
    optionalScope,
    toPromptRequest,
} from "./permissions"
import { bindExtensionStorageToSession, purgeExtensionStorage } from "./storage"

/** Bridge between the domain store/views and the per-container extension systems. */
interface ExtensionDeps {
    readonly store: StoreService
    readonly settings: SettingsStore
    readonly getWindow: () => Electron.BrowserWindow | null
    readonly viewForTab: (tabId: string) => Electron.WebContentsView | undefined
    readonly ensureView: (tabId: string, url: string) => Electron.WebContentsView
    readonly tabIdForWebContents: (wc: WebContents) => string | null
}

let deps: ExtensionDeps | null = null
const configured = new Set<Session>()

/** Every session extensions are wired into (default + one per container). */
export const extensionSessions = (): Session[] => [...configured]

export const sessionForExtension = (extensionId: string): Session => {
    const fallback = session.defaultSession
    if (fallback.extensions?.getExtension(extensionId)) return fallback
    return extensionSessions().find((ses) => ses.extensions?.getExtension(extensionId)) ?? fallback
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
    setupSessionExtensions(session.defaultSession)
}

// --- consent (install + permissions.request)

/** Unpacked installs are keyed by source path until `loadExtension` reveals their id. */
const readUnpackedManifest = (extensionPath: string): ParsedManifest =>
    parseManifest(readJsonFile(path.join(extensionPath, "manifest.json")))

const consentFor = (
    keys: readonly (string | undefined)[],
): Effect.Effect<Record<string, ExtensionGrant>> => {
    const ledgerEffect: Effect.Effect<Record<string, ExtensionGrant>> =
        deps?.store?.extensionConsent ?? Effect.succeed({})
    return ledgerEffect.pipe(
        Effect.map((ledger) =>
            Object.fromEntries(
                keys.flatMap((key) => (key && ledger[key] ? [[key, ledger[key]]] : [])),
            ),
        ),
    )
}

/** Manifest scope plus everything the user has accepted for this extension. */
const grantedScope = (extension: {
    id: string
    path?: string
    manifest: ParsedManifest
}): Effect.Effect<ExtensionGrant> =>
    consentFor([extension.id, extension.path]).pipe(
        Effect.map((held) =>
            mergeGrant(
                manifestGranted(extension.manifest),
                mergeGrant(
                    held[extension.id] ?? emptyGrant(),
                    (extension.path ? held[extension.path] : undefined) ?? emptyGrant(),
                ),
            ),
        ),
    )

/**
 * Dev-only install consent for an unpacked extension, keyed by its source path.
 * Concurrent asks for the same path share one prompt (every container session loads these).
 */
const installPrompts = new Map<string, Deferred.Deferred<boolean>>()

const ensureUnpackedConsent = (extensionPath: string): Effect.Effect<boolean> =>
    Effect.gen(function* () {
        const pending = installPrompts.get(extensionPath)
        if (pending) return yield* Deferred.await(pending)
        const deferred = yield* Deferred.make<boolean>()
        installPrompts.set(extensionPath, deferred)
        return yield* askUnpackedConsent(extensionPath).pipe(
            Effect.catchAllCause(() => Effect.succeed(false)),
            Effect.tap((allowed) => Deferred.succeed(deferred, allowed)),
            // Interruption still settles waiters (`false`) before the entry is dropped.
            Effect.ensuring(
                Effect.sync(() => installPrompts.delete(extensionPath)).pipe(
                    Effect.zipRight(Deferred.succeed(deferred, false)),
                ),
            ),
        )
    })

const askUnpackedConsent = (extensionPath: string): Effect.Effect<boolean, unknown> =>
    Effect.gen(function* () {
        const d = deps
        if (!d) return false
        const manifest = readUnpackedManifest(extensionPath)
        const scope = manifestGranted(manifest)
        const held = yield* consentFor([extensionPath])
        if (held[extensionPath]) return true
        const allowed = yield* openPermissionPrompt(d.getWindow(), {
            kind: "install",
            id: extensionPath,
            name: manifest.name || path.basename(extensionPath),
            permissions: scope.permissions,
            origins: scope.origins,
            icon: null,
        })
        if (!allowed) return false
        yield* d.store.setExtensionConsent(extensionPath, scope).pipe(Effect.ignore)
        return true
    })

// --- dev unpacked loader

/** Dev-only auto-loader for unpacked extensions in ./extensions at the project root. */
const unpackedManifestDirs = (): string[] => {
    const candidates = [
        path.join(app.getAppPath(), "extensions"),
        path.join(process.cwd(), "extensions"),
    ]
    const dir = candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
    return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(dir, entry.name))
        .filter((extensionPath) => existsSync(path.join(extensionPath, "manifest.json")))
}

const loadUnpackedExtensions = (ses: Session): Effect.Effect<void> =>
    Effect.forEach(
        unpackedManifestDirs(),
        (extensionPath) =>
            // Consent before load: a denied extension never runs, not even its worker.
            ensureUnpackedConsent(extensionPath).pipe(
                Effect.andThen((allowed) =>
                    allowed
                        ? Effect.tryPromise(() =>
                              ses.extensions.loadExtension(extensionPath, {
                                  allowFileAccess: true,
                              }),
                          )
                        : Effect.void,
                ),
                Effect.catchAllCause((cause) =>
                    Effect.logError(
                        `Failed to load extension ${path.basename(extensionPath)}`,
                        cause,
                    ),
                ),
            ),
        { concurrency: "unbounded" },
    )

/**
 * MV3 service workers sometimes fail the first `startWorkerForScope` right after loadExtension
 * (electron-chrome-web-store swallows that rejection).
 * Try each scope spelling, then retry a few times before giving up.
 */
const startWorkerWithRetry = (
    ses: Session,
    scopes: readonly string[],
    attempts = 3,
): Effect.Effect<void, unknown> =>
    Effect.firstSuccessOf(
        scopes.map((scope) =>
            Effect.tryPromise(() => ses.serviceWorkers.startWorkerForScope(scope)),
        ),
    ).pipe(Effect.retry(Schedule.recurs(attempts - 1).pipe(Schedule.addDelay(() => "400 millis"))))

/** Scopes an MV3 background worker runs under; both spellings seen in the wild. */
const workerScopes = (extensionId: string): readonly string[] => [
    // electron-chrome-web-store uses no trailing slash; the event bus uses one.
    `chrome-extension://${extensionId}/`,
    `chrome-extension://${extensionId}`,
]

const hasMv3Worker = (extension: Electron.Extension): boolean => {
    if (extension.manifest.manifest_version !== 3) return false
    const background: unknown = extension.manifest.background
    if (typeof background !== "object" || background === null) return false
    if (!("service_worker" in background)) return false
    const worker: unknown = background.service_worker
    return typeof worker === "string" && worker.length > 0
}

const startMv3WorkerFor = (
    ses: Session,
    extension: Electron.Extension,
    attempts = 3,
): Effect.Effect<void, unknown> =>
    hasMv3Worker(extension)
        ? startWorkerWithRetry(ses, workerScopes(extension.id), attempts).pipe(
              Effect.tap(() => Effect.logDebug(`MV3 worker started for ${extension.id}`)),
          )
        : Effect.void

const startMv3Workers = (ses: Session, attempts = 3): Effect.Effect<void> =>
    Effect.forEach(
        ses.extensions?.getAllExtensions() ?? [],
        (extension) =>
            startMv3WorkerFor(ses, extension, attempts).pipe(
                Effect.catchAllCause((cause) =>
                    Effect.logError(`Failed to start worker for extension ${extension.id}`, cause),
                ),
            ),
        { concurrency: "unbounded" },
    )

const loadExtensionEverywhere = (source: Session, extension: Electron.Extension): void => {
    for (const target of configured) {
        if (target === source) continue
        void Effect.runPromise(
            Effect.gen(function* () {
                const api = target.extensions
                // Loaded here already (startup restore or a racing copy): nothing to do.
                if (!api || api.getExtension(extension.id)) return
                yield* Effect.tryPromise(() => api.loadExtension(extension.path))
                yield* startMv3WorkerFor(target, extension)
            }).pipe(
                Effect.catchAllCause((cause) =>
                    Effect.logError(`Failed to load extension ${extension.id} everywhere`, cause),
                ),
            ),
        )
    }
}

const loadExtensionSources = (ses: Session): Effect.Effect<void> =>
    // Web Store installs; update checks run per session over the shared store dir.
    Effect.tryPromise(() =>
        installChromeWebStore({ session: ses, beforeInstall: consentStoreInstall }),
    ).pipe(
        Effect.catchAllCause((cause) =>
            Effect.logError("Failed to install Chrome Web Store support", cause),
        ),
        // The library registers `chrome.management.uninstall` before it can fail;
        // replace it either way so a Web Store "Remove" shares Arbor's teardown.
        Effect.zipRight(Effect.sync(routeWebStoreUninstall)),
        Effect.zipRight(app.isPackaged ? Effect.void : loadUnpackedExtensions(ses)),
        // Give Electron a beat to finish registering MV3 backgrounds after loadExtension.
        Effect.zipRight(Effect.sleep("500 millis")),
        Effect.zipRight(startMv3Workers(ses)),
        Effect.zipRight(Effect.sync(pruneMissingPins)),
    )

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

const consentStoreInstall = (details: StoreInstallDetails): Promise<{ action: "allow" | "deny" }> =>
    Effect.runPromise(
        Effect.gen(function* () {
            const d = deps
            if (!d) return { action: "deny" as const }
            const manifest = parseManifest(details.manifest)
            const scope = manifestGranted(manifest)
            const allowed = yield* openPermissionPrompt(d.getWindow(), {
                kind: "install",
                id: details.id,
                name: details.localizedName || manifest.name || details.id,
                permissions: scope.permissions,
                origins: scope.origins,
                icon: details.icon?.toDataURL?.() ?? null,
            })
            if (allowed) yield* d.store.setExtensionConsent(details.id, scope).pipe(Effect.ignore)
            return { action: allowed ? ("allow" as const) : ("deny" as const) }
        }),
    )

/**
 * Resolves once a session's extension sources are installed and its MV3 workers are running.
 * `chrome-extension://` navigations fail with ERR_BLOCKED_BY_CLIENT until then, so tab loads await this.
 */
const sourcesReady = new WeakMap<Session, Deferred.Deferred<void>>()

/** Never rejects: install failures are already logged by `loadExtensionSources`. */
export const extensionsReady = (ses: Session): Promise<void> => {
    const ready = sourcesReady.get(ses)
    return ready ? Effect.runPromise(Deferred.await(ready)) : Promise.resolve()
}

/** One ElectronChromeExtensions instance per session, created lazily. */
export const setupSessionExtensions = (ses: Session): void => {
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
            if (tabId) void runBackground(d.store.selectTab(tabId))
        },
        // chrome.tabs.remove.
        removeTab: (tab) => {
            const tabId = d.tabIdForWebContents(tab)
            if (tabId) void runBackground(d.store.closeTab(tabId))
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
            void runBackground(d.store.createTab(url))
        })
    })

    // Load new extensions (store installs, unpacked drops) into every session,
    // so the running app matches what a relaunch would restore.
    ses.extensions?.on("extension-loaded", (_event, extension) => {
        loadExtensionEverywhere(ses, extension)
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

    const ready = Effect.runSync(Deferred.make<void>())
    sourcesReady.set(ses, ready)
    void Effect.runPromise(
        loadExtensionSources(ses).pipe(
            Effect.catchAllCause((cause) =>
                Effect.logError("Failed to load extension sources", cause),
            ),
            Effect.ensuring(Deferred.succeed(ready, undefined)),
        ),
    )
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
const requestExtensionPermissions = (
    extension: Electron.Extension,
    request: { permissions?: string[]; origins?: string[] },
): Promise<boolean> =>
    Effect.runPromise(
        Effect.gen(function* () {
            const d = deps
            if (!d) return false
            const manifest = parseManifest(extension.manifest)
            const held = yield* grantedScope({ id: extension.id, path: extension.path, manifest })
            if (isRequestCovered(request, held)) return true
            if (!isRequestCovered(request, optionalScope(manifest))) {
                // The library already rejects undeclared API names; this covers origins.
                return yield* Effect.fail(
                    new Error("Permissions request includes undeclared permission"),
                )
            }
            const allowed = yield* openPermissionPrompt(
                d.getWindow(),
                toPromptRequest(extension.id, extension.name, request),
            )
            if (!allowed) return false
            const prior = yield* consentFor([extension.id])
            yield* d.store
                .setExtensionConsent(
                    extension.id,
                    mergeGrant(prior[extension.id] ?? emptyGrant(), request),
                )
                .pipe(Effect.ignore)
            return true
        }),
    )

// --- extension context menu + uninstall

const findExtension = (extensionId: string): Electron.Extension | null => {
    for (const ses of extensionSessions()) {
        const extension = ses.extensions?.getExtension(extensionId)
        if (extension) return extension
    }
    return null
}

/**
 * Pins are restored from settings; drop any whose extension is gone.
 * Covers removals Arbor never saw (files deleted by hand, older builds).
 */
const pruneMissingPins = (): void => {
    const d = deps
    if (!d) return
    for (const extensionId of [...d.settings.get().pinnedExtensionIds]) {
        const live = findExtension(extensionId) !== null || manifestFor(extensionId) !== null
        if (!live) d.settings.unpinExtension(extensionId)
    }
}

const WEBSTORE_ORIGIN = "https://chromewebstore.google.com"

/**
 * `electron-chrome-web-store` handles `chrome.management.uninstall` itself
 * and only removes the extension, leaving pins (and storage, and consent) behind.
 * Swap in a handler that routes through the full teardown.
 * Idempotent: the library registers its handler once per session, we re-replace after each.
 */
const routeWebStoreUninstall = (): void => {
    ipcMain.removeHandler("chrome.management.uninstall")
    ipcMain.handle("chrome.management.uninstall", async (event, extensionId: unknown) => {
        const origin = event.senderFrame?.origin ?? ""
        if (!origin.startsWith(WEBSTORE_ORIGIN)) return "unknown_error"
        if (typeof extensionId !== "string" || extensionId.length === 0) return "unknown_error"
        await uninstallExtensionEverywhere(extensionId)
        const sender = event.sender
        queueMicrotask(() => {
            if (!sender.isDestroyed()) sender.send("chrome.management.onUninstalled", extensionId)
        })
        return "success"
    })
}

const optionsUrlFor = (extension: Electron.Extension): string | null => {
    const page = parseManifest(extension.manifest).optionsPage
    if (!page) return null
    return new URL(page.replace(/^\/+/, ""), extension.url).href
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
    const pinned = d.settings.get().pinnedExtensionIds.includes(extensionId)
    if (!extension) {
        if (!pinned) return
        const ghostMenu = new Menu()
        ghostMenu.append(
            new MenuItem({
                label: "Unpin from toolbar",
                click: () => d.settings.unpinExtension(extensionId),
            }),
        )
        ghostMenu.popup({ window: d.getWindow() ?? undefined, x: screenX, y: screenY })
        return
    }
    const optionsUrl = optionsUrlFor(extension)
    const menu = new Menu()
    menu.append(
        new MenuItem({
            label: "Options",
            enabled: optionsUrl !== null,
            click: () => {
                if (optionsUrl) void runBackground(d.store.createTab(optionsUrl))
            },
        }),
    )
    menu.append(new MenuItem({ type: "separator" }))
    menu.append(
        new MenuItem({
            label: pinned ? "Unpin from toolbar" : "Pin to toolbar",
            click: () => {
                if (pinned) d.settings.unpinExtension(extensionId)
                else d.settings.pinExtension(extensionId)
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
export const uninstallExtensionEverywhere = (extensionId: string): Promise<void> =>
    Effect.runPromise(
        Effect.gen(function* () {
            const d = deps
            if (!d) return
            // Unpacked installs keep a path-keyed consent record; read it before the extension goes.
            const sourcePath = findExtension(extensionId)?.path ?? null
            yield* Effect.forEach(
                extensionSessions(),
                (ses) =>
                    Effect.tryPromise(() => uninstallExtension(extensionId, { session: ses })).pipe(
                        Effect.catchAllCause((cause) =>
                            Effect.logError(`Failed to uninstall ${extensionId}`, cause),
                        ),
                    ),
                { concurrency: "unbounded" },
            )
            forgetExtensionIcon(extensionId)
            purgeExtensionStorage(extensionId)
            yield* d.store.clearExtensionConsent(extensionId).pipe(Effect.ignore)
            if (sourcePath) {
                yield* d.store.clearExtensionConsent(sourcePath).pipe(Effect.ignore)
            }
            d.settings.unpinExtension(extensionId)
            hideExtensionsPopup()
        }).pipe(
            Effect.catchAllCause((cause) => Effect.logError("Uninstall workflow failed", cause)),
        ),
    )
