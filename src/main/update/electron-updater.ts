/**
 * The live Updater: electron-updater against the GitHub Releases of the repository in package.json.
 * Checks shortly after start, then every few hours, and downloads in the background.
 */

import { Effect, FiberSet, Layer, Schedule } from "effect"
import { app, shell } from "electron"
import electronUpdater from "electron-updater"

import type { UpdateStatus } from "../../shared/protocol"
import { IpcPush, makePusher } from "../ipc/router"
import { IDLE, Updater, nextStatus, shouldCheck, type UpdaterEvent } from "./updater"

const { autoUpdater } = electronUpdater

/** Squirrel.Mac only installs into a signed app. Set to true once CI signs the macOS build. */
const MAC_SIGNED = false

const canInstall = process.platform !== "darwin" || MAC_SIGNED

const live = Layer.effect(
    Updater,
    Effect.gen(function* () {
        const pusher = yield* makePusher(yield* IpcPush)
        const run = yield* FiberSet.makeRuntime()
        let status: UpdateStatus = IDLE

        const apply = (event: UpdaterEvent): void => {
            const next = nextStatus(status, event, canInstall)
            if (next === status) return
            status = next
            pusher.push("updateStatus", next)
        }

        yield* Effect.acquireRelease(
            Effect.sync(() => {
                autoUpdater.autoDownload = canInstall
                // Quitting without the click installs nothing, the next launch offers the update again.
                autoUpdater.autoInstallOnAppQuit = false
                autoUpdater.on("update-available", ({ version }) =>
                    apply({ kind: "available", version }),
                )
                autoUpdater.on("download-progress", ({ percent }) =>
                    apply({ kind: "progress", percent }),
                )
                autoUpdater.on("update-downloaded", ({ version }) =>
                    apply({ kind: "downloaded", version }),
                )
                autoUpdater.on("error", (error) => {
                    apply({ kind: "failed" })
                    run(Effect.logWarning("Update failed", error))
                })
            }),
            () => Effect.sync(() => autoUpdater.removeAllListeners()),
        )

        // Failures arrive as the `error` event above.
        const check = Effect.suspend(() =>
            shouldCheck(status)
                ? Effect.ignore(Effect.tryPromise(() => autoUpdater.checkForUpdates()))
                : Effect.void,
        )
        yield* check.pipe(
            Effect.repeat(Schedule.spaced("4 hours")),
            Effect.delay("10 seconds"),
            Effect.forkScoped,
        )

        return {
            status: Effect.sync(() => status),
            install: Effect.suspend(() => {
                const current = status
                switch (current.kind) {
                    case "ready":
                        return Effect.sync(() => {
                            // An AppImage starts the new version before this one has quit:
                            // it must not find the lock held and quit at once.
                            app.releaseSingleInstanceLock()
                            // Quitting still closes the app scope first, so pending state is written.
                            autoUpdater.quitAndInstall(true, true)
                        })
                    case "manual":
                        return Effect.promise(() => shell.openExternal(current.url))
                    default:
                        return Effect.void
                }
            }),
        }
    }),
)

/** Dev builds have no release to update from. */
export const ElectronUpdater = Layer.unwrap(
    Effect.sync(() => (app.isPackaged ? live : Updater.none)),
)
