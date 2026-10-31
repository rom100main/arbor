import { Context, Effect, Exit, Fiber, Layer, Option, Schema, Scope, Stream } from "effect"
import { BrowserWindow, app } from "electron"

import { AppServicesLive } from "./app-services"
import { runRequest } from "./exec"
import { initExtensions, markMainWindowOpened } from "./extension/loader"
import { ExtensionStorage, registerExtensionStorageIpc } from "./extension/storage"
import {
    makeOmniboxActivator,
    makeWindowSync,
    registerOverlayEvents,
    registerSettingsBroadcast,
    type HostRuntime,
} from "./ipc/events"
import { registerIpc } from "./ipc/handlers"
import { AppRuntime } from "./runtime"
import { SettingsStore } from "./settings"
import { BrowserStore, type StoreService } from "./state/store"
import { installMenu } from "./windows/app-menu"
import { registerInternalPages, registerInternalScheme } from "./windows/internal-pages"
import { attachWindowEvents, createWindow } from "./windows/main-window"
import { promptConsumer } from "./windows/overlays"
import { focusShell, shellWebContents } from "./windows/shell-view"
import {
    destroyAllViews,
    ensureView,
    layoutViews,
    tabIdForWebContents,
    viewForTab,
} from "./windows/tab-views"

// Must precede app.whenReady(): arbor:// needs a real origin for the bundle's module script.
registerInternalScheme()

/**
 * Electron's extension loader warns about permission names it does not know
 * (`webNavigation` is provided by electron-chrome-extensions itself; `privacy` is optional and unimplemented).
 * Drop only those all-benign warnings so real extension load problems stay visible.
 */
const decodeWarningType = Schema.decodeUnknownOption(
    Schema.Union([Schema.String, Schema.Struct({ type: Schema.String })]),
)

const readWarningType = (value: unknown): string =>
    Option.match(decodeWarningType(value), {
        onNone: () => "",
        onSome: (decoded) => (typeof decoded === "string" ? decoded : decoded.type),
    })

const filterBenignExtensionLoadWarnings = (): void => {
    const original = process.emitWarning.bind(process)
    process.emitWarning = (warning: string | Error, ...rest: unknown[]): void => {
        const text = typeof warning === "string" ? warning : (warning?.message ?? "")
        const name = readWarningType(rest[0])
        const isExtensionLoad =
            name === "ExtensionLoadWarning" || text.includes("ExtensionLoadWarning")
        if (isExtensionLoad) {
            const unknown = [...text.matchAll(/Permission '([^']+)' is unknown/g)].map((m) => m[1])
            const benign = new Set(["webNavigation", "privacy"])
            if (unknown.length > 0 && unknown.every((permission) => benign.has(permission))) {
                return
            }
        }
        Reflect.apply(original, process, [warning, ...rest])
    }
}

// --- process-lifetime application

interface Application {
    readonly store: StoreService
    readonly rt: HostRuntime
    /** Holds every persisted service; closing it writes their pending changes. */
    readonly scope: Scope.Closeable
    readonly ensureSeedTab: () => Promise<void>
}

let application: Application | null = null
let booting: Promise<Application> | null = null

const bootApplication = async (): Promise<Application> => {
    filterBenignExtensionLoadWarnings()
    await app.whenReady()
    AppRuntime.runFork(promptConsumer)

    const scope = AppRuntime.runSync(Scope.make())
    const services = await AppRuntime.runPromise(
        Layer.buildWithScope(AppServicesLive(app.getPath("userData")), scope),
    )
    const store: StoreService = Context.get(services, BrowserStore)
    const settings = Context.get(services, SettingsStore)
    registerSettingsBroadcast(settings)
    registerExtensionStorageIpc(Context.get(services, ExtensionStorage))

    const rt: HostRuntime = {
        win: null,
        store,
        settings,
        getState: () => AppRuntime.runSync(store.state),
        getSettings: () => AppRuntime.runSync(settings.get),
        previousActiveTab: null,
        lastOmniboxQuery: "",
        rebuildMenu: () => undefined,
    }

    // Keep app menu in sync with the store
    AppRuntime.runFork(
        store.changes.pipe(
            Stream.drop(1), // first emission is the state just loaded, so skip it
            Stream.runForEach(() =>
                Effect.sync(() => rt.rebuildMenu()).pipe(
                    Effect.catchCause((cause) => Effect.logError("State observer failed", cause)),
                ),
            ),
        ),
    )

    registerIpc(store, settings, rt.getState)

    // arbor:// internal pages: their own session, so only they carry the preload bridge.
    registerInternalPages()

    // crx:// protocol + per-container session setup happens lazily from here on.
    initExtensions({
        store,
        settings,
        getWindow: () => rt.win,
        viewForTab,
        ensureView: (tabId, url) => ensureView({ store, getState: rt.getState }, tabId, url),
        tabIdForWebContents,
    })

    const handleOmniboxActivate = makeOmniboxActivator(rt)
    registerOverlayEvents(rt, handleOmniboxActivate)

    const ensureSeedTab = async (): Promise<void> => {
        if (rt.getState().containers.length === 0) await runRequest(store.createContainer())
    }

    return { store, rt, scope, ensureSeedTab }
}

const openMainWindow = async (appInstance: Application): Promise<void> => {
    const { rt, store, ensureSeedTab } = appInstance

    rt.rebuildMenu = installMenu({
        store,
        getState: rt.getState,
        focusOmnibox: () => {
            focusShell()
            shellWebContents()?.send("arbor:focus-omnibox")
        },
    })

    const win = await createWindow(rt.getSettings)
    rt.win = win
    markMainWindowOpened()
    attachWindowEvents(win)
    win.on("closed", () => {
        if (rt.win === win) {
            rt.win = null
            rt.previousActiveTab = null
        }
        destroyAllViews()
    })

    // Keep this window in sync with the store: tab views and renderers
    const sync = makeWindowSync(rt)
    const syncFiber = AppRuntime.runFork(
        store.changes.pipe(
            Stream.runForEach((next) =>
                Effect.sync(() => sync(next)).pipe(
                    Effect.catchCause((cause) => Effect.logError("Window sync failed", cause)),
                ),
            ),
        ),
    )
    win.on("closed", () => AppRuntime.runFork(Fiber.interrupt(syncFiber)))

    // Showing or hiding a bar changes how much of the window the page gets.
    const relayoutFiber = AppRuntime.runFork(
        rt.settings.changes.pipe(
            Stream.drop(1),
            Stream.runForEach(() => Effect.sync(() => layoutViews(win))),
        ),
    )
    win.on("closed", () => AppRuntime.runFork(Fiber.interrupt(relayoutFiber)))

    await ensureSeedTab()
}

const ensureApplication = async (): Promise<Application> => {
    if (application) return application
    if (!booting) booting = bootApplication()
    application = await booting
    return application
}

const startMainWindow = async (): Promise<void> => {
    const appInstance = await ensureApplication()
    await openMainWindow(appInstance)
}

void startMainWindow()

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void startMainWindow()
})

// Quitting closes the app scope: every persisted service writes its pending change in a finalizer.
// The runtime itself stays up, so events fired while windows close still run.
let scopeClosed = false
app.on("before-quit", (event) => {
    if (scopeClosed || !application) return
    event.preventDefault()
    const { scope } = application
    void (async () => {
        // Finalizers write synchronously, the timeout only guards against a hung one.
        await Promise.race([
            AppRuntime.runPromise(Scope.close(scope, Exit.void)),
            new Promise((resolve) => setTimeout(resolve, 2_000)),
        ])
        scopeClosed = true
        app.quit()
    })()
})

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
})
