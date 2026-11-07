import { Context, Effect, FiberSet, Layer, Option, type Duration } from "effect"
import {
    ipcMain,
    type IpcMainInvokeEvent,
    type IpcMainServiceWorkerInvokeEvent,
    type ServiceWorkerMain,
    type Session,
} from "electron"

import type { ExtStorageOp, StorageItems } from "../../shared/extension-storage"
import { readJson } from "../persistence/json-file"
import * as PersistedRef from "../persistence/persisted-ref"
import {
    applyExtStorageOp,
    emptyExtStorageAreas,
    fromPersistedExtStorage,
    parseExtStorageOp,
    toPersistedExtStorage,
    type ExtStorageAreas,
} from "./storage-ops"

/** Frame invoke (extension pages) and service-worker invoke carry different event shapes. */
type StorageInvokeEvent = IpcMainInvokeEvent | IpcMainServiceWorkerInvokeEvent

export interface ExtensionStorageService {
    /** Apply one chrome.storage op for the extension that sent `event`. */
    readonly handle: (event: StorageInvokeEvent, op: ExtStorageOp) => Effect.Effect<unknown>
    /** Drop an extension's areas (uninstall teardown). */
    readonly purge: (extensionId: string) => Effect.Effect<void>
    /** Serve the service workers of `session`: each one has its own IPC bus, not `ipcMain`. */
    readonly bind: (session: Session) => Effect.Effect<void>
}

const EXTENSION_URL = /^chrome-extension:\/\/([^/?#]+)/

const extensionIdOf = (event: StorageInvokeEvent): string | null => {
    // Service worker: scope/scriptURL is chrome-extension://<id>/...
    if ("serviceWorker" in event) {
        const worker = event.serviceWorker
        const fromScope = EXTENSION_URL.exec(worker?.scope ?? "")
        if (fromScope?.[1]) return fromScope[1]
        const fromScript = EXTENSION_URL.exec(worker?.scriptURL ?? "")
        if (fromScript?.[1]) return fromScript[1]
    }
    // Frame: senderFrame.url (extension pages / popups).
    if ("senderFrame" in event) {
        const fromFrame = EXTENSION_URL.exec(event.senderFrame?.url ?? "")
        if (fromFrame?.[1]) return fromFrame[1]
    }
    if ("sender" in event && event.sender) {
        const fromSender = EXTENSION_URL.exec(event.sender.getURL?.() ?? "")
        if (fromSender?.[1]) return fromSender[1]
    }
    return null
}

type LocalAreas = Readonly<Record<string, StorageItems>>

const encodeLocal = (local: LocalAreas): unknown =>
    toPersistedExtStorage(
        Object.fromEntries(
            Object.entries(local).map(([id, items]) => [id, { local: items, session: {} }]),
        ),
    )

const decodeLocal = (data: unknown): LocalAreas | null => {
    const restored = fromPersistedExtStorage(data)
    if (!restored) return null
    return Object.fromEntries(Object.entries(restored).map(([id, areas]) => [id, areas.local]))
}

const CHANNEL = "arbor:ext-storage"

/**
 * Single authoritative chrome.storage for every container session
 * (Firefox model: containers isolate web storage, extensions share one store).
 * `local`/`sync`/`managed` persist to disk, `session` is process-lifetime only, so it lives in a `Map`.
 * Each op is applied atomically in main, so N extension service workers cannot interleave.
 */
const make = (path: string, debounce?: Duration.Input) =>
    Effect.gen(function* () {
        const local = yield* PersistedRef.make<LocalAreas>({
            path,
            read: readJson(path, decodeLocal),
            encode: encodeLocal,
            empty: () => ({}),
            debounce,
        })
        const session = new Map<string, StorageItems>()

        const handle = (event: StorageInvokeEvent, op: ExtStorageOp): Effect.Effect<unknown> => {
            const extensionId = extensionIdOf(event)
            if (!extensionId) {
                return Effect.die(new Error("arbor:ext-storage requires an extension sender"))
            }
            return local.modifySome((all) => {
                const before: ExtStorageAreas = {
                    ...emptyExtStorageAreas(),
                    ...(all[extensionId] && { local: all[extensionId] }),
                    ...(session.has(extensionId) && { session: session.get(extensionId) }),
                }
                const { areas, result } = applyExtStorageOp(before, op)
                if (areas.session !== before.session) session.set(extensionId, areas.session)
                // Only a changed `local` area is a change to the file.
                return [
                    result,
                    areas.local !== before.local
                        ? Option.some({ ...all, [extensionId]: areas.local })
                        : Option.none(),
                ] as const
            })
        }

        const purge = (extensionId: string): Effect.Effect<void> =>
            Effect.suspend(() => {
                session.delete(extensionId)
                return local.modifySome((all) => {
                    if (!(extensionId in all)) return [undefined, Option.none()] as const
                    const { [extensionId]: _dropped, ...rest } = all
                    return [undefined, Option.some(rest)] as const
                })
            })

        const runPromise = yield* FiberSet.makeRuntimePromise()
        const dispatch = (event: StorageInvokeEvent, op: unknown): Promise<unknown> => {
            const decoded = parseExtStorageOp(op)
            if (!decoded) return Promise.reject(new Error(`Invalid ${CHANNEL} request`))
            return runPromise(handle(event, decoded))
        }

        // Extension pages and popups call this through `ipcMain`.
        // The extension ID comes from the sending frame (`event.senderFrame`).
        // `IpcTransport` only passes the sender's web contents, not the frame, so this handler skips it.
        yield* Effect.acquireRelease(
            Effect.sync(() => ipcMain.handle(CHANNEL, (event, op: unknown) => dispatch(event, op))),
            () => Effect.sync(() => ipcMain.removeHandler(CHANNEL)),
        )

        const wiredSessions = new WeakSet<Session>()
        const wiredWorkers = new WeakSet<ServiceWorkerMain>()

        const attachWorker = (serviceWorker: ServiceWorkerMain | undefined): void => {
            if (!serviceWorker) return
            if (!serviceWorker.scope?.startsWith("chrome-extension://")) return
            if (wiredWorkers.has(serviceWorker)) return
            wiredWorkers.add(serviceWorker)
            serviceWorker.ipc.removeHandler(CHANNEL)
            serviceWorker.ipc.handle(CHANNEL, (event, op: unknown) => dispatch(event, op))
        }

        // Same pattern as electron-chrome-extensions' crx-msg router: the running workers, then each new one.
        const bind = (ses: Session): Effect.Effect<void> =>
            Effect.sync(() => {
                if (wiredSessions.has(ses)) return
                wiredSessions.add(ses)
                for (const info of Object.values(ses.serviceWorkers.getAllRunning())) {
                    attachWorker(ses.serviceWorkers.getWorkerFromVersionID(info.versionId))
                }
                ses.serviceWorkers.on("running-status-changed", ({ runningStatus, versionId }) => {
                    if (runningStatus !== "starting") return
                    attachWorker(ses.serviceWorkers.getWorkerFromVersionID(versionId))
                })
            })

        return ExtensionStorage.of({ handle, purge, bind })
    })

export class ExtensionStorage extends Context.Service<ExtensionStorage, ExtensionStorageService>()(
    "arbor.ExtensionStorage",
) {
    static readonly layer = (path: string, debounce?: Duration.Input) =>
        Layer.effect(ExtensionStorage, make(path, debounce))
}
