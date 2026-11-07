import { Context, Deferred, Effect, Exit, Layer, Scope, Stream } from "effect"
import { beforeEach, describe, expect, it, vi } from "vite-plus/test"

import { fromPersistedSettings, SettingsStore } from "../src/main/settings"
import { SettingsRejected } from "../src/shared/errors"
import { DEFAULT_SETTINGS } from "../src/shared/settings"
import { runTest, settle } from "./support/effect"
import { files } from "./support/memory-fs"

vi.mock("node:fs", () => import("./support/memory-fs"))
beforeEach(() => files.clear())

const FILE = "/data/settings.json"

/** A settings store over the in-memory files; closing `scope` writes what is pending, as quitting does. */
const open = () =>
    Effect.gen(function* () {
        const scope = yield* Scope.make()
        const context = yield* Layer.buildWithScope(SettingsStore.layer(FILE), scope)
        return { store: Context.get(context, SettingsStore), scope }
    })

const onDisk = (): unknown => JSON.parse(files.get(FILE)!)

/** Every change published after the call. */
const collect = <A>(changes: Stream.Stream<A>) =>
    Effect.gen(function* () {
        const seen: A[] = []
        const subscribed = yield* Deferred.make<void>()
        const fiber = yield* changes.pipe(
            Stream.tap(() => Deferred.succeed(subscribed, undefined)),
            Stream.drop(1),
            Stream.runForEach((value) => Effect.sync(() => seen.push(value))),
            Effect.forkChild,
        )
        yield* Deferred.await(subscribed)
        return { seen, fiber }
    })

describe("fromPersistedSettings", () => {
    it("returns null for a payload that is not an object", () => {
        expect(fromPersistedSettings(null)).toBeNull()
        expect(fromPersistedSettings("nope")).toBeNull()
        expect(fromPersistedSettings(7)).toBeNull()
    })

    it("fills in defaults for missing fields", () => {
        expect(fromPersistedSettings({})).toEqual(DEFAULT_SETTINGS)
    })

    it("repairs individual bad fields instead of rejecting the file", () => {
        const restored = fromPersistedSettings({
            searchTemplate: "https://duckduckgo.com/",
            theme: "neon",
            pinnedExtensionIds: ["a", "a", "", 3],
            sidebarVisibility: "folded",
            urlBarVisibility: 1,
        })
        expect(restored).not.toBeNull()
        expect(restored!.searchTemplate).toBe(DEFAULT_SETTINGS.searchTemplate)
        expect(restored!.theme).toBe("system")
        expect(restored!.pinnedExtensionIds).toEqual(["a"])
        expect(restored!.sidebarVisibility).toBe(DEFAULT_SETTINGS.sidebarVisibility)
        expect(restored!.urlBarVisibility).toBe(DEFAULT_SETTINGS.urlBarVisibility)
    })

    it("defaults the download save mode and rejects a non-boolean", () => {
        expect(fromPersistedSettings({})?.downloadAskWhereToSave).toBe(true)
        expect(
            fromPersistedSettings({ downloadAskWhereToSave: "yes" })?.downloadAskWhereToSave,
        ).toBe(true)
        expect(
            fromPersistedSettings({ downloadAskWhereToSave: false })?.downloadAskWhereToSave,
        ).toBe(false)
    })

    it("keeps a valid file intact", () => {
        const payload = {
            searchTemplate: "https://kagi.com/search?q=%s",
            theme: "dark",
            pinnedExtensionIds: ["ext-a", "ext-b"],
            sidebarVisibility: "compact",
            urlBarVisibility: "hidden",
        }
        expect(fromPersistedSettings(payload)).toEqual({
            ...payload,
            downloadAskWhereToSave: true,
        })
    })
})

