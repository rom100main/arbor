import {
    ipcMain,
    type IpcMainInvokeEvent,
    type IpcMainServiceWorkerInvokeEvent,
    type ServiceWorkerMain,
    type Session,
} from "electron"

import {
    applyExtStorageOp,
    emptyExtStorageAreas,
    fromPersistedExtStorage,
    toPersistedExtStorage,
    type ExtStorageAreas,
    type ExtStorageOp,
} from "../shared/extension-storage"
import {
    createDebouncedSaver,
    readJsonFile,
    writeJsonFileAtomic,
    type DebouncedSaver,
} from "./persistence"

/** Frame invoke (extension pages) and service-worker invoke carry different event shapes. */
type StorageInvokeEvent = IpcMainInvokeEvent | IpcMainServiceWorkerInvokeEvent

export interface ExtensionStorageService {
    /** Apply one chrome.storage op for the extension that sent `event`. */
    readonly handle: (event: StorageInvokeEvent, op: ExtStorageOp) => unknown
    /** Hydrate from disk (call once before the first extension session loads). */
    readonly load: () => void
    /** Synchronously persist pending local-area writes (quit path). */
    readonly flush: () => void
}

export interface ExtensionStorageOptions {
    debounceMs?: number
    setTimer?: (fn: () => void, ms: number) => unknown
    clearTimer?: (handle: unknown) => void
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

let currentService: ExtensionStorageService | null = null
const wiredSessions = new WeakSet<Session>()
const wiredWorkers = new WeakSet<ServiceWorkerMain>()

/**
 * Single authoritative chrome.storage for every container session
 * (Firefox model: containers isolate web storage, extensions share one store).
 * `local`/`sync`/`managed` persist to disk; `session` is process-lifetime only.
 * Writes are applied synchronously in main so N extension service workers cannot interleave.
 */
export const createExtensionStorage = (
    filePath: string,
    options: ExtensionStorageOptions = {},
): ExtensionStorageService => {
    const extensions = new Map<string, ExtStorageAreas>()
    const saver: DebouncedSaver = createDebouncedSaver({
        write: () => {
            try {
                writeJsonFileAtomic(filePath, toPersistedExtStorage(Object.fromEntries(extensions)))
            } catch (error) {
                console.error("[arbor] failed to save extension storage:", error)
            }
        },
        delayMs: options.debounceMs,
        setTimer: options.setTimer,
        clearTimer: options.clearTimer,
    })

    const areasFor = (extensionId: string): ExtStorageAreas => {
        let areas = extensions.get(extensionId)
        if (!areas) {
            areas = emptyExtStorageAreas()
            extensions.set(extensionId, areas)
        }
        return areas
    }

    return {
        load: () => {
            const restored = fromPersistedExtStorage(readJsonFile(filePath))
            if (!restored) return
            for (const [id, areas] of Object.entries(restored)) extensions.set(id, areas)
        },
        handle: (event, op) => {
            const extensionId = extensionIdOf(event)
            if (!extensionId) throw new Error("arbor:ext-storage requires an extension sender")
            const { areas, result } = applyExtStorageOp(areasFor(extensionId), op)
            extensions.set(extensionId, areas)
            // `session` is memory-only; only durable areas touch disk.
            if (op.op !== "get" && op.op !== "getBytesInUse") saver.schedule()
            return result
        },
        flush: () => saver.flush(),
    }
}

const isExtStorageOp = (value: unknown): value is ExtStorageOp =>
    typeof value === "object" && value !== null && "op" in value

const dispatch = (event: StorageInvokeEvent, op: unknown): unknown => {
    const service = currentService
    if (!service) throw new Error("arbor:ext-storage is not ready")
    if (!isExtStorageOp(op)) throw new Error("Invalid arbor:ext-storage request")
    return service.handle(event, op)
}

/** Frame path: extension pages / popups use ipcRenderer → ipcMain. */
export const registerExtensionStorageIpc = (service: ExtensionStorageService): void => {
    currentService = service
    // start() can run again on macOS activate; rebind instead of stacking handlers.
    ipcMain.removeHandler("arbor:ext-storage")
    ipcMain.handle("arbor:ext-storage", (event, op: unknown) => dispatch(event, op))
}

const attachWorker = (serviceWorker: ServiceWorkerMain | undefined): void => {
    if (!serviceWorker) return
    if (!serviceWorker.scope?.startsWith("chrome-extension://")) return
    if (wiredWorkers.has(serviceWorker)) return
    wiredWorkers.add(serviceWorker)
    // SW ipcRenderer.invoke is served by ServiceWorkerMain.ipc, not ipcMain.
    serviceWorker.ipc.removeHandler("arbor:ext-storage")
    serviceWorker.ipc.handle("arbor:ext-storage", (event, op: unknown) => dispatch(event, op))
}

/**
 * Service-worker path: each extension SW gets its own IpcMainServiceWorker bus.
 * Wire every session (default + each container) after it exists,
 * same pattern as electron-chrome-extensions' crx-msg router.
 */
export const bindExtensionStorageToSession = (ses: Session): void => {
    if (wiredSessions.has(ses)) return
    wiredSessions.add(ses)

    for (const info of Object.values(ses.serviceWorkers.getAllRunning())) {
        attachWorker(ses.serviceWorkers.getWorkerFromVersionID(info.versionId))
    }

    ses.serviceWorkers.on("running-status-changed", (details) => {
        const { runningStatus, versionId } = details as {
            runningStatus: string
            versionId: number
        }
        if (runningStatus !== "starting") return
        attachWorker(ses.serviceWorkers.getWorkerFromVersionID(versionId))
    })
}
