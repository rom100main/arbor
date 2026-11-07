import { Effect, Exit, Scope } from "effect"
import { beforeEach, describe, expect, it, vi } from "vite-plus/test"

import {
    IpcPush,
    serveEvents,
    serveRequests,
    type EventHandlers,
    type RequestHandlers,
} from "../src/main/ipc/router"
import { initialState } from "../src/main/state/state"
import { BrowserStore, type StoreService } from "../src/main/state/store"
import { EVENTS, PUSHES, REQUESTS } from "../src/shared/ipc/channels"
import { DEFAULT_SETTINGS } from "../src/shared/settings"
import { captureLogs, runTest } from "./support/effect"
import * as ipc from "./support/ipc"
import { fakeRenderer } from "./support/ipc"

vi.mock("../src/main/ipc/transport", () => import("./support/ipc"))
beforeEach(() => ipc.resetIpc())

/** The store requests served by the real store, the rest by stubs. */
const handlersFor = (store: StoreService): RequestHandlers<never> => ({
    getSnapshot: () => store.snapshot,
    getSettings: () => Effect.succeed(DEFAULT_SETTINGS),
    setSettings: () => Effect.succeed(DEFAULT_SETTINGS),
    extensionActionInfo: ({ extensionId }) =>
        Effect.succeed({ extensionId, title: extensionId, iconDataUrl: null, popupUrl: null }),
    openExtensionActionPopup: () => Effect.void,
    createContainer: ({ name, color }) => store.createContainer(name, color),
    switchContainer: ({ containerId }) => store.switchContainer(containerId),
    renameContainer: ({ containerId, name }) => store.renameContainer(containerId, name),
    setContainerColor: ({ containerId, color }) => store.setContainerColor(containerId, color),
    setContainerIcon: ({ containerId, icon }) => store.setContainerIcon(containerId, icon),
    reorderContainer: ({ containerId, toIndex }) => store.reorderContainer(containerId, toIndex),
    createTab: ({ url }) => store.createTab(url),
    selectTab: ({ tabId }) => store.selectTab(tabId),
    setCollapsed: ({ tabId, collapsed }) => store.setCollapsed(tabId, collapsed),
    closeTab: ({ tabId }) => store.closeTab(tabId),
    renameTab: ({ tabId, label }) => store.renameTab(tabId, label),
    moveTab: (move) => store.moveTab(move),
    moveToContainer: ({ tabId, containerId }) => store.moveToContainer(tabId, containerId),
    goBack: () => Effect.void,
    goForward: () => Effect.void,
    reload: () => Effect.void,
    downloadsList: () => Effect.succeed({ items: [], folder: "/Downloads" }),
    downloadCancel: () => Effect.void,
    downloadRemove: () => Effect.void,
    downloadReveal: () => Effect.void,
    downloadOpen: () => Effect.void,
    downloadsOpenFolder: () => Effect.void,
    getUpdateStatus: () => Effect.succeed({ kind: "idle" }),
    installUpdate: () => Effect.void,
})

// Type-level guard (checked by `vp check`): a handler is required for every request.
type Expect<T extends false> = T
export type EveryRequestNeedsAHandler = Expect<
    Omit<RequestHandlers<never>, "reload"> extends RequestHandlers<never> ? true : false
>

const eventsSeen: unknown[] = []

const quietEvents: EventHandlers<never> = {
    omniboxUpdate: () => Effect.void,
    omniboxSetPopupHeight: () => Effect.void,
    omniboxActivate: () => Effect.void,
    omniboxMoveSelection: () => Effect.void,
    omniboxActivateSelected: () => Effect.void,
    openRenameModal: () => Effect.void,
    closeRenameModal: () => Effect.void,
    extensionsToggle: () => Effect.void,
    extensionsClose: () => Effect.void,
    extensionsSetPopupHeight: () => Effect.void,
    extensionsMenu: () => Effect.void,
    downloadsToggle: () => Effect.void,
    downloadsClose: () => Effect.void,
    downloadsSetPopupHeight: () => Effect.void,
    permissionRespond: () => Effect.void,
    shellRaise: (raised) => Effect.sync(() => eventsSeen.push(raised)),
}

