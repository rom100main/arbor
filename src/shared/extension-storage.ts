/**
 * The IPC payload for the shared `chrome.storage` bridge.
 * Runtime semantics and persistence live in `main/extension/storage-ops.ts`.
 */

/** Chrome storage areas Arbor bridges across container sessions. */
export type StorageAreaName = "local" | "session" | "sync" | "managed"

export type StorageKeySelector = string | string[] | Record<string, unknown> | null | undefined

export type StorageItems = Record<string, unknown>

export type ExtStorageOp =
    | { op: "get"; area: StorageAreaName; keys?: StorageKeySelector }
    | { op: "set"; area: StorageAreaName; items: StorageItems }
    | { op: "remove"; area: StorageAreaName; keys: string | string[] }
    | { op: "clear"; area: StorageAreaName }
    | { op: "getBytesInUse"; area: StorageAreaName; keys?: StorageKeySelector }
