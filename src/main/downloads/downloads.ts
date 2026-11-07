/**
 * The Downloads module: every file a Container session downloads,
 * the location it is saved to, and the list the toolbar and the popup show.
 *
 * Electron's `DownloadItem` objects never leave this module, renderers receive plain records.
 */

import { existsSync } from "node:fs"
import path from "node:path"

import { Context, Effect, FiberSet, Layer, Stream, SubscriptionRef } from "effect"
import type { DownloadItem, Session } from "electron"

import type { DownloadId, DownloadInfo, DownloadsSnapshot } from "../../shared/protocol"
import { SettingsStore } from "../settings"
import { sanitizeFilename, uniqueSavePath } from "./save-path"

export interface DownloadsService {
    /** The list now. */
    readonly snapshot: Effect.Effect<DownloadsSnapshot>
    /** The list now, then on every change. */
    readonly changes: Stream.Stream<DownloadsSnapshot>
    /** Hook a session's `will-download`. Safe to call repeatedly for one session. */
    readonly attach: (ses: Session) => Effect.Effect<void>
    /** Cancel a live download. No-op when it is settled or unknown. */
    readonly cancel: (id: DownloadId) => Effect.Effect<void>
    /** Forget an entry. A live entry is cancelled first. The file stays on disk. */
    readonly remove: (id: DownloadId) => Effect.Effect<void>
    /** `shell.showItemInFolder(savePath)`. No-op when no path is known. */
    readonly reveal: (id: DownloadId) => Effect.Effect<void>
    /** `shell.openPath(savePath)`. No-op when no path is known. */
    readonly open: (id: DownloadId) => Effect.Effect<void>
    /** `shell.openPath(folder)`. */
    readonly openFolder: Effect.Effect<void>
}

export interface DownloadsOptions {
    readonly folder: string
    /** Injected so tests never touch Electron or the disk. */
    readonly opener: {
        readonly reveal: (file: string) => void
        readonly open: (target: string) => void
    }
    readonly exists?: (candidate: string) => boolean
}

type SettledState = "completed" | "cancelled" | "interrupted"

const make = (options: DownloadsOptions) =>
    Effect.gen(function* () {
        const settings = yield* SettingsStore
        const items = yield* SubscriptionRef.make<ReadonlyArray<DownloadInfo>>([])
        const run = yield* FiberSet.makeRuntime()
        const live = new Map<DownloadId, DownloadItem>()
        const idOf = new WeakMap<DownloadItem, DownloadId>()
        const attached = new WeakSet<Session>()
        const exists = options.exists ?? existsSync

        // Read synchronously:
        // the setting is also mirrored for the `will-download` callback, which cannot wait on an Effect.
        let askWhere = (yield* settings.get).downloadAskWhereToSave
        yield* settings.changes.pipe(
            Stream.runForEach((next) =>
                Effect.sync(() => {
                    askWhere = next.downloadAskWhereToSave
                }),
            ),
            Effect.forkScoped,
        )

        /**
         * The list as the synchronous Electron callbacks see it.
         * `items` is the published copy: a fiber applies each `set` in order, so subscribers never miss a state.
         */
        let records: ReadonlyArray<DownloadInfo> = []
        const publish = (next: ReadonlyArray<DownloadInfo>): void => {
            records = next
            run(SubscriptionRef.set(items, next))
        }

        const find = (id: DownloadId): DownloadInfo | undefined =>
            records.find((entry) => entry.id === id)

        const update = (item: DownloadItem): void => {
            const id = idOf.get(item)
            if (!id || !find(id)) return
            publish(
                records.map((entry) =>
                    entry.id === id
                        ? {
                              ...entry,
                              state:
                                  item.getState() === "progressing" ? "progressing" : entry.state,
                              savePath: item.getSavePath() || entry.savePath,
                              receivedBytes: item.getReceivedBytes(),
                              totalBytes: item.getTotalBytes(),
                          }
                        : entry,
                ),
            )
        }

        const settle = (item: DownloadItem, state: SettledState): void => {
            const id = idOf.get(item)
            if (!id) return
            live.delete(id)
            idOf.delete(item)
            // Removed while live: the entry is already gone and must not come back.
            if (!find(id)) return
            publish(
                records.map((entry) =>
                    entry.id === id
                        ? {
                              ...entry,
                              state,
                              savePath: item.getSavePath() || entry.savePath,
                              receivedBytes: item.getReceivedBytes(),
                              totalBytes: item.getTotalBytes(),
                              finishedAt: Date.now(),
                          }
                        : entry,
                ),
            )
        }

        const onWillDownload = (item: DownloadItem): void => {
            const id: DownloadId = `download-${crypto.randomUUID()}`
            const filename = sanitizeFilename(item.getFilename())
            const record: DownloadInfo = {
                id,
                filename,
                savePath: null,
                url: item.getURL(),
                state: "pending",
                receivedBytes: 0,
                totalBytes: item.getTotalBytes(),
                startedAt: Date.now(),
                finishedAt: null,
            }
            live.set(id, item)
            idOf.set(item, id)
            publish([...records, record])

            if (askWhere) {
                // No `setSavePath`: Electron shows its own save dialog, in the Downloads folder.
                item.setSaveDialogOptions({
                    title: "Save file",
                    defaultPath: path.join(options.folder, filename),
                    buttonLabel: "Save",
                })
            } else {
                // Electron creates the folder recursively when it is missing.
                item.setSavePath(uniqueSavePath(options.folder, filename, exists))
            }

            item.on("updated", () => update(item))
            item.once("done", (_event, state) => settle(item, state))
        }

        const attach = (ses: Session) =>
            Effect.sync(() => {
                if (attached.has(ses)) return
                attached.add(ses)
                ses.on("will-download", (_event, item) => {
                    // Never throw out of an Electron callback:
                    // that would leave the download half-configured.
                    // Log, and let Electron's default behavior stand.
                    try {
                        onWillDownload(item)
                    } catch (error) {
                        run(Effect.logError("Downloads: will-download failed", error))
                    }
                })
            })

        const cancel = (id: DownloadId) =>
            Effect.sync(() => {
                live.get(id)?.cancel()
            })

        const remove = (id: DownloadId) =>
            Effect.sync(() => {
                const item = live.get(id)
                item?.cancel()
                if (item) idOf.delete(item)
                live.delete(id)
                publish(records.filter((entry) => entry.id !== id))
            })

        const reveal = (id: DownloadId) =>
            Effect.sync(() => {
                const savePath = find(id)?.savePath
                if (savePath) options.opener.reveal(savePath)
            })

        const open = (id: DownloadId) =>
            Effect.sync(() => {
                const savePath = find(id)?.savePath
                if (savePath) options.opener.open(savePath)
            })

        return Downloads.of({
            snapshot: Effect.sync(() => ({ items: records, folder: options.folder })),
            changes: SubscriptionRef.changes(items).pipe(
                Stream.map((list) => ({ items: list, folder: options.folder })),
            ),
            attach,
            cancel,
            remove,
            reveal,
            open,
            openFolder: Effect.sync(() => options.opener.open(options.folder)),
        })
    })

export class Downloads extends Context.Service<Downloads, DownloadsService>()("arbor.Downloads") {
    static readonly layer = (
        options: DownloadsOptions,
    ): Layer.Layer<Downloads, never, SettingsStore> => Layer.effect(Downloads, make(options))
}
