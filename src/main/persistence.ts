import { readFileSync, renameSync, writeFileSync } from "node:fs"

import { fromPersisted, toPersisted } from "./state/persist"
import type { DomainState } from "./state/state"

export const readJsonFile = (filePath: string): unknown => {
    try {
        return JSON.parse(readFileSync(filePath, "utf8")) as unknown
    } catch {
        return null
    }
}

/** Write via a temp file + rename so a crash mid-save cannot truncate the previous copy. */
export const writeJsonFileAtomic = (filePath: string, value: unknown): void => {
    const tmp = `${filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(value), "utf8")
    renameSync(tmp, filePath)
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
    /** Restored state, or `null` when the file is missing/unusable. */
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
            if (!latest) return
            try {
                writeJsonFileAtomic(filePath, toPersisted(latest))
            } catch (error) {
                console.error("[arbor] failed to save browser state:", error)
            }
        },
        delayMs: options.debounceMs,
    })

    return {
        load: () => fromPersisted(readJsonFile(filePath)),
        schedule: (state) => {
            latest = state
            saver.schedule()
        },
        flush: () => saver.flush(),
    }
}
