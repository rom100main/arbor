import path from "node:path"

import { Context, Effect, Layer, Scope } from "effect"
import type { Session } from "electron"
import { beforeEach, describe, expect, it, vi } from "vite-plus/test"

import { Downloads, type DownloadsService } from "../../src/main/downloads/downloads"
import { SettingsStore } from "../../src/main/settings"
import { FakeItem, FakeSession } from "../support/downloads"
import { runTest, settle } from "../support/effect"
import { files } from "../support/memory-fs"

vi.mock("node:fs", () => import("../support/memory-fs"))

const FOLDER = "/Downloads"
const HISTORY = "/data/downloads.json"
const SETTINGS = "/data/settings.json"

const opened = { reveal: [] as string[], open: [] as string[] }
const taken = new Set<string>()

beforeEach(() => {
    files.clear()
    taken.clear()
    opened.reveal.length = 0
    opened.open.length = 0
})

const open = () =>
    Effect.gen(function* () {
        const scope = yield* Scope.make()
        const context = yield* Layer.buildWithScope(
            Downloads.layer({
                folder: FOLDER,
                historyPath: HISTORY,
                opener: {
                    reveal: (file) => void opened.reveal.push(file),
                    open: (target) => void opened.open.push(target),
                },
                exists: (candidate) => taken.has(candidate),
            }).pipe(Layer.provideMerge(SettingsStore.layer(SETTINGS))),
            scope,
        )
        return {
            downloads: Context.get(context, Downloads),
            settings: Context.get(context, SettingsStore),
            scope,
        }
    })

const attach = (downloads: DownloadsService, session: FakeSession) =>
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    downloads.attach(session as unknown as Session)

const items = (downloads: DownloadsService) =>
    Effect.map(downloads.snapshot, (snapshot) => snapshot.items)

const start = (session: FakeSession, item: FakeItem): void =>
    session.emit("will-download", {}, item)

