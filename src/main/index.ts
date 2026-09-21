import { Effect } from "effect"
import { BrowserWindow, app } from "electron"

import { initExtensions } from "./extensions"
import {
    makeOmniboxActivator,
    makeOnCommit,
    registerOverlayEvents,
    type HostRuntime,
} from "./ipc/events"
import { registerIpc } from "./ipc/handlers"
import { initialState } from "./state/state"
import { BrowserStore, makeStoreLayer } from "./state/store"
import { installMenu } from "./windows/app-menu"
import { attachWindowEvents, createWindow } from "./windows/main-window"
import { tabIdForWebContents, viewForTab } from "./windows/tab-views"

const start = async (): Promise<void> => {
    await app.whenReady()

    const rt: HostRuntime = {
        win: null,
        store: null,
        latest: initialState(),
        previousActiveTab: null,
        lastOmniboxQuery: "",
        rebuildMenu: () => undefined,
    }

    rt.store = Effect.runSync(
        Effect.gen(function* () {
            return yield* BrowserStore
        }).pipe(Effect.provide(makeStoreLayer(makeOnCommit(rt)))),
    )
    const store = rt.store

    registerIpc(store)

    // crx:// protocol + per-container session setup happens lazily from here on.
    initExtensions({
        store,
        getWindow: () => rt.win,
        viewForTab,
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

    // The app always starts with one container holding one empty tab.
    await Effect.runPromise(store.createContainer())
}

void start()

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void start()
})

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
})
