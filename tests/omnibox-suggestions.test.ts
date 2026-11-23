import { describe, expect, it } from "vite-plus/test"

import { scoreFavorite } from "../src/renderer/popups/Omnibox/scoring"
import { computeSuggestions } from "../src/renderer/popups/Omnibox/suggestions"
import type { BrowserSnapshot, FavoriteNode, HistoryEntry, TabNode } from "../src/shared/protocol"

const NOW = 1_000_000_000_000

const favorite = (overrides: Partial<FavoriteNode> = {}): FavoriteNode => ({
    id: "favorite-1",
    parentId: null,
    order: 0,
    name: "Example",
    url: "https://example.com/",
    favicon: null,
    ...overrides,
})

const entry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
    id: "history-1",
    url: "https://example.com/",
    title: "Example",
    favicon: null,
    containerId: "container-1",
    firstVisitedAt: NOW,
    lastVisitedAt: NOW,
    visitCount: 10,
    ...overrides,
})

const tab = (overrides: Partial<TabNode> = {}): TabNode => ({
    id: "tab-1",
    containerId: "container-1",
    parentId: null,
    order: 0,
    url: "https://example.com/",
    title: "Example",
    collapsed: false,
    userLabel: null,
    favicon: null,
    hibernated: false,
    lastActiveAt: NOW,
    ...overrides,
})

const snapshot = (overrides: Partial<BrowserSnapshot> = {}): BrowserSnapshot => ({
    containers: [],
    tabs: [],
    activeContainerId: null,
    activeTabId: null,
    navigation: { canGoBack: false, canGoForward: false },
    ...overrides,
})

describe("computeSuggestions with favorites", () => {
    it("keeps go first and ranks favorites above history with the same match", () => {
        const result = computeSuggestions(
            snapshot(),
            "example",
            undefined,
            [entry()],
            [favorite()],
            NOW,
        )
        expect(result[0]?.kind).toBe("go")
        const scored = result.slice(1)
        // Same URL favorited and visited: only the favorite survives.
        expect(scored.map((s) => s.kind)).toEqual(["favorite"])
    })

    it("scores an unvisited favorite with match + bonus", () => {
        const score = scoreFavorite(favorite(), "example", NOW, new Map(), 1)
        expect(score).toBeGreaterThan(0)
        // Unvisited: no frequency/recency, so 0.55*2 + 0.75 = 1.85
        expect(score).toBeCloseTo(0.55 * 2 + 0.75, 5)
    })

    it("borrows frequency and recency from history for a visited favorite", () => {
        const history = entry()
        const withoutHistory = scoreFavorite(favorite(), "example", NOW, new Map(), 10)
        const withHistory = scoreFavorite(
            favorite(),
            "example",
            NOW,
            new Map([[history.url, history]]),
            10,
        )
        expect(withHistory).toBeGreaterThan(withoutHistory)
    })

    it("skips folders and open-tab URLs", () => {
        const folder = favorite({ id: "favorite-folder", url: null, name: "example" })
        const result = computeSuggestions(
            snapshot({ tabs: [tab()] }),
            "example",
            undefined,
            [],
            [folder, favorite()],
            NOW,
        )
        expect(result.map((s) => s.kind)).toEqual(["go", "tab"])
    })

    it("does not duplicate a URL that is both favorited and in history", () => {
        const result = computeSuggestions(
            snapshot(),
            "example",
            undefined,
            [entry(), entry({ id: "history-2", url: "https://example.com/other" })],
            [favorite()],
            NOW,
        )
        const urls = result.flatMap((s) =>
            s.kind === "favorite" ? [s.favorite.url] : s.kind === "history" ? [s.entry.url] : [],
        )
        expect(new Set(urls).size).toBe(urls.length)
        expect(urls).toContain("https://example.com/")
    })

    it("dedupes duplicate favorite URLs", () => {
        const result = computeSuggestions(
            snapshot(),
            "example",
            undefined,
            [],
            [favorite(), favorite({ id: "favorite-2" })],
            NOW,
        )
        expect(result.filter((s) => s.kind === "favorite")).toHaveLength(1)
    })
})
