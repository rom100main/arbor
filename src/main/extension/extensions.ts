/**
 * The Extensions module: the extension stack of every session
 * (Web Store installs and updates, dev-only unpacked extensions, MV3 workers),
 * the `chrome.tabs` / `chrome.windows` callbacks, the extension menu and the uninstall teardown.
 */

import { existsSync, readdirSync } from "node:fs"
import path from "node:path"

import { Context, Effect, FiberSet, Latch, Layer, Option, Schedule, Schema } from "effect"
import {
    app,
    ipcMain,
    Menu,
    MenuItem,
    session,
    type BrowserWindow,
    type IpcMainInvokeEvent,
    type Session,
    type WebContents,
} from "electron"
import { ElectronChromeExtensions } from "electron-chrome-extensions"
import { installChromeWebStore, uninstallExtension } from "electron-chrome-web-store"

import type { ExtensionMenuRequest, PinnedActionInfo, TabId } from "../../shared/protocol"
import { SettingsStore } from "../settings"
import { BrowserStore } from "../state/store"
import { CurrentWindow } from "../windows/current-window"
import { isExtensionPopupView } from "../windows/overlays"
import { extensionShimPath, extensionStorageShimPath } from "../windows/paths"
import { makeActionInfo, manifestFor } from "./action"
import { makeConsent } from "./consent"
import { parseManifest } from "./manifest"
import { ExtensionStorage } from "./storage"

/** `loadExtension` or `installChromeWebStore` rejected. `source` is a path, or the Web Store. */
export class ExtensionLoadFailed extends Schema.TaggedError<ExtensionLoadFailed>()(
    "ExtensionLoadFailed",
    { source: Schema.String, cause: Schema.Defect() },
) {}

export class WorkerStartFailed extends Schema.TaggedError<WorkerStartFailed>()(
    "WorkerStartFailed",
    { extensionId: Schema.String, cause: Schema.Defect() },
) {}

export class UninstallFailed extends Schema.TaggedError<UninstallFailed>()("UninstallFailed", {
    extensionId: Schema.String,
    cause: Schema.Defect(),
}) {}

export interface ExtensionsService {
    readonly install: (session: Session) => Effect.Effect<void>
    /**
     * Completes once the session's sources are installed and its MV3 workers started. Never fails.
     * `chrome-extension://` loads fail with ERR_BLOCKED_BY_CLIENT before that.
     */
    readonly ready: (session: Session) => Effect.Effect<void>
    /** The session that runs `extensionId`: `preferred` when it has it. */
    readonly sessionFor: (
        extensionId: string,
        preferred: Option.Option<Session>,
    ) => Effect.Effect<Session>
    /** Register a tab's web contents as an extension tab, and mark it active. */
    readonly attachTab: (win: BrowserWindow, webContents: WebContents) => Effect.Effect<void>
    readonly actionInfo: (extensionId: string) => Effect.Effect<PinnedActionInfo>
    /** Native Options / Pin / Uninstall menu at the cursor. */
    readonly openMenu: (request: ExtensionMenuRequest) => Effect.Effect<void>
    /**
     * Full teardown in every session: files, icon, storage, consent, pin.
     * The unpacked source folder is the user's code and is never deleted.
     */
    readonly uninstall: (extensionId: string) => Effect.Effect<void>
}

const WEBSTORE_ORIGIN = "https://chromewebstore.google.com"
const UNINSTALL_CHANNEL = "chrome.management.uninstall"

/** Dev-only unpacked extensions: the folders of `./extensions` at the project root. */
const unpackedManifestDirs = (): string[] => {
    const candidates = [
        path.join(app.getAppPath(), "extensions"),
        path.join(process.cwd(), "extensions"),
    ]
    const dir = candidates.find((candidate) => existsSync(candidate))
    if (!dir) return []
    return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(dir, entry.name))
        .filter((extensionPath) => existsSync(path.join(extensionPath, "manifest.json")))
}

const loadExtension = (ses: Session, source: string, options?: Electron.LoadExtensionOptions) =>
    Effect.tryPromise({
        try: () => ses.extensions.loadExtension(source, options),
        catch: (cause) => new ExtensionLoadFailed({ source, cause }),
    })

