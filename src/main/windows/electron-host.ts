/** The Electron side of the main window: the window, the shell view, the tab views and their sessions. */

import { Deferred, Effect, FiberSet, Option, Queue, Schema, Stream } from "effect"
import {
    BrowserWindow,
    Menu,
    app,
    WebContentsView,
    nativeTheme,
    session,
    type Session,
} from "electron"
import { buildChromeContextMenu } from "electron-chrome-context-menu"

import { containerPartition } from "../../shared/constants"
import type { ContainerId } from "../../shared/protocol"
import type { Settings } from "../../shared/settings"
import { Extensions } from "../extension/extensions"
import { IpcPush, makePusher } from "../ipc/router"
import { SettingsStore } from "../settings"
import {
    LoadFailed,
    type SessionKey,
    type ViewEvent,
    type ViewHandle,
    type WindowHandle,
    type WindowHostService,
} from "./host"
import { internalSession, registerInternalPages } from "./internal-pages"
import { menuTemplate } from "./menu"
import { createOverlays } from "./overlays"
import { appIconPath, loadRenderer } from "./paths"
import { createShell } from "./shell-view"

/** The window background behind the renderer, so a dark theme does not flash white before first paint. */
const windowBackground = (settings: Settings): string => {
    const dark =
        settings.theme === "system" ? nativeTheme.shouldUseDarkColors : settings.theme === "dark"
    return dark ? "#111315" : "#ffffff"
}

/** Each Container gets their own session, so cookies, storage and extensions stay apart. */
export const sessionForContainer = (containerId: ContainerId): Session =>
    session.fromPartition(containerPartition(containerId))

/** Electron rejects `loadURL` with an Error carrying Chromium's `errno`. */
const errnoOf = Schema.decodeUnknownOption(Schema.Struct({ errno: Schema.Number }))

/** Chromium's net error for a load replaced by another navigation: not a failure. */
const ERR_ABORTED = -3

const loadUrl = (view: WebContentsView, url: string): Effect.Effect<void, LoadFailed> =>
    Effect.tryPromise({
        try: () => view.webContents.loadURL(url),
        catch: (error) =>
            new LoadFailed({
                url,
                errno: Option.match(errnoOf(error), { onNone: () => 0, onSome: (e) => e.errno }),
            }),
    }).pipe(
        Effect.catchIf(
            (error) => error.errno === ERR_ABORTED,
            () => Effect.void,
        ),
    )

/** The window, the shell, the tab views and their sessions, the menu: everything the WindowManager drives in Electron. */
export const makeWindowHost: Effect.Effect<
    WindowHostService,
    never,
    SettingsStore | IpcPush | Extensions
