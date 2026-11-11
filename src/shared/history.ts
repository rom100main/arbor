// Should be Effect free

import type { HistoryEntry } from "./protocol"

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