/** The scope Chromium registers an extension's MV3 worker under its origin. */
const workerScope = (extensionId: string): string => `chrome-extension://${extensionId}/`

/**
 * MV3 service workers sometimes fail the first `startWorkerForScope` right after `loadExtension`
 * (electron-chrome-web-store swallows that rejection), so it is retried a few times before giving up.
 */
const startWorker = (
    ses: Session,
    extension: Electron.Extension,
): Effect.Effect<void, WorkerStartFailed> => {
    if (parseManifest(extension.manifest).serviceWorker === "") return Effect.void
    return Effect.tryPromise({
        try: () => ses.serviceWorkers.startWorkerForScope(workerScope(extension.id)),
        catch: (cause) => new WorkerStartFailed({ extensionId: extension.id, cause }),
    }).pipe(
        Effect.retry(
            Schedule.recurs(2).pipe(Schedule.addDelay(() => Effect.succeed("400 millis"))),
        ),
        Effect.andThen(Effect.logDebug("MV3 worker started")),
        Effect.asVoid,
    )
}

const optionsUrlFor = (extension: Electron.Extension): string | null => {
    const page = parseManifest(extension.manifest).optionsPage
    if (!page) return null
    return new URL(page.replace(/^\/+/, ""), extension.url).href
}

/** Extensions that gate on the User Agent refuse Electron: match electron-browser-shell's Chrome-like UA. */
const chromeUserAgent = (ses: Session): string =>
    ses
        .getUserAgent()
        .replace(/\sElectron\/\S+/, "")
        .replace(new RegExp(`\\s${app.getName()}/\\S+`), "")

