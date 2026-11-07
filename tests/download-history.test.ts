import { Context, Effect, Exit, Layer, Scope } from "effect"
import { TestClock } from "effect/testing"
import type { Session } from "electron"
import { beforeEach, describe, expect, it, vi } from "vite-plus/test"

import { Downloads } from "../src/main/downloads/downloads"
import { decodeHistory, MAX_HISTORY } from "../src/main/downloads/history"
import { DEFAULT_DEBOUNCE } from "../src/main/persistence/persisted-ref"
import { SettingsStore } from "../src/main/settings"
import type { DownloadInfo } from "../src/shared/protocol"
import { runTest, settle } from "./support/effect"
import { files, writeCount } from "./support/memory-fs"

vi.mock("node:fs", () => import("./support/memory-fs"))
beforeEach(() => {
    files.clear()
    writeCount.value = 0
})

const HISTORY = "/data/downloads.json"
const SETTINGS = "/data/settings.json"

const record = (overrides: Partial<DownloadInfo> = {}): DownloadInfo => ({
    id: "download-1",
    filename: "a.txt",
    savePath: "/Downloads/a.txt",
    url: "https://example.com/a.txt",
    state: "completed",
    receivedBytes: 10,
    totalBytes: 10,
    startedAt: 1,
    finishedAt: 2,
    ...overrides,
})

const onDisk = (): unknown => JSON.parse(files.get(HISTORY)!)

const open = () =>
    Effect.gen(function* () {
        const scope = yield* Scope.make()
        const context = yield* Layer.buildWithScope(
            Downloads.layer({
                folder: "/Downloads",
                historyPath: HISTORY,
                opener: { reveal: () => {}, open: () => {} },
            }).pipe(Layer.provideMerge(SettingsStore.layer(SETTINGS))),
            scope,
        )
        return { downloads: Context.get(context, Downloads), scope }
    })

describe("decodeHistory", () => {
    it("keeps valid settled entries and skips the rest", () => {
        const decoded = decodeHistory([
            record(),
            record({ id: "download-2", state: "progressing" }),
            { ...record(), id: "not-a-download-id" },
            { nope: true },
        ])
        expect(decoded?.map((item) => item.id)).toEqual(["download-1"])
    })

    it("returns null when the payload is not an array", () => {
        expect(decodeHistory({})).toBeNull()
        expect(decodeHistory("nope")).toBeNull()
    })
})

