import { Context, Effect, Layer, Scope } from "effect"
import { TestClock } from "effect/testing"
import { beforeEach, describe, expect, it, vi } from "vite-plus/test"

import { decodeHistory } from "../src/main/history/history"
import { isRecordableUrl, stripFragment } from "../src/main/history/record"
import { History } from "../src/main/history/service"
import { SettingsStore } from "../src/main/settings"
import type { HistoryEntry } from "../src/shared/protocol"
import { runTest, settle } from "./support/effect"
import { files } from "./support/memory-fs"

vi.mock("node:fs", () => import("./support/memory-fs"))
beforeEach(() => files.clear())

const HISTORY = "/data/history.json"
const SETTINGS = "/data/settings.json"

const entry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
    id: "history-1",
    url: "https://example.com/page",
    title: "Example",
    favicon: null,
    containerId: "container-1",
    firstVisitedAt: 1_000,
    lastVisitedAt: 1_000,
    visitCount: 1,
    ...overrides,
})

const open = (historyPath = HISTORY) =>
    Effect.gen(function* () {
        const scope = yield* Scope.make()
        const context = yield* Layer.buildWithScope(
            History.layer({ historyPath }).pipe(Layer.provideMerge(SettingsStore.layer(SETTINGS))),
            scope,
        )
        return { history: Context.get(context, History), scope }
    })

const visit = (
    h: History["Service"],
    url: string,
    containerId: HistoryEntry["containerId"] = "container-1",
) => h.visit({ url, containerId })

describe("decodeHistory", () => {
    it("keeps valid entries and skips the rest", () => {
        const decoded = decodeHistory([
            entry(),
            { ...entry(), id: "not-a-history-id" },
            { nope: true },
        ])
        expect(decoded?.map((e) => e.id)).toEqual(["history-1"])
    })
})

describe("history helpers", () => {
    it("strips the fragment but keeps the query", () => {
        expect(stripFragment("https://x.test/a?q=1#frag")).toBe("https://x.test/a?q=1")
        expect(stripFragment("https://x.test/a")).toBe("https://x.test/a")
    })

    it("skips internal and empty URLs", () => {
        expect(isRecordableUrl("about:blank")).toBe(false)
        expect(isRecordableUrl("arbor://history")).toBe(false)
        expect(isRecordableUrl("https://example.com/")).toBe(true)
        expect(isRecordableUrl("")).toBe(false)
    })
})