export class Extensions extends Context.Service<Extensions, ExtensionsService>()(
    "arbor.Extensions",
) {
    static readonly layer = Layer.effect(
        Extensions,
        Effect.gen(function* () {
            const store = yield* BrowserStore
            const settings = yield* SettingsStore
            const storage = yield* ExtensionStorage
            const currentWindow = yield* CurrentWindow
            const consent = yield* makeConsent
            const runPromise = yield* FiberSet.makeRuntimePromise()
            const run = yield* FiberSet.makeRuntime()
            const actions = makeActionInfo()
            const sessions = new Map<Session, Latch.Latch>()

            const background = (effect: Effect.Effect<unknown, unknown>): void => {
                run(
                    effect.pipe(
                        Effect.catchCause((cause) =>
                            Effect.logDebug("Extension task failed", cause),
                        ),
                    ),
                )
            }

            const onTabOf = (
                webContents: WebContents,
                act: (tabId: TabId) => Effect.Effect<unknown, unknown>,
            ) =>
                Effect.flatMap(currentWindow.tabIdFor(webContents), (tabId) =>
                    tabId ? act(tabId) : Effect.void,
                )

            const findExtension = (extensionId: string): Electron.Extension | null => {
                for (const ses of sessions.keys()) {
                    const extension = ses.extensions?.getExtension(extensionId)
                    if (extension) return extension
                }
                return null
            }

            // --- uninstall

            const uninstall = (extensionId: string): Effect.Effect<void> =>
                Effect.gen(function* () {
                    // Unpacked installs keep a path-keyed consent record: read it before the extension goes.
                    const sourcePath = findExtension(extensionId)?.path ?? null
                    yield* Effect.forEach(
                        [...sessions.keys()],
                        (ses) =>
                            Effect.tryPromise({
                                try: () => uninstallExtension(extensionId, { session: ses }),
                                catch: (cause) => new UninstallFailed({ extensionId, cause }),
                            }).pipe(
                                Effect.catchCause((cause) =>
                                    Effect.logError("Failed to uninstall", cause),
                                ),
                            ),
                        { concurrency: "unbounded", discard: true },
                    )
                    actions.forget(extensionId)
                    yield* storage.purge(extensionId)
                    yield* store.clearExtensionConsent(extensionId).pipe(Effect.ignore)
                    if (sourcePath) {
                        yield* store.clearExtensionConsent(sourcePath).pipe(Effect.ignore)
                    }
                    yield* settings.unpin(extensionId)
                    const overlays = yield* currentWindow.overlays
                    overlays.closeExtensions()
                }).pipe(
                    Effect.catchCause((cause) =>
                        Effect.logError("Uninstall workflow failed", cause),
                    ),
                    Effect.annotateLogs({ extensionId }),
                )

            /** A Web Store "Remove": only the Web Store may ask, and it gets the full teardown. */
            const webStoreUninstall = (event: IpcMainInvokeEvent, extensionId: unknown) =>
                Effect.gen(function* () {
                    const origin = event.senderFrame?.origin ?? ""
                    if (!origin.startsWith(WEBSTORE_ORIGIN)) return "unknown_error"
                    if (typeof extensionId !== "string" || extensionId.length === 0) {
                        return "unknown_error"
                    }
                    yield* uninstall(extensionId)
                    const sender = event.sender
                    queueMicrotask(() => {
                        if (!sender.isDestroyed()) {
                            sender.send("chrome.management.onUninstalled", extensionId)
                        }
                    })
                    return "success"
                })

            /**
             * `electron-chrome-web-store` handles `chrome.management.uninstall` itself
             * and only removes the extension, leaving pins, storage and consent behind.
             * It registers its handler once per session, so this one is put back after each.
             */
            const routeWebStoreUninstall = Effect.sync(() => {
                ipcMain.removeHandler(UNINSTALL_CHANNEL)
                ipcMain.handle(UNINSTALL_CHANNEL, (event, extensionId: unknown) =>
                    runPromise(webStoreUninstall(event, extensionId)),
                )
            })
            yield* Effect.addFinalizer(() =>
                Effect.sync(() => ipcMain.removeHandler(UNINSTALL_CHANNEL)),
            )

            // --- sources

            /** A new extension (store install, unpacked drop) goes to every session, as a relaunch would. */
            const loadEverywhere = (source: Session, extension: Electron.Extension) =>
                Effect.forEach(
                    [...sessions.keys()].filter((target) => target !== source),
                    (target) =>
                        // Loaded there already (startup restore or a racing copy): nothing to do.
                        target.extensions?.getExtension(extension.id)
                            ? Effect.void
                            : loadExtension(target, extension.path).pipe(
                                  Effect.andThen(startWorker(target, extension)),
                                  Effect.catchCause((cause) =>
                                      Effect.logError("Failed to load extension everywhere", cause),
                                  ),
                              ),
                    { concurrency: "unbounded", discard: true },
                ).pipe(Effect.annotateLogs({ extensionId: extension.id }))

            const loadUnpacked = (ses: Session) =>
                Effect.forEach(
                    unpackedManifestDirs(),
                    (extensionPath) =>
                        // Consent before load: a denied extension never runs, not even its worker.
                        consent.unpackedConsent(extensionPath).pipe(
                            Effect.andThen((allowed) =>
                                allowed
                                    ? loadExtension(ses, extensionPath, { allowFileAccess: true })
                                    : Effect.void,
                            ),
                            Effect.catchCause((cause) =>
                                Effect.logError("Failed to load extension", cause),
                            ),
                            Effect.annotateLogs({ extension: path.basename(extensionPath) }),
                        ),
                    { concurrency: "unbounded", discard: true },
                )

            const startWorkers = (ses: Session) =>
                Effect.forEach(
                    ses.extensions?.getAllExtensions() ?? [],
                    (extension) =>
                        startWorker(ses, extension).pipe(
                            Effect.catchCause((cause) =>
                                Effect.logError("Failed to start worker", cause),
                            ),
                            Effect.annotateLogs({ extensionId: extension.id }),
                        ),
                    { concurrency: "unbounded", discard: true },
                )

            /**
             * Pins are restored from settings: drop any whose extension is gone.
             * Covers removals Arbor never saw (files deleted by hand, older builds).
             */
            const pruneMissingPins = Effect.gen(function* () {
                const { pinnedExtensionIds } = yield* settings.get
                yield* Effect.forEach(
                    pinnedExtensionIds.filter(
                        (extensionId) =>
                            findExtension(extensionId) === null &&
                            manifestFor(extensionId) === null,
                    ),
                    settings.unpin,
                    { discard: true },
                )
            })

            const loadSources = (ses: Session) =>
                // Web Store installs, update checks run per session over the shared store dir.
                Effect.tryPromise({
                    try: () =>
                        installChromeWebStore({
                            session: ses,
                            beforeInstall: (details) =>
                                runPromise(
                                    Effect.map(consent.installConsent(details), (action) => ({
                                        action,
                                    })),
                                ),
                        }),
                    catch: (cause) =>
                        new ExtensionLoadFailed({ source: "Chrome Web Store", cause }),
                }).pipe(
                    Effect.catchCause((cause) =>
                        Effect.logError("Failed to install Chrome Web Store support", cause),
                    ),
                    // The library registers its uninstall handler before it can fail: replace it either way.
                    Effect.andThen(routeWebStoreUninstall),
                    Effect.andThen(app.isPackaged ? Effect.void : loadUnpacked(ses)),
                    // NOTE: Give Electron a beat to finish registering MV3 backgrounds after loadExtension.
                    Effect.andThen(Effect.sleep("500 millis")),
                    Effect.andThen(startWorkers(ses)),
                    Effect.andThen(pruneMissingPins),
                )

            // --- one session

            const libraryFor = (ses: Session): ElectronChromeExtensions => {
                const extensions: ElectronChromeExtensions = new ElectronChromeExtensions({
                    license: "GPL-3.0",
                    session: ses,
                    // chrome.tabs.create: a new active tab, with its view made now.
                    createTab: (details) => {
                        const url = details.url ?? extensions.getURLOverrides().newtab
                        return runPromise(
                            Effect.gen(function* () {
                                const tabId = yield* store.createTab(url)
                                const view = yield* currentWindow.ensureTabView(tabId)
                                const win = yield* currentWindow.native
                                const created: [WebContents, BrowserWindow] = [
                                    view.webContents,
                                    win,
                                ]
                                return created
                            }).pipe(
                                Effect.tapCause((cause) =>
                                    Effect.logError(
                                        `Extension tabs.create failed url=${url}`,
                                        cause,
                                    ),
                                ),
                            ),
                        )
                    },
                    // chrome.tabs.update({ active: true }).
                    selectTab: (tab) => {
                        background(onTabOf(tab, store.selectTab))
                    },
                    // chrome.tabs.remove.
                    removeTab: (tab) => {
                        background(onTabOf(tab, store.closeTab))
                    },
                    // Single window: chrome.windows.create becomes a new active tab.
                    createWindow: (details) => {
                        const url = Array.isArray(details.url) ? details.url[0] : details.url
                        return runPromise(
                            Effect.andThen(store.createTab(url), currentWindow.native),
                        )
                    },
                    // chrome.permissions.request: Allow / Deny over the consent ledger.
                    // An ask the manifest never declared rejects, like Chrome.
                    requestPermissions: (extension, permissions) =>
                        runPromise(consent.permissionsRequest(extension, permissions)),
                })
                return extensions
            }

            const install = (ses: Session): Effect.Effect<void> =>
                Effect.suspend(() => {
                    if (sessions.has(ses)) return Effect.void
                    const ready = Latch.makeUnsafe(false)
                    sessions.set(ses, ready)
                    ses.setUserAgent(chromeUserAgent(ses))
                    const library = libraryFor(ses)

                    // Re-anchor action popups above the toolbar button, at a readable minimum size.
                    // Their window.open fallback opens a tab.
                    library.on("browser-action-popup-created", (...popupEvent: unknown[]) => {
                        const popup = popupEvent[0]
                        if (!isExtensionPopupView(popup)) return
                        background(
                            Effect.map(currentWindow.overlays, (overlays) =>
                                overlays.positionLibraryPopup(popup, (url) => {
                                    background(store.createTab(url))
                                }),
                            ),
                        )
                    })
                    ses.extensions?.on("extension-loaded", (_event, extension) => {
                        background(loadEverywhere(ses, extension))
                    })

                    // Stubs for chrome.* events the library lacks (MV3 background scripts crash without them).
                    // Registered after the crx preloads, so they patch on top.
                    // Then `arbor-ext-storage` replaces `chrome.storage` with one store shared by every Container
                    // (Electron keeps one per session, so per Container).
                    // It runs last, so no other preload replaces it after.
                    for (const [id, filePath] of [
                        ["arbor-crx-shim", extensionShimPath],
                        ["arbor-ext-storage", extensionStorageShimPath],
                    ] as const) {
                        ses.registerPreloadScript({ id: `${id}-frame`, type: "frame", filePath })
                        ses.registerPreloadScript({
                            id: `${id}-service-worker`,
                            type: "service-worker",
                            filePath,
                        })
                    }

                    return storage.bind(ses).pipe(
                        Effect.andThen(
                            Effect.sync(() => {
                                run(
                                    loadSources(ses).pipe(
                                        Effect.catchCause((cause) =>
                                            Effect.logError(
                                                "Failed to load extension sources",
                                                cause,
                                            ),
                                        ),
                                        Effect.ensuring(ready.open),
                                    ),
                                )
                            }),
                        ),
                    )
                })

            // --- menu

            const openMenu = ({ extensionId, screenX, screenY }: ExtensionMenuRequest) =>
                Effect.gen(function* () {
                    const extension = findExtension(extensionId)
                    const pinned = (yield* settings.get).pinnedExtensionIds.includes(extensionId)
                    const window = yield* currentWindow.native
                    const menu = new Menu()
                    const unpin = new MenuItem({
                        label: "Unpin from toolbar",
                        click: () => background(settings.unpin(extensionId)),
                    })
                    if (!extension) {
                        // A pin whose extension is gone can only be unpinned.
                        if (!pinned) return
                        menu.append(unpin)
                        menu.popup({ window, x: screenX, y: screenY })
                        return
                    }
                    const optionsUrl = optionsUrlFor(extension)
                    menu.append(
                        new MenuItem({
                            label: "Options",
                            enabled: optionsUrl !== null,
                            click: () => {
                                if (optionsUrl) background(store.createTab(optionsUrl))
                            },
                        }),
                    )
                    menu.append(new MenuItem({ type: "separator" }))
                    menu.append(
                        pinned
                            ? unpin
                            : new MenuItem({
                                  label: "Pin to toolbar",
                                  click: () => background(settings.pin(extensionId)),
                              }),
                    )
                    menu.append(new MenuItem({ type: "separator" }))
                    menu.append(
                        new MenuItem({
                            label: "Uninstall",
                            click: () => background(uninstall(extensionId)),
                        }),
                    )
                    menu.popup({ window, x: screenX, y: screenY })
                })

            // The default session hosts <browser-action-list> (the shell renderer)
            // and the shared crx IPC handler from startup,
            // so the action list never races a Container session's creation.
            ElectronChromeExtensions.handleCRXProtocol(session.defaultSession)
            yield* install(session.defaultSession)

            return {
                install,
                ready: (ses) => {
                    const ready = sessions.get(ses)
                    return ready ? ready.await : Effect.void
                },
                sessionFor: (extensionId, preferred) =>
                    Effect.sync(() => {
                        if (Option.isSome(preferred)) {
                            if (preferred.value.extensions?.getExtension(extensionId)) {
                                return preferred.value
                            }
                        }
                        const fallback = session.defaultSession
                        if (fallback.extensions?.getExtension(extensionId)) return fallback
                        return (
                            [...sessions.keys()].find((ses) =>
                                ses.extensions?.getExtension(extensionId),
                            ) ?? fallback
                        )
                    }),
                attachTab: (win, webContents) =>
                    Effect.sync(() => {
                        const library = ElectronChromeExtensions.fromSession(webContents.session)
                        if (!library) return
                        library.addTab(webContents, win)
                        library.selectTab(webContents)
                    }),
                actionInfo: actions.info,
                openMenu,
                uninstall,
            }
        }),
    )
}
