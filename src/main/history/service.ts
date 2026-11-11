/** The History module: every visited page, deduplicated by URL, and the list the history page and the omnibox show. */

import {
    Clock,
    Context,
    Effect,
    FiberSet,
    Layer,
    Option,
    Schedule,
    Stream,
    SubscriptionRef,
} from "effect"

import { matchesHistoryQuery } from "../../shared/history"
import type {
    ContainerId,
    HistoryEntry,
    HistoryEntryId,
    HistoryQuery,
    HistorySnapshot,
} from "../../shared/protocol"
import type { HistoryRetention } from "../../shared/settings"
import { readJson } from "../persistence/json-file"
import * as PersistedRef from "../persistence/persisted-ref"
import { SettingsStore } from "../settings"
import { decodeHistory, MAX_HISTORY_ENTRIES } from "./history"
import { isRecordableUrl, retentionCutoff, stripFragment } from "./record"

export interface HistoryService {
    /** The list now, newest first. */
    readonly snapshot: Effect.Effect<HistorySnapshot>
    /** The list now, then on every change. */
    readonly changes: Stream.Stream<HistorySnapshot>
    /** Record a navigation: create the entry or bump its visit count. */
    readonly visit: (input: { url: string; containerId: ContainerId }) => Effect.Effect<void>
    /** A hash-only navigation: bump recency without a new visit count. */
    readonly inPage: (url: string) => Effect.Effect<void>
    /** Merge a late title / favicon into the entry for `url`. */
    readonly meta: (
        url: string,
        patch: { title?: string; favicon?: string | null },
    ) => Effect.Effect<void>
    /** Filtered list for `historyList`. */
    readonly list: (query: HistoryQuery) => Effect.Effect<HistorySnapshot>
    /** Forget the given entries. Unknown ids are no-ops. */
    readonly remove: (ids: ReadonlyArray<HistoryEntryId>) => Effect.Effect<void>
    /** Forget entries last visited before `cutoff` (epoch ms). */
    readonly clearBefore: (cutoff: number) => Effect.Effect<void>
    /** Forget entries last visited after `cutoff` (epoch ms). */
    readonly clearAfter: (cutoff: number) => Effect.Effect<void>
    /** Apply the retention setting against `now`. */
    readonly prune: (now: number) => Effect.Effect<void>
}

export interface HistoryOptions {
    /** Where entries are remembered across restarts. */
    readonly historyPath: string
    readonly maxEntries?: number
}

const toSnapshot = (entries: ReadonlyArray<HistoryEntry>): HistorySnapshot => ({
    entries: [...entries].sort((a, b) => b.lastVisitedAt - a.lastVisitedAt),
    totalCount: entries.length,
})

const capEntries = (
    entries: ReadonlyArray<HistoryEntry>,
    max: number,
): ReadonlyArray<HistoryEntry> =>
    entries.length <= max
        ? entries
        : [...entries]
              .sort((a, b) => b.visitCount - a.visitCount || b.lastVisitedAt - a.lastVisitedAt)
              .slice(0, max)
              .sort((a, b) => b.lastVisitedAt - a.lastVisitedAt)