describe("Downloads service", () => {
    it("asks where to save by default", () =>
        runTest(
            Effect.gen(function* () {
                const { downloads } = yield* open()
                const session = new FakeSession()
                yield* attach(downloads, session)

                const item = new FakeItem("a.txt", "https://example.com/a.txt", 10)
                start(session, item)

                expect(item.saveDialogOptions?.defaultPath).toBe(path.join(FOLDER, "a.txt"))
                expect(item.getSavePath()).toBe("")
                expect((yield* items(downloads))[0].state).toBe("pending")
            }),
        ))

    it("saves without asking once the setting changes, numbering a taken name", () =>
        runTest(
            Effect.gen(function* () {
                const { downloads, settings } = yield* open()
                const session = new FakeSession()
                yield* attach(downloads, session)

                const asked = new FakeItem("a.txt", "https://example.com/a.txt", 1)
                start(session, asked)
                expect(asked.saveDialogOptions).not.toBeNull()

                // No restart: the service reads the setting live.
                yield* settings.set({ downloadAskWhereToSave: false })
                yield* settle

                taken.add(path.join(FOLDER, "a.txt"))
                const automatic = new FakeItem("a.txt", "https://example.com/a.txt", 1)
                start(session, automatic)

                expect(automatic.saveDialogOptions).toBeNull()
                expect(automatic.getSavePath()).toBe(path.join(FOLDER, "a (1).txt"))
            }),
        ))

    it("moves from pending to progressing with byte counts", () =>
        runTest(
            Effect.gen(function* () {
                const { downloads } = yield* open()
                const session = new FakeSession()
                yield* attach(downloads, session)

                const item = new FakeItem("a.txt", "https://example.com/a.txt", 10)
                start(session, item)
                item.received = 4
                item.emit("updated")
                yield* settle

                const [entry] = yield* items(downloads)
                expect(entry.state).toBe("progressing")
                expect(entry.receivedBytes).toBe(4)
                expect(entry.totalBytes).toBe(10)
            }),
        ))

    it("settles a completed download and keeps it listed", () =>
        runTest(
            Effect.gen(function* () {
                const { downloads } = yield* open()
                const session = new FakeSession()
                yield* attach(downloads, session)

                const item = new FakeItem("a.txt", "https://example.com/a.txt", 10)
                start(session, item)
                item.received = 10
                item.state = "completed"
                item.emit("done", {}, "completed")
                yield* settle

                const [entry] = yield* items(downloads)
                expect(entry.state).toBe("completed")
                expect(entry.finishedAt).not.toBeNull()
            }),
        ))

    it("maps cancelled and interrupted to their states", () =>
        runTest(
            Effect.gen(function* () {
                const { downloads } = yield* open()
                const session = new FakeSession()
                yield* attach(downloads, session)

                for (const state of ["cancelled", "interrupted"] as const) {
                    const item = new FakeItem(`${state}.txt`, "https://example.com/f", 1)
                    start(session, item)
                    item.state = state
                    item.emit("done", {}, state)
                    yield* settle
                }

                expect((yield* items(downloads)).map((entry) => entry.state)).toEqual([
                    "cancelled",
                    "interrupted",
                ])
            }),
        ))

    it("cancels once; a second cancel is a no-op", () =>
        runTest(
            Effect.gen(function* () {
                const { downloads } = yield* open()
                const session = new FakeSession()
                yield* attach(downloads, session)

                const item = new FakeItem("a.txt", "https://example.com/a.txt", 10)
                start(session, item)
                const [entry] = yield* items(downloads)

                yield* downloads.cancel(entry.id)
                yield* downloads.cancel(entry.id)
                expect(item.cancelCount).toBe(1)
            }),
        ))

    it("remove cancels a live download and `done` does not resurrect it", () =>
        runTest(
            Effect.gen(function* () {
                const { downloads } = yield* open()
                const session = new FakeSession()
                yield* attach(downloads, session)

                const item = new FakeItem("a.txt", "https://example.com/a.txt", 10)
                start(session, item)
                const [entry] = yield* items(downloads)

                yield* downloads.remove(entry.id)
                expect(item.cancelCount).toBe(1)
                expect(yield* items(downloads)).toEqual([])

                item.state = "completed"
                item.emit("done", {}, "completed")
                yield* settle
                expect(yield* items(downloads)).toEqual([])
            }),
        ))

    it("reveals the saved file, and does nothing before a path is known", () =>
        runTest(
            Effect.gen(function* () {
                const { downloads } = yield* open()
                const session = new FakeSession()
                yield* attach(downloads, session)

                const item = new FakeItem("a.txt", "https://example.com/a.txt", 10)
                start(session, item)
                const [entry] = yield* items(downloads)

                yield* downloads.reveal(entry.id)
                expect(opened.reveal).toEqual([])

                item.savePath = path.join(FOLDER, "a.txt")
                item.emit("updated")
                yield* settle
                yield* downloads.reveal(entry.id)
                expect(opened.reveal).toEqual([path.join(FOLDER, "a.txt")])
            }),
        ))

    it("opens the saved file", () =>
        runTest(
            Effect.gen(function* () {
                const { downloads } = yield* open()
                const session = new FakeSession()
                yield* attach(downloads, session)

                const item = new FakeItem("a.txt", "https://example.com/a.txt", 10)
                start(session, item)
                const [entry] = yield* items(downloads)

                item.savePath = path.join(FOLDER, "a.txt")
                item.emit("updated")
                yield* settle
                yield* downloads.open(entry.id)
                expect(opened.open).toEqual([path.join(FOLDER, "a.txt")])
            }),
        ))

    it("registers one will-download listener per session", () =>
        runTest(
            Effect.gen(function* () {
                const { downloads } = yield* open()
                const session = new FakeSession()
                yield* attach(downloads, session)
                yield* attach(downloads, session)

                expect(session.listenerCount("will-download")).toBe(1)
            }),
        ))

    it("ignores an unknown id everywhere", () =>
        runTest(
            Effect.gen(function* () {
                const { downloads } = yield* open()

                yield* downloads.cancel("download-missing")
                yield* downloads.remove("download-missing")
                yield* downloads.reveal("download-missing")
                yield* downloads.open("download-missing")

                expect(opened).toEqual({ reveal: [], open: [] })
                expect(yield* items(downloads)).toEqual([])
            }),
        ))
})
