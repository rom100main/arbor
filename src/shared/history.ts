// Should be Effect free

import type { HistoryEntry } from "./protocol"
import type { HistoryRetention as HistoryRetentionKind } from "./settings"

/** URL that must never become a history entry. */
const SKIPPED_SCHEMES = ["about:", "arbor:", "chrome-extension:", "data:", "blob:"]

export const isRecordableUrl = (url: string): boolean => {
    const trimmed = url.trim()
    if (trimmed.length === 0) return false
    const lower = trimmed.toLowerCase()
    return !SKIPPED_SCHEMES.some((scheme) => lower.startsWith(scheme))
}

/** The dedupe key: query stays (it changes content), fragment goes. */
export const stripFragment = (url: string): string => {
    const index = url.indexOf("#")
    return index === -1 ? url : url.slice(0, index)
}

export const RETENTION_MS: Record<HistoryRetentionKind, number | null> = {
    never: null,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "90d": 90 * 24 * 60 * 60 * 1000,
    "1y": 365 * 24 * 60 * 60 * 1000,
    forever: null,
}

/** Epoch ms before which entries are auto-deleted, or null for no auto-delete. */
export const retentionCutoff = (retention: HistoryRetentionKind, now: number): number | null => {
    const span = RETENTION_MS[retention]
    return span === null ? null : now - span
}

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

/** History-page search: substring over title + URL + container name. */
export const matchesHistoryQuery = (
    entry: HistoryEntry,
    rawQuery: string,
    containerName?: string,
): boolean => {
    const needle = rawQuery.trim().toLowerCase()
    if (needle.length === 0) return true
    if (entry.url.toLowerCase().includes(needle)) return true
    if (entry.title.toLowerCase().includes(needle)) return true
    if (containerName !== undefined && containerName.toLowerCase().includes(needle)) return true
    return false
}
