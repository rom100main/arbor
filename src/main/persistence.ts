import { readFileSync, renameSync, writeFileSync } from "node:fs"

import { Effect } from "effect"

import { AppRuntime } from "./runtime"
import { fromPersisted, toPersisted } from "./state/persist"
import type { DomainState } from "./state/state"

/** Lenient read for files Arbor does not own (extension manifests): any failure is `null`. */
export const readJsonFile = (filePath: string): unknown => {
    try {
        return JSON.parse(readFileSync(filePath, "utf8")) as unknown
    } catch {
        return null
    }
}

const isMissingFile = (error: unknown): boolean =>
    typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"

/**
 * Load a file Arbor owns: the decoded value, or `null` to start from defaults.
 * A missing file is silent, an unusable one is logged.
 */
export const loadOwnedFile = <A>(
    filePath: string,
    decode: (data: unknown) => A | null,
    label: string,
): Effect.Effect<A | null> =>
    Effect.try({
        try: () => decode(JSON.parse(readFileSync(filePath, "utf8")) as unknown),
        catch: (error) => error,
    }).pipe(
        Effect.matchEffect({
            onSuccess: (value) =>
                value === null
                    ? Effect.as(
                          Effect.logWarning(`${label} could not be read (unsupported content)`),
                          null,
                      )
                    : Effect.succeed(value),
            onFailure: (error) =>
                isMissingFile(error)
                    ? Effect.succeed(null)
                    : Effect.as(Effect.logWarning(`${label} could not be read`, error), null),
        }),
    )

/** Best-effort atomic write (temp file + rename): a failed save never breaks the caller. */
export const writeJsonSafely = (filePath: string, value: unknown, label: string): void => {
    try {
        const tmp = `${filePath}.tmp`
        writeFileSync(tmp, JSON.stringify(value), "utf8")
        renameSync(tmp, filePath)
    } catch (error) {
        AppRuntime.runSync(Effect.logError(`Failed to save ${label}`, error))
    }
}

export interface DebouncedSaver {
    /** Mark dirty and (re)arm the timer. */
    readonly schedule: () => void
    /** Write now if dirty; cancels any pending timer. */
    readonly flush: () => void
    /** Drop pending work without writing. */
    readonly cancel: () => void
}

export interface DebouncedSaverOptions {
    write: () => void
    delayMs?: number
}

export const createDebouncedSaver = (options: DebouncedSaverOptions): DebouncedSaver => {
    const delayMs = options.delayMs ?? 500

    let handle: ReturnType<typeof setTimeout> | null = null
    let dirty = false

    const clear = (): void => {
        if (handle === null) return
        clearTimeout(handle)
        handle = null
    }

    const run = (): void => {
        handle = null
        if (!dirty) return
        dirty = false
        options.write()
    }

    return {
        schedule: () => {
            dirty = true
            clear()
            handle = setTimeout(run, delayMs)
        },
        flush: () => {
            clear()
            if (!dirty) return
            dirty = false
            options.write()
        },
        cancel: () => {
            clear()
            dirty = false
        },
    }
}

export interface StatePersistence {
    /** Restored state, or `null` when the file is missing or unusable. */
    readonly load: () => DomainState | null
    /** Remember `state` and schedule a debounced disk write. */
    readonly schedule: (state: DomainState) => void
    /** Synchronously write any pending state (quit path). */
    readonly flush: () => void
}

export interface StatePersistenceOptions {
    debounceMs?: number
}

export const createStatePersistence = (
    filePath: string,
    options: StatePersistenceOptions = {},
): StatePersistence => {
    let latest: DomainState | null = null
    const saver = createDebouncedSaver({
        write: () => {
            if (latest) writeJsonSafely(filePath, toPersisted(latest), "browser state")
        },
        delayMs: options.debounceMs,
    })

    return {
        load: () => AppRuntime.runSync(loadOwnedFile(filePath, fromPersisted, "Browser state")),
        schedule: (state) => {
            latest = state
            saver.schedule()
        },
        flush: () => saver.flush(),
    }
}
