import { Schema } from "effect"

import type {
    ExtStorageOp,
    StorageAreaName,
    StorageItems,
    StorageKeySelector,
} from "../../shared/extension-storage"
import { decodeOr } from "../persistence/decode"

/** `sync`/`managed` alias `local` (matches electron-chrome-extensions). */
export type CanonicalArea = "local" | "session"

export interface ExtStorageAreas {
    local: StorageItems
    session: StorageItems
}

export const emptyExtStorageAreas = (): ExtStorageAreas => ({ local: {}, session: {} })

export const canonicalArea = (area: StorageAreaName): CanonicalArea =>
    area === "session" ? "session" : "local"

const StorageAreaNameSchema = Schema.Literals(["local", "session", "sync", "managed"])
const StorageItemsSchema = Schema.Record(Schema.String, Schema.Unknown)
const KeyListSchema = Schema.Union([Schema.String, Schema.mutable(Schema.Array(Schema.String))])
const StorageKeysSchema = Schema.optionalKey(
    Schema.NullishOr(
        Schema.Union([
            Schema.String,
            Schema.mutable(Schema.Array(Schema.String)),
            StorageItemsSchema,
        ]),
    ),
)

const ExtStorageOpSchema = Schema.Union([
    Schema.Struct({
        op: Schema.Literal("get"),
        area: StorageAreaNameSchema,
        keys: StorageKeysSchema,
    }),
    Schema.Struct({
        op: Schema.Literal("set"),
        area: StorageAreaNameSchema,
        items: StorageItemsSchema,
    }),
    Schema.Struct({
        op: Schema.Literal("remove"),
        area: StorageAreaNameSchema,
        keys: KeyListSchema,
    }),
    Schema.Struct({ op: Schema.Literal("clear"), area: StorageAreaNameSchema }),
    Schema.Struct({
        op: Schema.Literal("getBytesInUse"),
        area: StorageAreaNameSchema,
        keys: StorageKeysSchema,
    }),
])

/** IPC boundary: `null` unless `value` is a well-formed storage op. */
export const parseExtStorageOp: (value: unknown) => ExtStorageOp | null =
    decodeOr(ExtStorageOpSchema)

const toKeyList = (keys: string | string[]): string[] => (typeof keys === "string" ? [keys] : keys)

const selectKeys = (items: StorageItems, keys: StorageKeySelector): string[] => {
    if (keys === null || keys === undefined) return Object.keys(items)
    if (typeof keys === "string") return keys in items ? [keys] : []
    if (Array.isArray(keys)) return keys.filter((key) => key in items)
    return Object.keys(keys).filter((key) => key in items)
}

const pickItems = (items: StorageItems, keys: StorageKeySelector): StorageItems => {
    if (keys !== null && keys !== undefined && typeof keys !== "string" && !Array.isArray(keys)) {
        const result: StorageItems = {}
        for (const [key, fallback] of Object.entries(keys)) {
            result[key] = key in items ? items[key] : fallback
        }
        return result
    }
    const result: StorageItems = {}
    for (const key of selectKeys(items, keys)) result[key] = items[key]
    return result
}

const byteLength = (key: string, value: unknown): number => {
    try {
        return key.length + JSON.stringify(value ?? null).length
    } catch {
        return key.length
    }
}

/**
 * Pure chrome.storage.local/session semantics over a plain object map.
 * Writes are applied immutably so callers can treat areas as persistent values.
 */
export const applyExtStorageOp = (
    areas: ExtStorageAreas,
    op: ExtStorageOp,
): { areas: ExtStorageAreas; result: unknown } => {
    const name = canonicalArea(op.area)
    const current = areas[name]

    switch (op.op) {
        case "get":
            return { areas, result: pickItems(current, op.keys) }
        case "set": {
            const next: StorageItems = { ...current }
            for (const [key, value] of Object.entries(op.items)) next[key] = value
            return { areas: { ...areas, [name]: next }, result: undefined }
        }
        case "remove": {
            const next: StorageItems = { ...current }
            for (const key of toKeyList(op.keys)) delete next[key]
            return { areas: { ...areas, [name]: next }, result: undefined }
        }
        case "clear":
            return { areas: { ...areas, [name]: {} }, result: undefined }
        case "getBytesInUse": {
            let total = 0
            for (const key of selectKeys(current, op.keys)) {
                total += byteLength(key, current[key])
            }
            return { areas, result: total }
        }
        default:
            return { areas, result: undefined }
    }
}

export const EXT_STORAGE_PERSIST_VERSION = 1

/** On-disk shape: only `local` survives relaunch (`session` is memory-only). */
export interface PersistedExtStorage {
    version: typeof EXT_STORAGE_PERSIST_VERSION
    extensions: Record<string, StorageItems>
}

const PersistedExtStorageSchema = Schema.Struct({
    version: Schema.Literal(EXT_STORAGE_PERSIST_VERSION),
    extensions: Schema.Record(Schema.String, Schema.Unknown),
})

export const toPersistedExtStorage = (
    extensions: Record<string, ExtStorageAreas>,
): PersistedExtStorage => ({
    version: EXT_STORAGE_PERSIST_VERSION,
    extensions: Object.fromEntries(
        Object.entries(extensions).map(([id, areas]) => [id, { ...areas.local }]),
    ),
})

export const fromPersistedExtStorage = (data: unknown): Record<string, ExtStorageAreas> | null => {
    const payload = decodeOr(PersistedExtStorageSchema)(data)
    if (!payload) return null
    const result: Record<string, ExtStorageAreas> = {}
    for (const [id, raw] of Object.entries(payload.extensions)) {
        const items = decodeOr(StorageItemsSchema)(raw)
        if (!items) continue
        result[id] = { local: { ...items }, session: {} }
    }
    return result
}