const make = (options: HistoryOptions) =>
    Effect.gen(function* () {
        const settings = yield* SettingsStore
        const max = options.maxEntries ?? MAX_HISTORY_ENTRIES
        const persisted = yield* PersistedRef.make({
            path: options.historyPath,
            read: readJson(options.historyPath, decodeHistory),
            encode: (entries: ReadonlyArray<HistoryEntry>) => entries,
            empty: () => [],
        })
        const stored = capEntries(yield* persisted.get, max)
        const items = yield* SubscriptionRef.make<ReadonlyArray<HistoryEntry>>(stored)
        const run = yield* FiberSet.makeRuntime()

        // Mirrored synchronously so the (possibly hot) visit hook never waits on an Effect.
        let enabled = (yield* settings.get).historyEnabled
        let retention: HistoryRetention = (yield* settings.get).historyRetention
        yield* settings.changes.pipe(
            Stream.runForEach((next) =>
                Effect.sync(() => {
                    enabled = next.historyEnabled
                    retention = next.historyRetention
                }),
            ),
            Effect.forkScoped,
        )

        /** Published copy, mirroring what `items` holds for renderers. */
        let records: ReadonlyArray<HistoryEntry> = stored

        const publish = (next: ReadonlyArray<HistoryEntry>): void => {
            records = next
            run(SubscriptionRef.set(items, next))
        }

        const persist = (next: ReadonlyArray<HistoryEntry>) =>
            persisted.modifySome(() => [undefined, Option.some(next)] as const)

        const update = (next: ReadonlyArray<HistoryEntry>): Effect.Effect<void> => {
            const capped = capEntries(next, max)
            publish(capped)
            return persist(capped)
        }

        const visit = ({ url, containerId }: { url: string; containerId: ContainerId }) =>
            Effect.gen(function* () {
                if (!enabled) return
                if (!isRecordableUrl(url)) return
                const normalized = stripFragment(url)
                const now = yield* Clock.currentTimeMillis
                const existing = records.find((entry) => entry.url === normalized)
                if (existing) {
                    yield* update(
                        records.map((entry) =>
                            entry.id === existing.id
                                ? {
                                      ...entry,
                                      lastVisitedAt: now,
                                      visitCount: entry.visitCount + 1,
                                  }
                                : entry,
                        ),
                    )
                    return
                }
                const entry: HistoryEntry = {
                    id: `history-${crypto.randomUUID()}`,
                    url: normalized,
                    title: "",
                    favicon: null,
                    containerId,
                    firstVisitedAt: now,
                    lastVisitedAt: now,
                    visitCount: 1,
                }
                yield* update([entry, ...records])
            })

        const inPage = (url: string) =>
            Effect.gen(function* () {
                if (!enabled) return
                if (!isRecordableUrl(url)) return
                const normalized = stripFragment(url)
                const now = yield* Clock.currentTimeMillis
                const existing = records.find((entry) => entry.url === normalized)
                if (!existing) return
                yield* update(
                    records.map((entry) =>
                        entry.id === existing.id ? { ...entry, lastVisitedAt: now } : entry,
                    ),
                )
            })

        const meta = (
            url: string,
            patch: { title?: string; favicon?: string | null },
        ): Effect.Effect<void> =>
            Effect.gen(function* () {
                if (!enabled) return
                const normalized = stripFragment(url)
                const existing = records.find((entry) => entry.url === normalized)
                if (!existing) return
                const title =
                    patch.title !== undefined && patch.title.length > 0
                        ? patch.title
                        : existing.title
                const favicon = patch.favicon !== undefined ? patch.favicon : existing.favicon
                if (title === existing.title && favicon === existing.favicon) return
                yield* update(
                    records.map((entry) =>
                        entry.id === existing.id ? { ...entry, title, favicon } : entry,
                    ),
                )
            })

        const list = (query: HistoryQuery): Effect.Effect<HistorySnapshot> =>
            Effect.sync(() => {
                const filtered = records.filter(
                    (entry) =>
                        (query.containerId === undefined ||
                            entry.containerId === query.containerId) &&
                        (query.query === undefined || matchesHistoryQuery(entry, query.query)),
                )
                return { entries: toSnapshot(filtered).entries, totalCount: records.length }
            })

        const remove = (ids: ReadonlyArray<HistoryEntryId>): Effect.Effect<void> =>
            Effect.gen(function* () {
                if (ids.length === 0) return
                const drop = new Set(ids)
                const next = records.filter((entry) => !drop.has(entry.id))
                if (next.length === records.length) return
                yield* update(next)
            })

        const clearBefore = (cutoff: number): Effect.Effect<void> =>
            Effect.gen(function* () {
                const next = records.filter((entry) => entry.lastVisitedAt >= cutoff)
                if (next.length === records.length) return
                yield* update(next)
            })

        const clearAfter = (cutoff: number): Effect.Effect<void> =>
            Effect.gen(function* () {
                const next = records.filter((entry) => entry.lastVisitedAt < cutoff)
                if (next.length === records.length) return
                yield* update(next)
            })

        const prune = (now: number): Effect.Effect<void> =>
            Effect.gen(function* () {
                const cutoff = retentionCutoff(retention, now)
                if (cutoff === null) return
                const next = records.filter((entry) => entry.lastVisitedAt >= cutoff)
                if (next.length === records.length) return
                yield* update(next)
            })

        // Auto-prune on start and every 24 h. A retention change applies at
        // the next tick (at most a day late) — acceptable for auto-delete.
        yield* Effect.gen(function* () {
            yield* prune(yield* Clock.currentTimeMillis)
        }).pipe(Effect.repeat(Schedule.fixed("24 hours")), Effect.forkScoped)

        return History.of({
            snapshot: Effect.sync(() => toSnapshot(records)),
            changes: SubscriptionRef.changes(items).pipe(Stream.map(toSnapshot)),
            visit,
            inPage,
            meta,
            list,
            remove,
            clearBefore,
            clearAfter,
            prune,
        })
    })

export class History extends Context.Service<History, HistoryService>()("arbor.History") {
    static readonly layer = (options: HistoryOptions): Layer.Layer<History, never, SettingsStore> =>
        Layer.effect(History, make(options))
}
