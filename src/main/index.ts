import path from "node:path"

import { Effect } from "effect"
import { BrowserWindow, app } from "electron"

import { createExtensionStorage, registerExtensionStorageIpc } from "./extension-storage"
import { initExtensions } from "./extensions"
import {
    makeOmniboxActivator,
    makeOnCommit,
    registerOverlayEvents,
    type HostRuntime,
} from "./ipc/events"
import { registerIpc } from "./ipc/handlers"
import { createStatePersistence, type StatePersistence } from "./persistence"
import { initialState, type DomainState } from "./state/state"
import { BrowserStore, makeStoreLayer } from "./state/store"
import { installMenu } from "./windows/app-menu"
import { attachWindowEvents, createWindow } from "./windows/main-window"
import { ensureView, tabIdForWebContents, viewForTab } from "./windows/tab-views"

// Verbose only under `vp dev` (VITE_DEV_SERVER_URL). Packaged/prod: no console.debug noise.
if (!process.env.VITE_DEV_SERVER_URL) {
    console.debug = (): void => undefined
}

/**
 * Electron's extension loader warns about permission names it does not know
 * (`webNavigation` is provided by electron-chrome-extensions itself; `privacy` is optional and unimplemented).
 * Drop only those all-benign warnings so real extension load problems stay visible.
 */
const readWarningType = (value: unknown): string => {
    if (typeof value === "string") return value
    if (typeof value === "object" && value !== null && "type" in value) {
        const { type } = value
        return typeof type === "string" ? type : ""
    }
    return ""
}

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

let statePersistence: StatePersistence | null = null
let extensionStorageFlush: (() => void) | null = null

const flushPersistence = (): void => {
    statePersistence?.flush()
    extensionStorageFlush?.()
}

const start = async (): Promise<void> => {
    filterBenignExtensionLoadWarnings()
    await app.whenReady()

    const userData = app.getPath("userData")
    const persistence = createStatePersistence(path.join(userData, "state.json"))
    statePersistence = persistence
    const initial: DomainState = persistence.load() ?? initialState()

    const extStorage = createExtensionStorage(path.join(userData, "extension-storage.json"))
    extStorage.load()
    extensionStorageFlush = () => extStorage.flush()
    registerExtensionStorageIpc(extStorage)

    const rt: HostRuntime = {
        win: null,
        store: null,
        latest: initial,
        previousActiveTab: null,
        lastOmniboxQuery: "",
        rebuildMenu: () => undefined,
    }

    const commit = makeOnCommit(rt)
    const onCommit = (next: DomainState): void => {
        commit(next)
        persistence.schedule(next)
    }

    rt.store = Effect.runSync(
        Effect.gen(function* () {
            return yield* BrowserStore
        }).pipe(Effect.provide(makeStoreLayer(initial, onCommit))),
    )
    const store = rt.store

    registerIpc(store)

    // crx:// protocol + per-container session setup happens lazily from here on.
    initExtensions({
        store,
        getWindow: () => rt.win,
        viewForTab,
        ensureView: (tabId, url) => ensureView({ store, getState: () => rt.latest }, tabId, url),
        tabIdForWebContents,
    })

    rt.rebuildMenu = installMenu({
        store,
        getState: () => rt.latest,
        focusOmnibox: () => rt.win?.webContents.send("arbor:focus-omnibox"),
    })

    const win = await createWindow()
    rt.win = win
    attachWindowEvents(win)

    const handleOmniboxActivate = makeOmniboxActivator(rt)
    registerOverlayEvents(rt, handleOmniboxActivate)

    if (initial.containers.length > 0) {
        // Restored: attach the active tab's view and push state to the window.
        onCommit(initial)
    } else {
        // The app always starts with one container holding one empty tab.
        await Effect.runPromise(store.createContainer())
    }
}

void start()

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void start()
})

// before-quit covers Cmd+Q and app.quit();
// window-all-closed covers macOS re-activate
// (start() reloads from disk, so pending state must be flushed first).
app.on("before-quit", flushPersistence)

app.on("window-all-closed", () => {
    flushPersistence()
    if (process.platform !== "darwin") app.quit()
})
