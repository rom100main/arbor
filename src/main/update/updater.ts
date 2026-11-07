/**
 * The Updater module: where the app update stands, and the one action the user can take on it.
 * Imports no Electron: the live service is `electron-updater.ts`, tests use `Updater.none`.
 */

import { Context, Effect, Layer } from "effect"

import type { UpdateStatus } from "../../shared/protocol"

const RELEASES = "https://github.com/rom100main/arbor/releases"

export const IDLE: UpdateStatus = { kind: "idle" }

export interface UpdaterService {
    /** `ready`: quit, install and relaunch. `manual`: open the release page. Otherwise nothing. */
    readonly status: Effect.Effect<UpdateStatus>
    readonly install: Effect.Effect<void>
}

export class Updater extends Context.Service<Updater, UpdaterService>()("arbor.Updater") {
    /** Dev builds and tests: never an update. */
    static readonly none = Layer.succeed(Updater, {
        status: Effect.succeed(IDLE),
        install: Effect.void,
    })
}

/** What electron-updater reports, reduced to what the status needs. */
export type UpdaterEvent =
    | { readonly kind: "available"; readonly version: string }
    | { readonly kind: "progress"; readonly percent: number }
    | { readonly kind: "downloaded"; readonly version: string }
    | { readonly kind: "failed" }

/**
 * The status after `event`. Returns `current` itself when nothing changes, so the caller can skip the push.
 * `canInstall` is false where the build cannot replace itself: the update then becomes a link.
 */
export const nextStatus = (
    current: UpdateStatus,
    event: UpdaterEvent,
    canInstall: boolean,
): UpdateStatus => {
    switch (event.kind) {
        case "available":
            return canInstall
                ? { kind: "downloading", percent: 0 }
                : { kind: "manual", version: event.version, url: releaseUrl(event.version) }
        case "progress": {
            const percent = Math.floor(event.percent)
            return current.kind === "downloading" && current.percent !== percent
                ? { kind: "downloading", percent }
                : current
        }
        case "downloaded":
            return { kind: "ready", version: event.version }
    }
    // Failed: a failed check changes nothing; a failed download starts over at the next check.
    return current.kind === "downloading" ? IDLE : current
}

/** Once an update is found, checking again would only download it again. So check only on "idle" */
export const shouldCheck = (status: UpdateStatus): boolean => status.kind === "idle"

export const releaseUrl = (version: string): string => `${RELEASES}/tag/v${version}`
