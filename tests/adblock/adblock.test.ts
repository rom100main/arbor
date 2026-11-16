import { Context, Effect, Layer, Scope } from "effect"
import type { Session } from "electron"
import { describe, expect, it, vi } from "vite-plus/test"

import { Adblock, matchesDisabledPattern } from "../../src/main/adblock"
import { SettingsStore } from "../../src/main/settings"
import { files } from "../support/memory-fs"

const SETTINGS = "/data/settings.json"

/** Live runtime, not the test clock: the startup pass awaits real promises. */
const runTest = Effect.runPromise

vi.mock("node:fs", () => import("../support/memory-fs"))
vi.mock("node:fs/promises", () => import("../support/memory-fs-promises"))

const ipcHandlers = new Map<string, (event: unknown, url: string, msg?: unknown) => unknown>()
vi.mock("electron", () => ({
    ipcMain: {
        handle: (
            channel: string,
            listener: (event: unknown, ...args: never[]) => unknown,
        ): void => {
            if (ipcHandlers.has(channel)) throw new Error(`Duplicate handler for ${channel}`)
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion
            ipcHandlers.set(channel, listener as (event: unknown, url: string) => unknown)
        },
        removeHandler: (channel: string): void => {
            ipcHandlers.delete(channel)
        },
    },
}))

/** Controls the mocked list fetch per test. A factory, so a rejection is
 * created when the startup pass asks, never before it. */
const controls = vi.hoisted(() => ({ fetchResult: null as (() => Promise<unknown>) | null }))

const fakeBlockerCalls: string[] = []
vi.mock("@ghostery/adblocker-electron", () => ({
    ElectronBlocker: {
        deserialize: (): never => {
            throw new Error("no cache in tests")
        },
        fromPrebuiltAdsAndTracking: (): Promise<unknown> =>
            controls.fetchResult?.() ?? Promise.reject(new Error("unset")),
    },
}))

type BeforeRequest = (details: unknown, callback: (response: unknown) => void) => void

class FakeSession {
    beforeRequest: BeforeRequest | null = null
    preloads: { type: string; filePath: string; excludeMatches?: readonly string[] }[] = []

    registerPreloadScript = (script: {
        type: string
        filePath: string
        excludeMatches?: readonly string[]
    }): string => {
        this.preloads.push(script)
        return `preload-${this.preloads.length}`
    }

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
    getCosmeticsFilters: (): unknown => ({
        active: true,
        styles: ".ad { display: none !important; }",
        scripts: ["(function(){ throw new Error('must not run') })()"],
    }),
    onIsMutationObserverEnabled: (): Promise<boolean> => Promise.resolve(false),
    serialize: (): Uint8Array => new Uint8Array([1]),
}

