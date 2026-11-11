import { Context, Effect, Layer, Scope } from "effect"
import { TestClock } from "effect/testing"
import { beforeEach, describe, expect, it, vi } from "vite-plus/test"

import { decodeHistory } from "../src/main/history/history"
import { History } from "../src/main/history/service"
import { SettingsStore } from "../src/main/settings"
import { computeSuggestions } from "../src/renderer/omnibox/suggestions"
import { isRecordableUrl, scoreHistoryEntry, stripFragment } from "../src/shared/history"
import type { ContainerId, HistoryEntry, TabId } from "../src/shared/protocol"
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

    it("returns null when the payload is not an array", () => {
        expect(decodeHistory({})).toBeNull()
        expect(decodeHistory("nope")).toBeNull()
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

describe("history scoring", () => {
    const NOW = 10_000_000_000
    const base = entry({ lastVisitedAt: NOW - 3_600_000, visitCount: 3 })

    it("ranks an exact URL above a substring, and a substring above a title hit", () => {
        const exact = scoreHistoryEntry(base, "https://example.com/page", NOW, 10)
        const substring = scoreHistoryEntry(base, "example.com/pa", NOW, 10)
        const title = scoreHistoryEntry(base, "exam", NOW, 10)
        expect(exact).toBeGreaterThan(substring)
        expect(substring).toBeGreaterThan(0)
        expect(title).toBeGreaterThan(0)
        expect(scoreHistoryEntry(base, "no-match-xyz", NOW, 10)).toBe(0)
    })

    it("prefers frequent entries among equal URL precision", () => {
        const frequent = entry({ url: "https://a.test/", visitCount: 20 })
        const rare = entry({ url: "https://a.test/x", visitCount: 1 })
        const frequentScore = scoreHistoryEntry(frequent, "a.test", NOW, 20)
        const rareScore = scoreHistoryEntry(rare, "a.test", NOW, 20)
        expect(frequentScore).toBeGreaterThan(rareScore)
    })
})

describe("omnibox history suggestions", () => {
    const NOW = 10_000_000_000

    it("appends ranked history after the go action, capped at 5", () => {
        const entries = Array.from({ length: 7 }, (_, index) =>
            entry({
                id: `history-${index}` as HistoryEntry["id"],
                url: `https://site.test/page-${index}`,
                title: `Page ${index}`,
                lastVisitedAt: NOW - index * 1000,
                visitCount: index + 1,
            }),
        )
        const suggestions = computeSuggestions(null, "site.test", undefined, entries, NOW)
        expect(suggestions[0].kind).toBe("go")
        const kinds = suggestions.slice(1).map((s) => s.kind)
        expect(kinds).toEqual(["history", "history", "history", "history", "history"])
    })

    it("skips a history entry already shown as a tab", () => {
        const tab = {
            id: "tab-1" as TabId,
            containerId: "container-1" as ContainerId,
            parentId: null,
            order: 0,
            url: "https://site.test/page-0",
            title: "Page 0",
            collapsed: false,
            userLabel: null,
            favicon: null,
            lastActiveAt: NOW,
        }
        const snap = {
            containers: [],
            tabs: [tab],
            activeContainerId: null,
            activeTabId: null,
        }
        const suggestions = computeSuggestions(
            snap,
            "site.test",
            undefined,
            [entry({ url: "https://site.test/page-0", lastVisitedAt: NOW })],
            NOW,
        )
        expect(suggestions.some((s) => s.kind === "history")).toBe(false)
        expect(suggestions.some((s) => s.kind === "tab")).toBe(true)
    })
})
