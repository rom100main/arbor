import { Effect, Layer, Queue, Stream } from "effect"

import { Downloads, type DownloadsService } from "../../src/main/downloads/downloads"
import type { DownloadId, DownloadInfo, DownloadsSnapshot } from "../../src/shared/protocol"

export type DownloadsCall =
    | { readonly op: "cancel"; readonly id: DownloadId }
    | { readonly op: "remove"; readonly id: DownloadId }
    | { readonly op: "clearSettled" }
    | { readonly op: "reveal"; readonly id: DownloadId }
    | { readonly op: "open"; readonly id: DownloadId }
    | { readonly op: "openFolder" }

export interface FakeDownloads {
    readonly service: DownloadsService
    readonly layer: Layer.Layer<Downloads>
    /** What the popup asked for, in order. */
    readonly calls: ReadonlyArray<DownloadsCall>
    /** Replace the list and push it to every subscriber. */
    readonly emit: (items: ReadonlyArray<DownloadInfo>) => void
}

/** A Downloads service with no Electron: scriptable list, recorded actions. */
export const fakeDownloads = (initial: ReadonlyArray<DownloadInfo> = []): FakeDownloads => {
    const calls: DownloadsCall[] = []
    const listeners = new Set<(snapshot: DownloadsSnapshot) => void>()
    let items = initial
    const folder = "/Downloads"
    const snapshot = (): DownloadsSnapshot => ({ items, folder })

    const service: DownloadsService = {
        snapshot: Effect.sync(snapshot),
        changes: Stream.suspend(() =>
            Stream.concat(
                Stream.make(snapshot()),
                Stream.callback<DownloadsSnapshot>((queue) =>
                    Effect.acquireRelease(
                        Effect.sync(() => {
                            const listener = (value: DownloadsSnapshot): void => {
                                Queue.offerUnsafe(queue, value)
                            }
                            listeners.add(listener)
                            return listener
                        }),
                        (listener) => Effect.sync(() => void listeners.delete(listener)),
                    ),
                ),
            ),
        ),
        attach: () => Effect.void,
        cancel: (id) => Effect.sync(() => void calls.push({ op: "cancel", id })),
        remove: (id) => Effect.sync(() => void calls.push({ op: "remove", id })),
        clearSettled: Effect.sync(() => void calls.push({ op: "clearSettled" })),
        reveal: (id) => Effect.sync(() => void calls.push({ op: "reveal", id })),
        open: (id) => Effect.sync(() => void calls.push({ op: "open", id })),
        openFolder: Effect.sync(() => void calls.push({ op: "openFolder" })),
    }

    return {
        service,
        layer: Layer.succeed(Downloads, service),
        calls,
        emit: (next) => {
            items = next
            for (const listener of listeners) listener(snapshot())
        },
    }
}

type Listener = (...args: unknown[]) => void

/** The slice of Electron's EventEmitter the Downloads service uses. */
export class FakeEmitter {
    private readonly listeners = new Map<string, Listener[]>()

    on(name: string, listener: Listener): void {
        const list = this.listeners.get(name) ?? []
        list.push(listener)
        this.listeners.set(name, list)
    }

    off(name: string, listener: Listener): void {
        this.listeners.set(
            name,
            (this.listeners.get(name) ?? []).filter((candidate) => candidate !== listener),
        )
    }

    emit(name: string, ...args: unknown[]): void {
        for (const listener of [...(this.listeners.get(name) ?? [])]) listener(...args)
    }

    listenerCount(name: string): number {
        return (this.listeners.get(name) ?? []).length
    }
}

export class FakeSession extends FakeEmitter {}

export interface FakeSaveDialogOptions {
    readonly title?: string
    readonly defaultPath?: string
    readonly buttonLabel?: string
}

/** The slice of Electron's DownloadItem the service reads. */
export class FakeItem extends FakeEmitter {
    savePath = ""
    saveDialogOptions: FakeSaveDialogOptions | null = null
    received = 0
    state = "progressing"
    cancelCount = 0
    readonly filename: string
    readonly url: string
    readonly totalBytes: number

    constructor(filename: string, url: string, totalBytes: number) {
        super()
        this.filename = filename
        this.url = url
        this.totalBytes = totalBytes
    }

    getFilename = (): string => this.filename
    getURL = (): string => this.url
    getTotalBytes = (): number => this.totalBytes
    getReceivedBytes = (): number => this.received
    getState = (): string => this.state
    getSavePath = (): string => this.savePath
    setSaveDialogOptions = (options: FakeSaveDialogOptions): void => {
        this.saveDialogOptions = options
    }
    setSavePath = (path: string): void => {
        this.savePath = path
    }
    cancel = (): void => {
        this.cancelCount += 1
        this.state = "cancelled"
    }

    once(name: string, listener: Listener): void {
        const wrapper: Listener = (...args) => {
            this.off(name, wrapper)
            listener(...args)
        }
        this.on(name, wrapper)
    }
}