describe("download history", () => {
    it("loads the file and keeps append order for the popup's reverse", () =>
        runTest(
            Effect.gen(function* () {
                files.set(
                    HISTORY,
                    JSON.stringify([
                        record({ id: "download-2", filename: "new.txt" }),
                        record({ id: "download-1", filename: "old.txt" }),
                    ]),
                )
                const { downloads } = yield* open()
                const snapshot = yield* downloads.snapshot
                expect(snapshot.items.map((item) => item.id)).toEqual(["download-1", "download-2"])
            }),
        ))

    it("caps the loaded list at 100, dropping the oldest", () =>
        runTest(
            Effect.gen(function* () {
                const newestFirst = Array.from({ length: MAX_HISTORY + 5 }, (_, index) =>
                    record({
                        id: `download-${MAX_HISTORY + 4 - index}`,
                        filename: `${MAX_HISTORY + 4 - index}.txt`,
                    }),
                )
                files.set(HISTORY, JSON.stringify(newestFirst))
                const { downloads } = yield* open()
                const items = (yield* downloads.snapshot).items
                expect(items).toHaveLength(MAX_HISTORY)
                expect(items[0].id).toBe("download-5")
                expect(items.at(-1)?.id).toBe(`download-${MAX_HISTORY + 4}`)
            }),
        ))

    it("writes a settled download after the debounce, and it loads back", () =>
        runTest(
            Effect.gen(function* () {
                const { downloads, scope } = yield* open()
                const session = new FakeSession()
                // oxlint-disable-next-line typescript/no-unsafe-type-assertion
                yield* downloads.attach(session as unknown as Session)

                const item = new FakeItem("report.pdf", "https://example.com/report.pdf", 42)
                session.emit("will-download", {}, item)
                item.received = 42
                item.state = "completed"
                item.emit("done", {}, "completed")

                yield* settle
                expect(writeCount.value).toBe(0)
                yield* TestClock.adjust(DEFAULT_DEBOUNCE)
                yield* settle
                expect(onDisk()).toMatchObject([
                    {
                        filename: "report.pdf",
                        state: "completed",
                        receivedBytes: 42,
                        totalBytes: 42,
                    },
                ])

                // What was written is what the next run starts from.
                yield* Scope.close(scope, Exit.void)
                const reopened = yield* open()
                const items = (yield* reopened.downloads.snapshot).items
                expect(items.map((saved) => saved.filename)).toEqual(["report.pdf"])
            }),
        ))

    it("does not write a download that is still running at quit", () =>
        runTest(
            Effect.gen(function* () {
                const { downloads, scope } = yield* open()
                const session = new FakeSession()
                // oxlint-disable-next-line typescript/no-unsafe-type-assertion
                yield* downloads.attach(session as unknown as Session)
                session.emit(
                    "will-download",
                    {},
                    new FakeItem("slow.bin", "https://example.com/slow.bin", 0),
                )

                yield* Scope.close(scope, Exit.void)
                expect(files.has(HISTORY)).toBe(false)
            }),
        ))

    it("removes an entry from the file; an unknown id writes nothing", () =>
        runTest(
            Effect.gen(function* () {
                files.set(
                    HISTORY,
                    JSON.stringify([record({ id: "download-2" }), record({ id: "download-1" })]),
                )
                const { downloads } = yield* open()

                yield* downloads.remove("download-missing")
                yield* TestClock.adjust(DEFAULT_DEBOUNCE)
                yield* settle
                expect(writeCount.value).toBe(0)

                yield* downloads.remove("download-1")
                yield* TestClock.adjust(DEFAULT_DEBOUNCE)
                yield* settle
                expect(onDisk()).toMatchObject([{ id: "download-2" }])
            }),
        ))

    it("clearSettled drops settled entries and keeps an active one", () =>
        runTest(
            Effect.gen(function* () {
                files.set(
                    HISTORY,
                    JSON.stringify([
                        record({ id: "download-2", state: "interrupted" }),
                        record({ id: "download-1" }),
                    ]),
                )
                const { downloads } = yield* open()
                const session = new FakeSession()
                // oxlint-disable-next-line typescript/no-unsafe-type-assertion
                yield* downloads.attach(session as unknown as Session)
                session.emit(
                    "will-download",
                    {},
                    new FakeItem("live.bin", "https://example.com/live.bin", 0),
                )

                yield* downloads.clearSettled
                const items = (yield* downloads.snapshot).items
                expect(items.map((saved) => saved.filename)).toEqual(["live.bin"])

                yield* TestClock.adjust(DEFAULT_DEBOUNCE)
                yield* settle
                expect(onDisk()).toEqual([])
            }),
        ))
})

type Listener = (...args: unknown[]) => void

/** The slice of Electron's EventEmitter the Downloads service uses. */
class FakeEmitter {
    private readonly listeners = new Map<string, Listener[]>()

    on(name: string, listener: Listener): void {
        const list = this.listeners.get(name) ?? []
        list.push(listener)
        this.listeners.set(name, list)
    }

    off(name: string, listener: Listener): void {
        this.listeners.set(
            name,
            (this.listeners.get(name) ?? []).filter((candidate) => candidate !== listener),
        )
    }

    emit(name: string, ...args: unknown[]): void {
        for (const listener of [...(this.listeners.get(name) ?? [])]) listener(...args)
    }
}

class FakeSession extends FakeEmitter {}

/** The slice of Electron's DownloadItem the service reads. */
class FakeItem extends FakeEmitter {
    savePath = ""
    received = 0
    state = "progressing"

    readonly filename: string
    readonly url: string
    readonly totalBytes: number

    constructor(filename: string, url: string, totalBytes: number) {
        super()
        this.filename = filename
        this.url = url
        this.totalBytes = totalBytes
    }

    getFilename = (): string => this.filename
    getURL = (): string => this.url
    getTotalBytes = (): number => this.totalBytes
    getReceivedBytes = (): number => this.received
    getState = (): string => this.state
    getSavePath = (): string => this.savePath
    setSaveDialogOptions = (): void => {}
    setSavePath = (path: string): void => {
        this.savePath = path
    }
    cancel = (): void => {
        this.state = "cancelled"
    }

    once(name: string, listener: Listener): void {
        const wrapper: Listener = (...args) => {
            this.off(name, wrapper)
            listener(...args)
        }
        this.on(name, wrapper)
    }
}