describe("Adblock service", () => {
    it("hooks a session once and delegates to the loaded engine", () =>
        runTest(
            Effect.gen(function* () {
                yield* stale()
                controls.fetchResult = () => Promise.resolve(stubEngine)
                const { adblock } = yield* open
                yield* adblock.ready
                const first = new FakeSession()
                const second = new FakeSession()
                yield* adblock.attach(asSession(first))
                // Attaching the same session again registers nothing twice.
                yield* adblock.attach(asSession(first))
                // Cosmetic handlers are process-global, so a second
                // Container must not re-register them.
                yield* adblock.attach(asSession(second))

                expect(first.preloads).toHaveLength(1)
                expect(first.preloads[0]?.filePath).toEqual(expect.stringContaining("preload"))
                expect(first.beforeRequest).not.toBeNull()
                expect([...ipcHandlers.keys()].sort()).toEqual([
                    "@ghostery/adblocker/inject-cosmetic-filters",
                    "@ghostery/adblocker/is-mutation-observer-enabled",
                ])
                first.beforeRequest?.({}, () => undefined)
                expect(fakeBlockerCalls).toEqual(["beforeRequest"])
            }),
        ))

    it("injects cosmetic CSS only, never scriptlets", () =>
        runTest(
            Effect.gen(function* () {
                yield* stale()
                controls.fetchResult = () => Promise.resolve(stubEngine)
                const { adblock } = yield* open
                yield* adblock.ready
                yield* adblock.attach(asSession(new FakeSession()))

                const insertCSS = vi.fn(() => Promise.resolve("key"))
                const executeJavaScript = vi.fn(() => Promise.resolve(undefined))
                const handler = ipcHandlers.get("@ghostery/adblocker/inject-cosmetic-filters")
                expect(handler).toBeDefined()
                yield* Effect.promise(() =>
                    Promise.resolve(
                        handler?.(
                            { frameId: 1, processId: 2, sender: { insertCSS, executeJavaScript } },
                            "https://www.youtube.com/",
                            undefined,
                        ),
                    ),
                )
                expect(insertCSS).toHaveBeenCalledTimes(1)
                expect(insertCSS).toHaveBeenCalledWith(".ad { display: none !important; }", {
                    cssOrigin: "user",
                })
                expect(executeJavaScript).not.toHaveBeenCalled()
            }),
        ))

    it("allows every request until the lists land", () =>
        runTest(
            Effect.gen(function* () {
                yield* stale()
                controls.fetchResult = () => new Promise(() => undefined)
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
                controls.fetchResult = () => Promise.reject(new Error("offline"))
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
                controls.fetchResult = () => Promise.resolve(stubEngine)
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
                controls.fetchResult = () => Promise.resolve(stubEngine)
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
                controls.fetchResult = () => Promise.resolve(stubEngine)
                const { adblock } = yield* open
                yield* adblock.ready
                const session = new FakeSession()
                yield* adblock.attach(asSession(session))

                const replies: unknown[] = []
                session.beforeRequest?.(
                    { resourceType: "mainFrame" },
                    (response) => void replies.push(response),
                )
                expect(replies).toEqual([{}])
                expect(fakeBlockerCalls).toEqual([])
            }),
        ))

    it("lets disabled sites through unblocked and skips their cosmetic CSS", () =>
        runTest(
            Effect.gen(function* () {
                yield* stale()
                controls.fetchResult = () => Promise.resolve(stubEngine)
                const { adblock, settings } = yield* open
                yield* adblock.ready
                yield* settings.set({ adblockDisabledSites: ["*.example.com"] })
                // The mirrored list updates on the next settings event.
                yield* Effect.yieldNow
                const session = new FakeSession()
                yield* adblock.attach(asSession(session))

                const replies: unknown[] = []
                session.beforeRequest?.(
                    { url: "https://sub.example.com/ad.js", resourceType: "script" },
                    (response) => void replies.push(response),
                )
                expect(replies).toEqual([{}])
                expect(fakeBlockerCalls).toEqual([])

                // Other sites still block.
                session.beforeRequest?.(
                    { url: "https://other.com/ad.js", resourceType: "script" },
                    () => undefined,
                )
                expect(fakeBlockerCalls).toEqual(["beforeRequest"])

                const insertCSS = vi.fn(() => Promise.resolve("key"))
                const handler = ipcHandlers.get("@ghostery/adblocker/inject-cosmetic-filters")
                yield* Effect.promise(() =>
                    Promise.resolve(
                        handler?.(
                            { frameId: 1, processId: 2, sender: { insertCSS } },
                            "https://sub.example.com/",
                            undefined,
                        ),
                    ),
                )
                expect(insertCSS).not.toHaveBeenCalled()
            }),
        ))

    it("starts unblocked for disabled sites seeded on disk", () =>
        runTest(
            Effect.gen(function* () {
                yield* stale()
                files.set(SETTINGS, JSON.stringify({ adblockDisabledSites: ["example.com"] }))
                controls.fetchResult = () => Promise.resolve(stubEngine)
                const { adblock } = yield* open
                yield* adblock.ready
                const session = new FakeSession()
                yield* adblock.attach(asSession(session))

                session.beforeRequest?.(
                    { url: "https://example.com/ad.js", resourceType: "script" },
                    () => undefined,
                )
                expect(fakeBlockerCalls).toEqual([])
            }),
        ))
})

describe("matchesDisabledPattern", () => {
    it("matches a bare host against the hostname", () => {
        expect(matchesDisabledPattern(["example.com"], "https://example.com/page")).toBe(true)
        expect(matchesDisabledPattern(["example.com"], "https://other.com/page")).toBe(false)
        expect(matchesDisabledPattern(["example.com"], "https://sub.example.com/page")).toBe(false)
    })

    it("matches a wildcard host against subdomains", () => {
        expect(matchesDisabledPattern(["*.example.com"], "https://sub.example.com/page")).toBe(true)
        expect(matchesDisabledPattern(["*.example.com"], "https://example.com/page")).toBe(false)
    })

    it("matches a full URL pattern against the whole URL", () => {
        expect(matchesDisabledPattern(["https://example.com/*"], "https://example.com/page")).toBe(
            true,
        )
        expect(matchesDisabledPattern(["https://example.com/*"], "https://example.com")).toBe(false)
    })

    it("is case-insensitive and ignores empty patterns", () => {
        expect(matchesDisabledPattern(["EXAMPLE.COM"], "https://example.com/")).toBe(true)
        expect(matchesDisabledPattern(["", "  "], "https://example.com/")).toBe(false)
    })

    it("never matches an invalid URL", () => {
        expect(matchesDisabledPattern(["*"], "not a url")).toBe(false)
    })
})
