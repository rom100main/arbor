// Should be Effect free

import type { HistoryRetention as HistoryRetentionKind } from "../../shared/settings"

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