describe("settings store", () => {
    it("starts from defaults when there is no file", () =>
        runTest(
            Effect.gen(function* () {
                const { store } = yield* open()
                expect(yield* store.get).toEqual(DEFAULT_SETTINGS)
            }),
        ))

    it("loads what a previous run wrote", () =>
        runTest(
            Effect.gen(function* () {
                const first = yield* open()
                yield* first.store.set({
                    theme: "dark",
                    searchTemplate: "https://kagi.com/search?q=%s",
                })
                yield* Scope.close(first.scope, Exit.void)
                expect(fromPersistedSettings(onDisk())).toEqual({
                    theme: "dark",
                    searchTemplate: "https://kagi.com/search?q=%s",
                    pinnedExtensionIds: [],
                    sidebarVisibility: DEFAULT_SETTINGS.sidebarVisibility,
                    urlBarVisibility: DEFAULT_SETTINGS.urlBarVisibility,
                    downloadAskWhereToSave: DEFAULT_SETTINGS.downloadAskWhereToSave,
                })

                const reloaded = yield* (yield* open()).store.get
                expect(reloaded.theme).toBe("dark")
                expect(reloaded.searchTemplate).toBe("https://kagi.com/search?q=%s")
            }),
        ))

    it("normalises a bare-host template on the way in", () =>
        runTest(
            Effect.gen(function* () {
                const { store } = yield* open()
                const next = yield* store.set({ searchTemplate: "kagi.com/search?q=%s" })
                expect(next.searchTemplate).toBe("https://kagi.com/search?q=%s")
            }),
        ))

    it("rejects a template with no %s and writes nothing", () =>
        runTest(
            Effect.gen(function* () {
                const first = yield* open()
                yield* first.store.set({ theme: "light" })
                yield* Scope.close(first.scope, Exit.void)
                const before = onDisk()

                const { store, scope } = yield* open()
                const error = yield* Effect.flip(
                    store.set({ searchTemplate: "https://duckduckgo.com/" }),
                )
                expect(error).toBeInstanceOf(SettingsRejected)
                expect((yield* store.get).searchTemplate).toBe(DEFAULT_SETTINGS.searchTemplate)
                yield* Scope.close(scope, Exit.void)
                // Disk still holds what the last accepted write left there.
                expect(onDisk()).toEqual(before)
                expect(before).toMatchObject({ theme: "light" })
            }),
        ))

    it("drops unknown keys in a patch", () =>
        runTest(
            Effect.gen(function* () {
                const { store, scope } = yield* open()
                const next = yield* store.set({ theme: "dark", injected: "nope" })
                expect(next).not.toHaveProperty("injected")
                yield* Scope.close(scope, Exit.void)
                expect(onDisk()).not.toHaveProperty("injected")
            }),
        ))

    it("persists bar visibility", () =>
        runTest(
            Effect.gen(function* () {
                const first = yield* open()
                yield* first.store.set({ sidebarVisibility: "hidden", urlBarVisibility: "hidden" })
                yield* Scope.close(first.scope, Exit.void)
                const reloaded = yield* (yield* open()).store.get
                expect(reloaded.sidebarVisibility).toBe("hidden")
                expect(reloaded.urlBarVisibility).toBe("hidden")
            }),
        ))

    it("persists the download save mode and publishes it", () =>
        runTest(
            Effect.gen(function* () {
                const { store, scope } = yield* open()
                const { seen } = yield* collect(store.changes)
                yield* store.set({ downloadAskWhereToSave: false })
                yield* settle
                expect(seen.map((settings) => settings.downloadAskWhereToSave)).toEqual([false])

                yield* Scope.close(scope, Exit.void)
                expect(onDisk()).toMatchObject({ downloadAskWhereToSave: false })

                const reloaded = yield* (yield* open()).store.get
                expect(reloaded.downloadAskWhereToSave).toBe(false)
            }),
        ))

    it("publishes each change", () =>
        runTest(
            Effect.gen(function* () {
                const { store } = yield* open()
                const { seen } = yield* collect(store.changes)
                yield* store.set({ theme: "dark" })
                yield* store.set({ theme: "light" })
                yield* settle
                expect(seen.map((settings) => settings.theme)).toEqual(["dark", "light"])
            }),
        ))

    it("pins in order, dedupes, and unpins", () =>
        runTest(
            Effect.gen(function* () {
                const { store } = yield* open()
                yield* store.pin("ext-bbb")
                yield* store.pin("ext-aaa")
                yield* store.pin("ext-bbb")
                expect((yield* store.get).pinnedExtensionIds).toEqual(["ext-bbb", "ext-aaa"])

                yield* store.unpin("ext-gone")
                expect((yield* store.get).pinnedExtensionIds).toEqual(["ext-bbb", "ext-aaa"])

                yield* store.unpin("ext-bbb")
                expect((yield* store.get).pinnedExtensionIds).toEqual(["ext-aaa"])
            }),
        ))

    it("does not publish when a pin is a no-op", () =>
        runTest(
            Effect.gen(function* () {
                const { store } = yield* open()
                yield* store.pin("ext-aaa")
                const { seen } = yield* collect(store.changes)
                yield* store.pin("ext-aaa")
                yield* store.unpin("ext-gone")
                yield* settle
                expect(seen).toEqual([])
                expect((yield* store.get).pinnedExtensionIds).toEqual(["ext-aaa"])
            }),
        ))
})
