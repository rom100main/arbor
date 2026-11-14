// Shared chrome.storage bridge for extension contexts (frames + service workers).
//
// Container sessions each load their own extension stack,
// so native chrome.storage would be per-partition (N extensions).
// This preload replaces the storage areas with IPC calls into one main-process store shared by every session.
// Firefox Multi-Account Containers semantics: web storage isolated, extensions not.
//
// Must run after electron-chrome-extensions' preload
// (which builds `chrome.storage` and shallow-freezes `chrome`).
// Registered as `arbor-ext-storage-*`.
//
// The main-world function is serialized: it must not reference module-scope bindings.
// The IPC host is exposed via contextBridge first, then picked up as `globalThis`.
// Its shape checks are inline `typeof`/`Reflect` — it cannot import, and `chrome`
// is a foreign global, so some structural reading is irreducible there.

import { contextBridge, ipcRenderer } from "electron"

import type {
    ExtStorageOp,
    StorageAreaName,
    StorageItems,
    StorageKeySelector,
} from "../../shared/extension-storage"

/** Result of one storage op, keyed by the op's discriminant. */
type ExtStorageResult<O extends ExtStorageOp> = O extends { op: "get" }
    ? StorageItems
    : O extends { op: "getBytesInUse" }
      ? number
      : void

interface ExtStorageHost {
    get: (area: StorageAreaName, keys: StorageKeySelector) => Promise<StorageItems>
    set: (area: StorageAreaName, items: StorageItems) => Promise<void>
    remove: (area: StorageAreaName, keys: string | string[]) => Promise<void>
    clear: (area: StorageAreaName) => Promise<void>
    getBytesInUse: (area: StorageAreaName, keys: StorageKeySelector) => Promise<number>
}

/** Main applies the op and returns exactly `ExtStorageResult<O>`; no runtime re-checking. */
const invoke = <O extends ExtStorageOp>(op: O): Promise<ExtStorageResult<O>> =>
    ipcRenderer.invoke("arbor:ext-storage", op)

const host: ExtStorageHost = {
    get: (area, keys) => invoke({ op: "get", area, keys }),
    set: (area, items) => invoke({ op: "set", area, items }),
    remove: (area, keys) => invoke({ op: "remove", area, keys }),
    clear: (area) => invoke({ op: "clear", area }),
    getBytesInUse: (area, keys) => invoke({ op: "getBytesInUse", area, keys }),
}

const HOST_KEY = "__arborExtStorageHost"

/**
 * Serialized into the extension main world:
 * must not reference ANY module-scope binding
 * (the bundler hosts them and they are `undefined` there).
 * Helpers and the host key arrive as locals / args only.
 */
