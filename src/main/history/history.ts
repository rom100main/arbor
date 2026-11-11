/**
 * What survives a restart: visited pages, deduplicated by URL.
 *
 * Stored as a newest-first JSON array in `history.json`, beside `state.json`.
 * Bad entries are skipped.
 */

import { HistoryEntry, type HistoryEntry as HistoryEntryType } from "../../shared/protocol"
import { decodeOr } from "../persistence/decode"

const decodeEntry = decodeOr(HistoryEntry)

export const decodeHistory = (data: unknown): ReadonlyArray<HistoryEntryType> | null => {
    if (!Array.isArray(data)) return null
    return data.flatMap((entry) => {
        const parsed = decodeEntry(entry)
        return parsed ? [parsed] : []
    })
}

export const MAX_HISTORY_ENTRIES = 10_000
