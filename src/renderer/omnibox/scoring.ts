import type { HistoryEntry } from "../../shared/protocol"

/** Host portion of a URL, or null when it cannot be parsed. */
export const hostOf = (url: string): string | null => {
    try {
        return new URL(url).hostname.toLowerCase()
    } catch {
        return null
    }
}

/** How precisely `rawQuery` matches `entry`:
 * - same: 1
 * - start with: 0.85,
 * - includes: 0.55,
 * - host: 0.35
 * - title: 0.25
 * - else: 0.
 * */
export const urlMatchScore = (entry: HistoryEntry, rawQuery: string): number => {
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
