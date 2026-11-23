import type { BrowserSnapshot, FavoriteNode, HistoryEntry, TabNode } from "../../../shared/protocol"
import { DEFAULT_SEARCH_TEMPLATE } from "../../../shared/settings"
import { omniboxTarget } from "../../../shared/url"
import { scoreFavorite, scoreHistoryEntry } from "./scoring"

const MAX_TAB_SUGGESTIONS = 3
const MAX_SCORED_SUGGESTIONS = 5

export type Suggestion =
    | { kind: "go"; target: string; query: string }
    | { kind: "tab"; tab: TabNode }
    | { kind: "history"; entry: HistoryEntry; score: number }
    | { kind: "favorite"; favorite: FavoriteNode; score: number }

export const computeSuggestions = (
    snap: BrowserSnapshot | null,
    raw: string,
    searchTemplate: string = DEFAULT_SEARCH_TEMPLATE,
    historyEntries: ReadonlyArray<HistoryEntry> = [],
    favorites: ReadonlyArray<FavoriteNode> = [],
    now: number = Date.now(),
): Suggestion[] => {
    const query = raw.trim()
    const list: Suggestion[] = [
        {
            kind: "go",
            target: query.length > 0 ? omniboxTarget(query, searchTemplate) : "",
            query,
        },
    ]
    if (query.length === 0) return list
    const needle = query.toLowerCase()
    const tabUrls = new Set<string>()
    if (snap) {
        const matches = snap.tabs
            .filter(
                (tab) =>
                    tab.title.toLowerCase().includes(needle) ||
                    tab.url.toLowerCase().includes(needle),
            )
            .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
            .slice(0, MAX_TAB_SUGGESTIONS)
        for (const tab of matches) {
            list.push({ kind: "tab", tab })
            tabUrls.add(tab.url)
        }
    }
    const maxVisitCount = historyEntries.reduce((max, entry) => Math.max(max, entry.visitCount), 1)
    const historyByUrl = new Map(historyEntries.map((entry) => [entry.url, entry]))
    const favoriteUrls = new Set<string>()
    const scoredFavorites = favorites.flatMap((favorite) => {
        if (favorite.url === null || tabUrls.has(favorite.url) || favoriteUrls.has(favorite.url))
            return []
        const score = scoreFavorite(favorite, query, now, historyByUrl, maxVisitCount)
        if (score <= 0) return []
        favoriteUrls.add(favorite.url)
        return [{ favorite, score }]
    })
    const scoredHistory = historyEntries
        .filter((entry) => !tabUrls.has(entry.url) && !favoriteUrls.has(entry.url))
        .map((entry) => ({ entry, score: scoreHistoryEntry(entry, query, now, maxVisitCount) }))
        .filter((item) => item.score > 0)
    const merged = [
        ...scoredFavorites.map(({ favorite, score }) => ({
            kind: "favorite" as const,
            favorite,
            score,
        })),
        ...scoredHistory.map(({ entry, score }) => ({ kind: "history" as const, entry, score })),
    ]
    merged
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_SCORED_SUGGESTIONS)
        .forEach((suggestion) => list.push(suggestion))
    return list
}

/**
 * Move the selection by `delta`, wrapping around both ends:
 * up from the first item cycles to the last, down from the last cycles to the first.
 * An empty list or a non-positive count stays at zero.
 */
export const moveSuggestionSelection = (current: number, delta: number, count: number): number => {
    if (count <= 0) return 0
    return (current + delta + count) % count
}
