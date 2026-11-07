import { Deferred, Effect, Queue, Stream } from "effect"
import type { BrowserWindow } from "electron"

import type * as ElectronHost from "../../src/main/windows/electron-host"
import type {
    HistoryStep,
    LoadFailed,
    MenuAction,
    MenuModel,
    SessionKey,
    ViewEvent,
    ViewHandle,
    WindowHostService,
} from "../../src/main/windows/host"
import type { Overlays } from "../../src/main/windows/overlays"
import type { TabId } from "../../src/shared/protocol"
import { fakeRenderer } from "./ipc"

/**
 * No Electron in tests, so no real window. Only Electron-only code (the permission modal,
 * extension menus, `chrome.tabs.create`) uses it, and tests never run that code.
 */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const fakeWindow = {} as unknown as BrowserWindow

/** No Electron, so nothing to show. */
const noOverlays = (): Overlays => ({
    showOmnibox: () => undefined,
    hideOmnibox: () => undefined,
    setOmniboxHeight: () => undefined,
    omniboxOpen: () => false,
    toggleExtensions: () => undefined,
    closeExtensions: () => undefined,
    setExtensionsHeight: () => undefined,
    toggleDownloads: () => undefined,
    closeDownloads: () => undefined,
    setDownloadsHeight: () => undefined,
    toggleActionPopup: () => undefined,
    positionLibraryPopup: () => undefined,
    openRename: () => undefined,
    closeRename: () => undefined,
    closeAll: () => undefined,
})

export type HostCall =
    | { readonly op: "createView"; readonly tabId: TabId; readonly sessionKey: SessionKey }
    | { readonly op: "show"; readonly tabId: TabId }
    | { readonly op: "close"; readonly tabId: TabId }
    | { readonly op: "load"; readonly tabId: TabId; readonly url: string }
    | { readonly op: "history"; readonly tabId: TabId; readonly step: HistoryStep }
    | { readonly op: "focus" }

/** One window the module opened: what it was asked to do, and controls for the test. */
export interface MemoryWindow {
    readonly calls: HostCall[]
    /** The user closes the window. */
    readonly close: () => void
    /** A page reports something (title, navigation, a link opened in a new tab). */
    readonly emit: (event: ViewEvent) => void
    /** `false` once the module closed its scope. */
    open: boolean
}

/**
 * The Electron window code without Electron: records every call per window, and lets a test close the window,
 * emit page events, launch Arbor again, pick a menu item, and decide how each load ends.
 */
const makeMemoryWindowHost = Effect.gen(function* () {
    const windows: MemoryWindow[] = []
    const menus: MenuModel[] = []
    let pick: ((action: MenuAction) => void) | null = null
    const relaunches = yield* Queue.unbounded<void>()
    /** What happens when the shell loads: a test can play the shell's first asks. */
    let shellLoad: Effect.Effect<void> = Effect.void
    /** How a load of `url` ends; a load succeeds at once unless a test says otherwise. */
    let loadOf: (url: string) => Effect.Effect<void, LoadFailed> = () => Effect.void

    const service: WindowHostService = {
        open: Effect.gen(function* () {
            const closed = yield* Deferred.make<void>()
            const events = yield* Queue.unbounded<ViewEvent>()
            const window: MemoryWindow = {
                calls: [],
                close: () => Deferred.doneUnsafe(closed, Effect.void),
                emit: (event) => {
                    Queue.offerUnsafe(events, event)
                },
                open: true,
            }
            windows.push(window)
            yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                    window.open = false
                }),
            )
            const record = (call: HostCall) => Effect.sync(() => void window.calls.push(call))
            return {
                native: fakeWindow,
                overlays: noOverlays(),
                closed: Deferred.await(closed),
                loadShell: Effect.suspend(() => shellLoad),
                focus: record({ op: "focus" }),
                createView: (tabId, sessionKey) =>
                    Effect.as(record({ op: "createView", tabId, sessionKey }), {
                        tabId,
                        sessionKey,
                        // Each view its own fake page, so `tabIdFor` can tell them apart.
                        webContents: fakeRenderer().renderer,
                    } satisfies ViewHandle),
                show: (view) => record({ op: "show", tabId: view.tabId }),
                close: (view) => record({ op: "close", tabId: view.tabId }),
                load: (view, url) =>
                    Effect.andThen(record({ op: "load", tabId: view.tabId, url }), loadOf(url)),
                history: (view, step) => record({ op: "history", tabId: view.tabId, step }),
                viewEvents: Stream.fromQueue(events),
                raiseShell: () => Effect.void,
                focusShell: Effect.void,
            }
        }),
        relaunches: Stream.fromQueue(relaunches),
        setMenu: (model, run) =>
            Effect.sync(() => {
                menus.push(model)
                pick = run
            }),
    }

    return {
        service,
        windows,
        menus,
        /** Arbor is launched a second time. */
        relaunch: (): void => {
            Queue.offerUnsafe(relaunches, undefined)
        },
        /** The user picks a menu item. */
        pickMenu: (action: MenuAction): void => {
            if (!pick) throw new Error("No menu yet")
            pick(action)
        },
        setLoad: (next: (url: string) => Effect.Effect<void, LoadFailed>): void => {
            loadOf = next
        },
        onShellLoad: (next: Effect.Effect<void>): void => {
            shellLoad = next
        },
    }
})

export type MemoryHost = Effect.Success<typeof makeMemoryWindowHost>

let current: MemoryHost | undefined

/*
 * What `src/main/windows/electron-host.ts` exports, in memory, for tests that run the WindowManager:
 * `vi.mock("../src/main/windows/electron-host", () => import("./support/window-host"))`.
 * Each `makeWindowHost` is a fresh host; `currentHost()` is the last one made.
 */

export const makeWindowHost: typeof ElectronHost.makeWindowHost = Effect.map(
    makeMemoryWindowHost,
    (host) => {
        current = host
        return host.service
    },
)

export const sessionForContainer: typeof ElectronHost.sessionForContainer = () => {
    throw new Error("No Electron sessions in tests")
}

export const currentHost = (): MemoryHost => {
    if (!current) throw new Error("No window host made yet")
    return current
}