describe("history service", () => {
    it("creates an entry, then bumps its visit count", () =>
        runTest(
            Effect.gen(function* () {
                const { history } = yield* open()
                yield* visit(history, "https://example.com/a")
                yield* TestClock.adjust(1000)
                yield* settle
                yield* visit(history, "https://example.com/a")
                const snapshot = yield* history.snapshot
                expect(snapshot.totalCount).toBe(1)
                expect(snapshot.entries[0].visitCount).toBe(2)
            }),
        ))

    it("updates the container to the last container the URL was visited from", () =>
        runTest(
            Effect.gen(function* () {
                const { history } = yield* open()
                yield* visit(history, "https://example.com/a", "container-1")
                yield* TestClock.adjust(1000)
                yield* settle
                yield* visit(history, "https://example.com/a", "container-2")
                const snapshot = yield* history.snapshot
                expect(snapshot.entries[0].containerId).toBe("container-2")
                yield* history.inPage("https://example.com/a#section", "container-3")
                expect((yield* history.snapshot).entries[0].containerId).toBe("container-3")
            }),
        ))

    it("dedupes by fragment-stripped URL", () =>
        runTest(
            Effect.gen(function* () {
                const { history } = yield* open()
                yield* visit(history, "https://example.com/a#one")
                yield* visit(history, "https://example.com/a#two")
                const snapshot = yield* history.snapshot
                expect(snapshot.totalCount).toBe(1)
                expect(snapshot.entries[0].visitCount).toBe(2)
            }),
        ))

    it("ignores about: and arbor: URLs", () =>
        runTest(
            Effect.gen(function* () {
                const { history } = yield* open()
                yield* visit(history, "about:blank")
                yield* visit(history, "arbor://settings")
                expect((yield* history.snapshot).totalCount).toBe(0)
            }),
        ))

    it("merges a late title and favicon, ignoring an empty title", () =>
        runTest(
            Effect.gen(function* () {
                const { history } = yield* open()
                yield* visit(history, "https://example.com/a")
                yield* history.meta("https://example.com/a", {
                    title: "Page A",
                    favicon: "data:,",
                })
                yield* history.meta("https://example.com/a", { title: "" })
                const [first] = (yield* history.snapshot).entries
                expect(first.title).toBe("Page A")
                expect(first.favicon).toBe("data:,")
            }),
        ))

    it("bumps recency without a new visit count on in-page navigation", () =>
        runTest(
            Effect.gen(function* () {
                const { history } = yield* open()
                yield* visit(history, "https://example.com/a")
                const before = (yield* history.snapshot).entries[0].lastVisitedAt
                yield* TestClock.adjust(5000)
                yield* settle
                yield* history.inPage("https://example.com/a#section")
                const [first] = (yield* history.snapshot).entries
                expect(first.visitCount).toBe(1)
                expect(first.lastVisitedAt).toBeGreaterThan(before)
            }),
        ))

    it("removes by id and clears before a cutoff; unknown ids are no-ops", () =>
        runTest(
            Effect.gen(function* () {
                const { history } = yield* open()
                yield* visit(history, "https://example.com/a")
                yield* TestClock.adjust(1000)
                yield* settle
                yield* visit(history, "https://example.com/b")
                yield* history.remove(["history-missing"])
                expect((yield* history.snapshot).totalCount).toBe(2)
                const [second] = (yield* history.snapshot).entries
                yield* history.remove([second.id])
                expect((yield* history.snapshot).totalCount).toBe(1)
                yield* history.clearBefore(second.lastVisitedAt)
                expect((yield* history.snapshot).totalCount).toBe(0)
            }),
        ))

    it('clearAfter drops visits newer than the cutoff ("last X" / "after date")', () =>
        runTest(
            Effect.gen(function* () {
                const { history } = yield* open()
                yield* visit(history, "https://example.com/older")
                yield* TestClock.adjust(1000)
                yield* settle
                yield* visit(history, "https://example.com/newer")
                const [first, second] = (yield* history.snapshot).entries
                // Cutoff at the newer visit: the newer one goes, the older stays.
                yield* history.clearAfter(first.lastVisitedAt)
                const snapshot = yield* history.snapshot
                expect(snapshot.totalCount).toBe(1)
                expect(snapshot.entries[0].url).toBe(second.url)
            }),
        ))

    it("prunes entries older than the retention window", () =>
        runTest(
            Effect.gen(function* () {
                const scope = yield* Scope.make()
                const context = yield* Layer.buildWithScope(
                    History.layer({ historyPath: HISTORY }).pipe(
                        Layer.provideMerge(SettingsStore.layer(SETTINGS)),
                    ),
                    scope,
                )
                const settings = Context.get(context, SettingsStore)
                const history = Context.get(context, History)
                yield* settings.set({ historyRetention: "30d" })
                yield* settle
                yield* visit(history, "https://example.com/old")
                yield* settle
                const [first] = (yield* history.snapshot).entries
                expect(first).toBeDefined()
                yield* history.prune(first.lastVisitedAt + 31 * 24 * 60 * 60 * 1000)
                expect((yield* history.snapshot).totalCount).toBe(0)
            }),
        ))

    it("does not record when history is disabled", () =>
        runTest(
            Effect.gen(function* () {
                const scope = yield* Scope.make()
                const context = yield* Layer.buildWithScope(
                    History.layer({ historyPath: HISTORY }).pipe(
                        Layer.provideMerge(SettingsStore.layer(SETTINGS)),
                    ),
                    scope,
                )
                const settings = Context.get(context, SettingsStore)
                const history = Context.get(context, History)
                yield* settings.set({ historyEnabled: false })
                yield* settle
                yield* visit(history, "https://example.com/a")
                expect((yield* history.snapshot).totalCount).toBe(0)
            }),
        ))
})