const patchMainWorld = function patchMainWorld(hostKey: string): void {
    const hostApi: unknown = Reflect.get(globalThis, hostKey)
    if (typeof hostApi !== "object" || hostApi === null) return

    const stubEvent = (): Record<string, unknown> => ({
        addListener: (): void => undefined,
        removeListener: (): void => undefined,
        hasListener: (): boolean => false,
    })

    const splitCallback = (
        args: unknown[],
    ): {
        rest: unknown[]
        callback?: (result: unknown) => void
    } => {
        const rest = [...args]
        const last: unknown = rest[rest.length - 1]
        if (typeof last !== "function") return { rest }
        rest.pop()
        return {
            rest,
            callback: (result: unknown) => void Reflect.apply(last, undefined, [result]),
        }
    }

    const settle = (value: unknown, callback?: (result: unknown) => void): unknown => {
        // Promise.resolve adopts thenables, so this is the callback and promise form in one.
        const promise = Promise.resolve(value)
        if (!callback) return promise
        void (async () => {
            try {
                callback(await promise)
            } catch {
                // Callback-style callers ignore failures here.
            }
        })()
        return undefined
    }

    const call = (method: string, area: string, args: unknown[]): unknown => {
        const { rest, callback } = splitCallback(args)
        const fn: unknown = Reflect.get(hostApi, method)
        if (typeof fn !== "function") return undefined
        return settle(Reflect.apply(fn, hostApi, [area, rest[0]]), callback)
    }

    // Chrome StorageArea quota constants.
    // Extensions read them at runtime,
    // replacing an area without them makes every comparison false and every chunk unreadable,
    // so chunked values vanish on reload.
    // Native areas are consulted first, these are the documented values for when the host area exposes none.
    const QUOTA_FALLBACKS: Record<string, Record<string, number>> = {
        local: { QUOTA_BYTES: 10485760, QUOTA_BYTES_PER_ITEM: 5242880, MAX_ITEMS: 512 },
        sync: {
            QUOTA_BYTES: 102400,
            QUOTA_BYTES_PER_ITEM: 8192,
            MAX_ITEMS: 512,
            MAX_WRITE_OPERATIONS_PER_MINUTE: 120,
            MAX_WRITE_OPERATIONS_PER_HOUR: 1800,
            MAX_SUSTAINED_WRITE_OPERATIONS_PER_MINUTE: 120,
        },
        managed: { QUOTA_BYTES: 10485760, QUOTA_BYTES_PER_ITEM: 5242880, MAX_ITEMS: 512 },
        session: { QUOTA_BYTES: 1048576, QUOTA_BYTES_PER_ITEM: 1048576, MAX_ITEMS: 1000 },
    }
    const QUOTA_KEYS = [
        "QUOTA_BYTES",
        "QUOTA_BYTES_PER_ITEM",
        "MAX_ITEMS",
        "MAX_WRITE_OPERATIONS_PER_MINUTE",
        "MAX_WRITE_OPERATIONS_PER_HOUR",
        "MAX_SUSTAINED_WRITE_OPERATIONS_PER_MINUTE",
    ]

    const makeArea = (area: string, source?: unknown): Record<string, unknown> => {
        const result: Record<string, unknown> = {
            get(...args: unknown[]): unknown {
                return call("get", area, args)
            },
            set(...args: unknown[]): unknown {
                return call("set", area, args)
            },
            remove(...args: unknown[]): unknown {
                return call("remove", area, args)
            },
            clear(...args: unknown[]): unknown {
                return call("clear", area, args)
            },
            getBytesInUse(...args: unknown[]): unknown {
                return call("getBytesInUse", area, args)
            },
            onChanged: stubEvent(),
        }
        const fallback = QUOTA_FALLBACKS[area]
        if (fallback) {
            for (const [key, value] of Object.entries(fallback)) result[key] = value
        }
        if (typeof source === "object" && source !== null) {
            for (const key of QUOTA_KEYS) {
                const value: unknown = Reflect.get(source, key)
                if (typeof value === "number") result[key] = value
            }
        }
        return result
    }

    /** Assignment first (survives a throwing setter), then defineProperty for frozen namespaces. */
    const define = (target: object, name: string, value: unknown): void => {
        if (Reflect.set(target, name, value)) return
        try {
            Object.defineProperty(target, name, {
                value,
                configurable: true,
                writable: true,
                enumerable: true,
            })
        } catch {
            // Frozen namespace; leave whatever is there in place.
        }
    }

    const patchStorage = (storage: unknown): void => {
        if (typeof storage !== "object" || storage === null) return
        // sync/managed alias local via canonicalArea in main.
        // The original area is passed so its quota constants survive.
        for (const area of ["local", "sync", "managed", "session"]) {
            define(storage, area, makeArea(area, Reflect.get(storage, area)))
        }
        define(storage, "onChanged", stubEvent())
    }

    const patchNamespace = (rootKey: string): void => {
        const root: unknown = Reflect.get(globalThis, rootKey)
        if (typeof root !== "object" || root === null) return
        let storage: unknown = Reflect.get(root, "storage")
        if (typeof storage !== "object" || storage === null || Array.isArray(storage)) {
            storage = {}
            define(root, "storage", storage)
        }
        patchStorage(storage)
    }

    try {
        patchNamespace("chrome")
        patchNamespace("browser")
    } catch {
        // No chrome/browser global in this context; nothing to patch.
    }

    try {
        Reflect.deleteProperty(globalThis, hostKey)
    } catch {
        // Ignore.
    }
}

const isExtensionContext = (): boolean => {
    if (process.type === "service-worker") return true
    try {
        return globalThis.location?.href?.startsWith("chrome-extension://") ?? false
    } catch {
        return false
    }
}

// Never expose the IPC host to ordinary web pages.
if (isExtensionContext()) {
    try {
        contextBridge.exposeInMainWorld(HOST_KEY, host)
        if ("executeInMainWorld" in contextBridge) {
            contextBridge.executeInMainWorld({ func: patchMainWorld, args: [HOST_KEY] })
        }
    } catch (error) {
        console.error("[arbor] extension-storage-shim failed:", error)
    }
}
