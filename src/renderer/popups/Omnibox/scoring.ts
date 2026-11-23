import type { FavoriteNode, HistoryEntry } from "../../../shared/protocol"
import { hostOf } from "../../common/url/host"

/** Favorites outrank history entries with the same match precision. */
export const FAVORITE_BONUS = 0.75

/** How precisely `rawQuery` matches `entry`:
 * - same: 1
 * - start with: 0.85,
 * - includes: 0.55,
 * - host: 0.35
 * - title: 0.25
 * - else: 0.
 * */
export const urlMatchScore = (entry: { url: string; title: string }, rawQuery: string): number => {
    const needle = rawQuery.trim().toLowerCase()
    if (needle.length === 0) return 0
    const url = entry.url.toLowerCase()
    if (url === needle) return 1
    if (url.startsWith(needle)) return 0.85
    if (url.includes(needle)) return 0.55
    const host = hostOf(entry.url)
    if (host !== null && host.includes(needle)) return 0.35
    if (entry.title.toLowerCase().includes(needle)) return 0.25
    return 0
}

/**
 * Omnibox relevance:
 * URL precision dominates, frequency breaks ties, recency keeps the list alive.
 * Returns 0 when the query does not match.
 */
export const scoreHistoryEntry = (
    entry: HistoryEntry,
    rawQuery: string,
    now: number,
    maxVisitCount = 1,
): number => {
    const urlMatch = urlMatchScore(entry, rawQuery)
    if (urlMatch === 0) return 0
    const denominator = Math.log1p(Math.max(1, maxVisitCount))
    const frequency = denominator > 0 ? Math.log1p(entry.visitCount) / denominator : 0
    const ageHours = Math.max(0, (now - entry.lastVisitedAt) / 3_600_000)
    const recency = 1 / (1 + ageHours / 24)
    return urlMatch * 2 + frequency + recency * 0.5
}

/**
 * Favorites relevance:
 * the history formula, with frequency/recency borrowed from the history entry for the same URL when there is one,
 * plus a fixed bonus so a favorite outranks history with the same match.
 * Folders (`url === null`) never score.
 */
export const scoreFavorite = (
    favorite: FavoriteNode,
    rawQuery: string,
    now: number,
    historyByUrl: ReadonlyMap<string, HistoryEntry>,
    maxVisitCount = 1,
): number => {
    if (favorite.url === null) return 0
    const urlMatch = urlMatchScore({ url: favorite.url, title: favorite.name }, rawQuery)
    if (urlMatch === 0) return 0
    const history = historyByUrl.get(favorite.url)
    const denominator = Math.log1p(Math.max(1, maxVisitCount))
    const frequency = history && denominator > 0 ? Math.log1p(history.visitCount) / denominator : 0
    const ageHours = history ? Math.max(0, (now - history.lastVisitedAt) / 3_600_000) : 0
    const recency = history ? 1 / (1 + ageHours / 24) : 0
    return urlMatch * 2 + frequency + recency * 0.5 + FAVORITE_BONUS
}
