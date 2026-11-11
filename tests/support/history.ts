import { Effect, Layer, Queue, Stream } from "effect"

import { History, type HistoryService } from "../../src/main/history/service"
import type { HistoryEntry, HistoryQuery, HistorySnapshot } from "../../src/shared/protocol"

export type HistoryCall =
    | { readonly op: "visit"; readonly url: string }
    | { readonly op: "inPage"; readonly url: string }
    | { readonly op: "remove"; readonly ids: ReadonlyArray<string> }
    | { readonly op: "clearBefore"; readonly cutoff: number }
    | { readonly op: "clearAll" }

export interface FakeHistory {
    readonly service: HistoryService
    readonly layer: Layer.Layer<History>
    readonly calls: ReadonlyArray<HistoryCall>
    readonly emit: (entries: ReadonlyArray<HistoryEntry>) => void
}

/** A History service with no persistence: scriptable list, recorded actions. */
export const fakeHistory = (initial: ReadonlyArray<HistoryEntry> = []): FakeHistory => {
    const calls: HistoryCall[] = []
    const listeners = new Set<(snapshot: HistorySnapshot) => void>()
    let entries = initial
    const snapshot = (): HistorySnapshot => ({
        entries: [...entries].sort((a, b) => b.lastVisitedAt - a.lastVisitedAt),
        totalCount: entries.length,
    })

    const service: HistoryService = {
        snapshot: Effect.sync(snapshot),
        changes: Stream.suspend(() =>
            Stream.concat(
                Stream.make(snapshot()),
                Stream.callback<HistorySnapshot>((queue) =>
                    Effect.acquireRelease(
                        Effect.sync(() => {
                            const listener = (value: HistorySnapshot): void => {
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
        visit: ({ url }) => Effect.sync(() => void calls.push({ op: "visit", url })),
        inPage: (url) => Effect.sync(() => void calls.push({ op: "inPage", url })),
        meta: () => Effect.void,
        list: (query: HistoryQuery) =>
            Effect.sync(() => {
                const filtered = entries.filter(
                    (entry) =>
                        (query.containerId === undefined ||
                            entry.containerId === query.containerId) &&
                        (query.query === undefined ||
                            entry.url.toLowerCase().includes(query.query.toLowerCase()) ||
                            entry.title.toLowerCase().includes(query.query.toLowerCase())),
                )
                return { entries: filtered, totalCount: entries.length }
            }),
        remove: (ids) => Effect.sync(() => void calls.push({ op: "remove", ids: [...ids] })),
        clearBefore: (cutoff) => Effect.sync(() => void calls.push({ op: "clearBefore", cutoff })),
        prune: () => Effect.void,
    }

    return {
        service,
        layer: Layer.succeed(History, service),
        calls,
        emit: (next) => {
            entries = next
            for (const listener of listeners) listener(snapshot())
        },
    }
}
