import { Data, Result, Schema } from "effect"

import { decodeOr, orDefault } from "../shared/decode"
import { DEFAULT_SEARCH_TEMPLATE, DEFAULT_SETTINGS } from "../shared/settings"
import { Settings, SettingsPatch } from "../shared/settings-schema"
import { createDebouncedSaver, loadOwnedFile, writeJsonSafely } from "./persistence"
import { AppRuntime } from "./runtime"

const PersistedSettings = Schema.Struct({
    searchTemplate: orDefault(Settings.fields.searchTemplate, () => DEFAULT_SEARCH_TEMPLATE),
    theme: orDefault(Settings.fields.theme, () => DEFAULT_SETTINGS.theme),
    // Unknown per element, so one bad id does not cost the whole pin list.
    pinnedExtensionIds: orDefault(Schema.Array(Schema.Unknown), () => []),
    sidebarVisibility: orDefault(
        Settings.fields.sidebarVisibility,
        () => DEFAULT_SETTINGS.sidebarVisibility,
    ),
    urlBarVisibility: orDefault(
        Settings.fields.urlBarVisibility,
        () => DEFAULT_SETTINGS.urlBarVisibility,
    ),
})

const parseSettings = decodeOr(PersistedSettings)
const decodePatch = Schema.decodeUnknownResult(SettingsPatch, { onExcessProperty: "ignore" })

/** Pinned ids are deduplicated, kept in pin order, and non-strings dropped. */
const cleanPinned = (ids: readonly unknown[]): string[] =>
    [...new Set(ids.filter((id): id is string => typeof id === "string"))].filter(
        (id) => id.length > 0,
    )

/**
 * Parse a settings payload, repairing individual fields rather than rejecting the file:
 * a mistyped theme falls back to `system`, an unusable search template to the default.
 * `null` only when the payload is not an object at all.
 */
export const fromPersistedSettings = (data: unknown): Settings | null => {
    const parsed = parseSettings(data)
    if (!parsed) return null
    return {
        searchTemplate: parsed.searchTemplate,
        theme: parsed.theme,
        pinnedExtensionIds: cleanPinned(parsed.pinnedExtensionIds),
        sidebarVisibility: parsed.sidebarVisibility,
        urlBarVisibility: parsed.urlBarVisibility,
    }
}

export class SettingsError extends Data.TaggedError("SettingsError")<{ message: string }> {
    constructor(message: string) {
        super({ message })
    }
}

export interface SettingsStore {
    /** Current settings; a frozen copy, safe to hand to renderers. */
    readonly get: () => Settings
    /**
     * Decode a patch, merge, persist, and notify subscribers. Unknown keys are dropped.
     * Throws {@link SettingsError} when a value is rejected; nothing is written in that case.
     */
    readonly set: (patch: unknown) => Settings
    readonly pinExtension: (extensionId: string) => Settings
    readonly unpinExtension: (extensionId: string) => Settings
    readonly subscribe: (callback: (settings: Settings) => void) => () => void
    /** Synchronously write any pending settings (quit path). */
    readonly flush: () => void
}

export interface SettingsStoreOptions {
    debounceMs?: number
}

/**
 * Global user preferences, persisted apart from browser state so that clearing tabs and
 * containers never resets them.
 */
export const createSettingsStore = (
    filePath: string,
    options: SettingsStoreOptions = {},
): SettingsStore => {
    let current: Settings = AppRuntime.runSync(
        loadOwnedFile(filePath, fromPersistedSettings, "Settings"),
    ) ?? {
        ...DEFAULT_SETTINGS,
        pinnedExtensionIds: [],
    }
    const subscribers = new Set<(settings: Settings) => void>()

    const saver = createDebouncedSaver({
        write: () => writeJsonSafely(filePath, current, "settings"),
        delayMs: options.debounceMs,
    })

    const commit = (next: Settings): Settings => {
        current = next
        saver.schedule()
        for (const subscriber of subscribers) subscriber(next)
        return next
    }

    return {
        get: () => current,

        set: (input) => {
            const decoded = decodePatch(input)
            if (Result.isFailure(decoded)) throw new SettingsError(decoded.failure.message)
            const patch = decoded.success
            return commit({
                ...current,
                ...patch,
                ...(patch.pinnedExtensionIds && {
                    pinnedExtensionIds: cleanPinned(patch.pinnedExtensionIds),
                }),
            })
        },

        pinExtension: (extensionId) => {
            if (current.pinnedExtensionIds.includes(extensionId)) return current
            return commit({
                ...current,
                pinnedExtensionIds: [...current.pinnedExtensionIds, extensionId],
            })
        },

        unpinExtension: (extensionId) => {
            if (!current.pinnedExtensionIds.includes(extensionId)) return current
            return commit({
                ...current,
                pinnedExtensionIds: current.pinnedExtensionIds.filter((id) => id !== extensionId),
            })
        },

        subscribe: (callback) => {
            subscribers.add(callback)
            return () => {
                subscribers.delete(callback)
            }
        },

        flush: () => saver.flush(),
    }
}
