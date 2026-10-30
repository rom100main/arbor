import { Data, Schema } from "effect"

import { decodeOr, orDefault } from "../shared/decode"
import {
    DEFAULT_SEARCH_TEMPLATE,
    DEFAULT_SETTINGS,
    normalizeSearchTemplate,
    SIDEBAR_VISIBILITIES,
    THEMES,
    URL_BAR_VISIBILITIES,
    type Settings,
    type SidebarVisibility,
    type Theme,
    type UrlBarVisibility,
} from "../shared/settings"
import { createDebouncedSaver, loadOwnedFile, writeJsonSafely } from "./persistence"
import { AppRuntime } from "./runtime"

const ThemeSchema = Schema.Literals(THEMES)

const SettingsSchema = Schema.Struct({
    searchTemplate: orDefault(Schema.String, () => DEFAULT_SEARCH_TEMPLATE),
    theme: orDefault(ThemeSchema, (): Theme => "system"),
    // Unknown per element, so one bad id does not cost the whole pin list.
    pinnedExtensionIds: orDefault(Schema.Array(Schema.Unknown), () => [] as unknown[]),
    sidebarVisibility: orDefault(
        Schema.Literals(SIDEBAR_VISIBILITIES),
        (): SidebarVisibility => DEFAULT_SETTINGS.sidebarVisibility,
    ),
    urlBarVisibility: orDefault(
        Schema.Literals(URL_BAR_VISIBILITIES),
        (): UrlBarVisibility => DEFAULT_SETTINGS.urlBarVisibility,
    ),
})

const parseSettings = decodeOr(SettingsSchema)

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
    const searchTemplate = normalizeSearchTemplate(parsed.searchTemplate)
    return {
        searchTemplate: searchTemplate ?? DEFAULT_SEARCH_TEMPLATE,
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
     * Merge a patch, validate, persist, and notify subscribers.
     * Throws {@link SettingsError} when a value is rejected; nothing is written in that case.
     */
    readonly set: (patch: Partial<Settings>) => Settings
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

        set: (patch) => {
            if (patch.searchTemplate !== undefined) {
                const template = normalizeSearchTemplate(patch.searchTemplate)
                if (template === null) {
                    throw new SettingsError(
                        "Search template must contain %s and produce an http(s) URL",
                    )
                }
                patch = { ...patch, searchTemplate: template }
            }
            if (patch.theme !== undefined && !THEMES.includes(patch.theme)) {
                throw new SettingsError(`Unknown theme: ${patch.theme}`)
            }
            if (
                patch.sidebarVisibility !== undefined &&
                !SIDEBAR_VISIBILITIES.includes(patch.sidebarVisibility)
            ) {
                throw new SettingsError(`Unknown sidebar visibility: ${patch.sidebarVisibility}`)
            }
            if (
                patch.urlBarVisibility !== undefined &&
                !URL_BAR_VISIBILITIES.includes(patch.urlBarVisibility)
            ) {
                throw new SettingsError(`Unknown URL bar visibility: ${patch.urlBarVisibility}`)
            }
            if (patch.pinnedExtensionIds !== undefined) {
                patch = { ...patch, pinnedExtensionIds: cleanPinned(patch.pinnedExtensionIds) }
            }
            return commit({ ...current, ...patch })
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