/** Every Arbor channel served over an in-memory transport, with a real store behind it. */
const serve = Effect.gen(function* () {
    const logs = captureLogs()
    const scope = yield* Scope.make()
    const store = yield* BrowserStore.pipe(Effect.provide(BrowserStore.layer(initialState())))
    yield* Effect.all([serveRequests(handlersFor(store)), serveEvents(quietEvents)]).pipe(
        Scope.provide(scope),
        Effect.provide(logs.layer),
    )
    const invoke = (channel: string, raw?: unknown) =>
        Effect.promise(() => ipc.invoke(channel, raw))
    return { logs, scope, store, invoke }
})

describe("IPC requests", () => {
    it("answers ok with the encoded value", () =>
        runTest(
            Effect.gen(function* () {
                const { invoke } = yield* serve
                const created = yield* invoke(REQUESTS.createContainer, { name: "Work" })
                expect(created).toEqual({ ok: true, value: expect.stringMatching(/^container-/) })

                const snapshot = yield* invoke(REQUESTS.getSnapshot)
                expect(snapshot).toMatchObject({
                    ok: true,
                    value: { containers: [{ name: "Work" }] },
                })
            }),
        ))

    it("answers an expected failure as a value, not a rejection", () =>
        runTest(
            Effect.gen(function* () {
                const { invoke, store } = yield* serve
                yield* store.createContainer()
                const { activeTabId } = yield* store.snapshot
                expect(yield* invoke(REQUESTS.closeTab, { tabId: activeTabId })).toEqual({
                    ok: false,
                    error: { _tag: "LastTab" },
                })
            }),
        ))

    it("rejects a malformed payload and logs it once", () =>
        runTest(
            Effect.gen(function* () {
                const { logs } = yield* serve
                const exit = yield* Effect.exit(
                    Effect.tryPromise(() => ipc.invoke(REQUESTS.closeTab, { tabId: 42 })),
                )
                expect(Exit.isFailure(exit)).toBe(true)
                expect(logs.entries.map((entry) => entry.level)).toEqual(["Error"])
            }),
        ))

    it("serves every channel while the scope is open, and none after", () =>
        runTest(
            Effect.gen(function* () {
                const { scope } = yield* serve
                expect([...ipc.answers.keys()].sort()).toEqual(Object.values(REQUESTS).sort())
                expect([...ipc.receivers.keys()].sort()).toEqual(Object.values(EVENTS).sort())
                yield* Scope.close(scope, Exit.void)
                expect(ipc.answers.size).toBe(0)
                expect(ipc.receivers.size).toBe(0)
            }),
        ))
})

describe("IPC events", () => {
    it("runs the handler on a good payload, and logs a bad one", () =>
        runTest(
            Effect.gen(function* () {
                const { logs } = yield* serve
                eventsSeen.length = 0
                ipc.emit(EVENTS.shellRaise, true)
                ipc.emit(EVENTS.shellRaise, "yes")
                yield* Effect.yieldNow
                expect(eventsSeen).toEqual([true])
                expect(logs.entries.map((entry) => entry.level)).toEqual(["Error"])
            }),
        ))
})

describe("IPC pushes", () => {
    it("reach every attached renderer, until it is destroyed", () =>
        runTest(
            Effect.gen(function* () {
                const pushes = yield* IpcPush.pipe(Effect.provide(IpcPush.layer))
                const shell = fakeRenderer()
                const popup = fakeRenderer()
                yield* pushes.attach(shell.renderer)
                yield* pushes.attach(popup.renderer)

                yield* pushes.push("omniboxQuery", "arbor")
                popup.destroy()
                yield* pushes.push("focusOmnibox")

                expect(shell.received).toEqual([
                    { channel: PUSHES.omniboxQuery, value: "arbor" },
                    { channel: PUSHES.focusOmnibox, value: undefined },
                ])
                expect(popup.received).toEqual([{ channel: PUSHES.omniboxQuery, value: "arbor" }])
            }),
        ))
})
