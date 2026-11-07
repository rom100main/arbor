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
