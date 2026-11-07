/**
 * What survives a restart: settled downloads only.
 *
 * A download still running when Arbor quits is not written.
 * There is no resume, so a stale `progressing` entry would only be confusing.
 */

import { Schema } from "effect"

import { decodeOr } from "../../shared/decode"
import { DownloadId, type DownloadInfo } from "../../shared/protocol"

const SettledState = Schema.Literals(["completed", "cancelled", "interrupted"])

const PersistedDownload = Schema.Struct({
    id: DownloadId,
    filename: Schema.String,
    savePath: Schema.NullOr(Schema.String),
    url: Schema.String,
    state: SettledState,
    receivedBytes: Schema.Finite,
    totalBytes: Schema.Finite,
    startedAt: Schema.Finite,
    finishedAt: Schema.Finite,
})

const decodeEntry = decodeOr(PersistedDownload)

/** One bad entry is skipped; a payload that is not an array is unreadable. */
export const decodeHistory = (data: unknown): ReadonlyArray<DownloadInfo> | null => {
    if (!Array.isArray(data)) return null
    return data.flatMap((entry) => {
        const parsed = decodeEntry(entry)
        return parsed ? [parsed] : []
    })
}

export const MAX_HISTORY = 100