> = Effect.gen(function* () {
    const settingsStore = yield* SettingsStore
    const pushes = yield* IpcPush
    const extensions = yield* Extensions
    // arbor:// internal pages: their own session, so only they carry the preload bridge.
    registerInternalPages()

    /** A Container's session gets the extension stack before any page uses it. */
    const sessionFor = (key: SessionKey): Effect.Effect<Session> => {
        if (key.kind === "internal") return Effect.succeed(internalSession())
        const partition = sessionForContainer(key.containerId)
        return Effect.as(extensions.install(partition), partition)
    }

    const open = Effect.gen(function* () {
        const run = yield* FiberSet.makeRuntime()
        let settings = yield* settingsStore.get
        const closed = yield* Deferred.make<void>()
        const events = yield* Queue.unbounded<ViewEvent>()
        const offer = (event: ViewEvent): void => {
            Queue.offerUnsafe(events, event)
        }

        const win = yield* Effect.acquireRelease(
            Effect.sync(() => {
                const created = new BrowserWindow({
                    width: 1440,
                    height: 900,
                    minWidth: 720,
                    minHeight: 480,
                    show: false,
                    title: "Arbor",
                    // macOS and Windows take the icon from the app bundle and the .exe.
                    icon: process.platform === "linux" ? appIconPath : undefined,
                    backgroundColor: windowBackground(settings),
                })
                created.on("closed", () => Deferred.doneUnsafe(closed, Effect.void))
                return created
            }),
            (created) =>
                Effect.sync(() => {
                    if (!created.isDestroyed()) created.destroy()
                }),
        )

        const overlays = createOverlays(win, yield* makePusher(pushes))
        yield* Effect.addFinalizer(() => Effect.sync(() => overlays.closeAll()))

        const shell = createShell(
            win,
            () => settings,
            (edge) => {
                run(pushes.push("shellEdge", edge))
            },
        )
        yield* pushes.attach(shell.view.webContents)

        const views = new Map<ViewHandle, WebContentsView>()
        const viewOf = (handle: ViewHandle): WebContentsView | undefined => views.get(handle)

        const layoutViews = (): void => {
            if (win.isDestroyed()) return
            const { width, height } = win.getContentBounds()
            const insets = shell.insets()
            for (const view of views.values()) {
                if (!win.contentView.children.includes(view)) continue
                view.setBounds({
                    x: insets.left,
                    y: 0,
                    width: Math.max(0, width - insets.left),
                    height: Math.max(0, height - insets.bottom),
                })
            }
        }

        win.on("resize", () => {
            shell.layout()
            layoutViews()
        })
        // Showing or hiding a bar changes how much of the window the page gets.
        yield* settingsStore.changes.pipe(
            Stream.runForEach((next) =>
                Effect.sync(() => {
                    settings = next
                    layoutViews()
                }),
            ),
            Effect.forkScoped,
        )
        // Tab views close with the window.
        yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
                for (const view of views.values()) {
                    if (!view.webContents.isDestroyed()) view.webContents.close()
                }
                views.clear()
            }),
        )

        const createView = (tabId: ViewHandle["tabId"], sessionKey: SessionKey) =>
            Effect.gen(function* () {
                const view = new WebContentsView({
                    webPreferences: { session: yield* sessionFor(sessionKey) },
                })
                const { webContents } = view
                const handle: ViewHandle = { tabId, sessionKey, webContents }
                const openChild = (url: string, disposition: string): void =>
                    offer({
                        kind: "openChild",
                        tabId,
                        url,
                        // Background opens must not steal focus from the originating tab.
                        background: disposition === "background-tab",
                    })
                // target=_blank, ctrl+click and window.open all become child tabs of the opener.
                webContents.setWindowOpenHandler(({ url, disposition }) => {
                    openChild(url, disposition)
                    return { action: "deny" }
                })
                webContents.on("context-menu", (_event, params) => {
                    buildChromeContextMenu({ params, webContents, openLink: openChild }).popup()
                })
                webContents.on("page-title-updated", (_event, title) =>
                    offer({ kind: "title", tabId, title }),
                )
                webContents.on("did-navigate", (_event, url) =>
                    offer({ kind: "navigated", tabId, url }),
                )
                webContents.on("did-navigate-in-page", (_event, url) =>
                    offer({ kind: "navigatedInPage", tabId, url }),
                )
                webContents.on("page-favicon-updated", (_event, icons) => {
                    // "data:," is Chromium's marker for "this page has no favicon".
                    const favicon = icons.filter((icon) => icon !== "data:,").at(-1) ?? null
                    offer({ kind: "favicon", tabId, favicon })
                })
                // `arbor://` pages run the Arbor preload, so they get pushes (the settings page needs them).
                if (sessionKey.kind === "internal") yield* pushes.attach(webContents)
                shell.watchEdges(view)
                views.set(handle, view)
                return handle
            })

        const handle: WindowHandle = {
            native: win,
            overlays,
            closed: Deferred.await(closed),
            // Shown once the shell has painted, so the window does not open blank.
            loadShell: Effect.tryPromise(() => loadRenderer(shell.view.webContents)).pipe(
                Effect.catchCause((cause) => Effect.logError("Shell failed to load", cause)),
                Effect.andThen(
                    Effect.sync(() => {
                        if (win.isDestroyed()) return
                        win.show()
                        if (process.env.VITE_DEV_SERVER_URL) {
                            shell.view.webContents.openDevTools({ mode: "detach" })
                        }
                    }),
                ),
            ),
            createView,
            show: (target) =>
                Effect.gen(function* () {
                    const view = viewOf(target)
                    if (!view || win.isDestroyed()) return
                    for (const other of views.values()) {
                        if (other !== view) win.contentView.removeChildView(other)
                    }
                    win.contentView.addChildView(view)
                    shell.restack()
                    layoutViews()
                    yield* extensions.attachTab(win, view.webContents)
                }),
            close: (target) =>
                Effect.sync(() => {
                    const view = viewOf(target)
                    if (!view) return
                    views.delete(target)
                    if (!win.isDestroyed()) win.contentView.removeChildView(view)
                    if (!view.webContents.isDestroyed()) view.webContents.close()
                }),
            load: (target, url) =>
                Effect.gen(function* () {
                    const view = viewOf(target)
                    if (!view) return
                    // A chrome-extension:// page is refused until its extension is installed.
                    if (url.startsWith("chrome-extension://")) {
                        yield* extensions.ready(view.webContents.session)
                    }
                    // A view closed while waiting never loads.
                    if (viewOf(target) !== view) return
                    yield* loadUrl(view, url)
                }),
            focus: Effect.sync(() => {
                if (win.isDestroyed()) return
                if (win.isMinimized()) win.restore()
                win.show()
                win.focus()
            }),
            history: (target, step) =>
                Effect.sync(() => {
                    const contents = viewOf(target)?.webContents
                    if (!contents || contents.isDestroyed()) return
                    if (step === "reload") contents.reload()
                    else if (step === "back") contents.navigationHistory.goBack()
                    else contents.navigationHistory.goForward()
                }),
            viewEvents: Stream.fromQueue(events),
            raiseShell: (raised) => Effect.sync(() => shell.setRaised(raised)),
            focusShell: Effect.sync(() => shell.focus()),
        }

        return handle
    })

    // `app` outlives every scope, so its listener is removed when the stream ends.
    const relaunches = Stream.callback<void>((queue) =>
        Effect.acquireRelease(
            Effect.sync(() => {
                const onRelaunch = (): void => {
                    Queue.offerUnsafe(queue, undefined)
                }
                app.on("second-instance", onRelaunch)
                return onRelaunch
            }),
            (onRelaunch) => Effect.sync(() => app.off("second-instance", onRelaunch)),
        ),
    )

    return {
        open,
        relaunches,
        setMenu: (model, run) =>
            Effect.sync(() =>
                Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate(model, run))),
            ),
    }
})
