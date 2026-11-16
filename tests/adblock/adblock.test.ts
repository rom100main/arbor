import { Context, Effect, Layer, Scope } from "effect"
import type { Session } from "electron"
import { describe, expect, it, vi } from "vite-plus/test"

import { Adblock } from "../../src/main/adblock"
import { SettingsStore } from "../../src/main/settings"
import { files } from "../support/memory-fs"

const SETTINGS = "/data/settings.json"

/** Live runtime, not the test clock: the startup pass awaits real promises. */
const runTest = Effect.runPromise

vi.mock("node:fs", () => import("../support/memory-fs"))
vi.mock("node:fs/promises", () => import("../support/memory-fs-promises"))

const ipcHandlers = new Map<string, (event: unknown, ...args: never[]) => unknown>()
vi.mock("electron", () => ({
    ipcMain: {
        handle: (
            channel: string,
            listener: (event: unknown, ...args: never[]) => unknown,
        ): void => {
            if (ipcHandlers.has(channel)) throw new Error(`Duplicate handler for ${channel}`)
            ipcHandlers.set(channel, listener)
        },
        removeHandler: (channel: string): void => {
            ipcHandlers.delete(channel)
        },
    },
}))

/** Controls the mocked list fetch per test. */
const controls = vi.hoisted(() => ({ fetchResult: null as Promise<unknown> | null }))

const fakeBlockerCalls: string[] = []
vi.mock("@ghostery/adblocker-electron", () => ({
    ElectronBlocker: {
        deserialize: (): never => {
            throw new Error("no cache in tests")
        },
        fromPrebuiltAdsAndTracking: (): Promise<unknown> =>
            controls.fetchResult ?? Promise.reject(new Error("unset")),
    },
}))

type BeforeRequest = (details: unknown, callback: (response: unknown) => void) => void

class FakeSession {
    beforeRequest: BeforeRequest | null = null

    webRequest = {
        onBeforeRequest: (_filter: unknown, listener: BeforeRequest): void => {
            this.beforeRequest = listener
        },
        onHeadersReceived: (): void => undefined,
    }
}

const asSession = (session: FakeSession): Session =>
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    session as unknown as Session

const open = Effect.gen(function* () {
    const scope = yield* Scope.make()
    const context = yield* Layer.buildWithScope(
        Adblock.layer({ cachePath: "/data/adblock/engine.bin" }).pipe(
            Layer.provideMerge(SettingsStore.layer(SETTINGS)),
        ),
        scope,
    )
    return {
        adblock: Context.get(context, Adblock),
        settings: Context.get(context, SettingsStore),
        scope,
    }
})

const stale = () =>
    Effect.sync(() => {
        files.clear()
        ipcHandlers.clear()
        fakeBlockerCalls.length = 0
        controls.fetchResult = null
    })

/** A stub engine that records use. */
const stubEngine = {
    onBeforeRequest: (_details: unknown, callback: (response: unknown) => void): void => {
        fakeBlockerCalls.push("beforeRequest")
        callback({})
    },
    onHeadersReceived: (_details: unknown, callback: (response: unknown) => void): void => {
        callback({})
    },
    serialize: (): Uint8Array => new Uint8Array([1]),
}

describe("Adblock service", () => {
    it("hooks a session once and delegates to the loaded engine", () =>
        runTest(
            Effect.gen(function* () {
                yield* stale()
                controls.fetchResult = Promise.resolve(stubEngine)
                const { adblock } = yield* open
                yield* adblock.ready
                const first = new FakeSession()
                const second = new FakeSession()
                yield* adblock.attach(asSession(first))
                // Attaching the same session again registers nothing twice.
                yield* adblock.attach(asSession(first))
                yield* adblock.attach(asSession(second))

                expect(first.beforeRequest).not.toBeNull()
                // Network-only: no cosmetic preload or IPC handlers.
                expect([...ipcHandlers.keys()]).toEqual([])
                first.beforeRequest?.({}, () => undefined)
                expect(fakeBlockerCalls).toEqual(["beforeRequest"])
            }),
        ))

    it("allows every request until the lists land", () =>
        runTest(
            Effect.gen(function* () {
                yield* stale()
                controls.fetchResult = new Promise(() => undefined)
                const { adblock } = yield* open
                const session = new FakeSession()
                yield* adblock.attach(asSession(session))

                const replies: unknown[] = []
                session.beforeRequest?.({}, (response) => void replies.push(response))
                expect(replies).toEqual([{}])
            }),
        ))

    it("keeps running unblocked when the fetch fails", () =>
        runTest(
            Effect.gen(function* () {
                yield* stale()
                controls.fetchResult = Promise.reject(new Error("offline"))
                const { adblock } = yield* open
                yield* adblock.ready
                const session = new FakeSession()
                yield* adblock.attach(asSession(session))

                const replies: unknown[] = []
                session.beforeRequest?.({}, (response) => void replies.push(response))
                expect(replies).toEqual([{}])
            }),
        ))

    it("is on by default and blocks, then allows everything once disabled", () =>
        runTest(
            Effect.gen(function* () {
                yield* stale()
                controls.fetchResult = Promise.resolve(stubEngine)
                const { adblock, settings } = yield* open
                yield* adblock.ready
                const session = new FakeSession()
                yield* adblock.attach(asSession(session))

                session.beforeRequest?.({}, () => undefined)
                expect(fakeBlockerCalls).toEqual(["beforeRequest"])

                yield* settings.set({ adblockEnabled: false })
                // The mirrored flag updates on the next settings event; give
                // the subscription a chance to run.
                yield* Effect.yieldNow
                session.beforeRequest?.({}, () => undefined)
                expect(fakeBlockerCalls).toEqual(["beforeRequest"])

                yield* settings.set({ adblockEnabled: true })
                yield* Effect.yieldNow
                session.beforeRequest?.({}, () => undefined)
                expect(fakeBlockerCalls).toEqual(["beforeRequest", "beforeRequest"])
            }),
        ))

    it("starts unblocked when the setting is off", () =>
        runTest(
            Effect.gen(function* () {
                yield* stale()
                // Seed settings before the service builds.
                files.set(SETTINGS, JSON.stringify({ adblockEnabled: false }))
                controls.fetchResult = Promise.resolve(stubEngine)
                const { adblock } = yield* open
                yield* adblock.ready
                const session = new FakeSession()
                yield* adblock.attach(asSession(session))

                session.beforeRequest?.({}, () => undefined)
                expect(fakeBlockerCalls).toEqual([])
            }),
        ))

    it("never delegates main-frame navigations to the engine", () =>
        runTest(
            Effect.gen(function* () {
                yield* stale()
                controls.fetchResult = Promise.resolve(stubEngine)
                const { adblock } = yield* open
                yield* adblock.ready
                const session = new FakeSession()
                yield* adblock.attach(asSession(session))

                const replies: unknown[] = []
                session.beforeRequest?.({ resourceType: "mainFrame" }, (response) =>
                    void replies.push(response),
                )
                expect(replies).toEqual([{}])
                expect(fakeBlockerCalls).toEqual([])
            }),
        ))
})
