import { Context, Effect, Layer, Option, Result, Schema, type Duration, type Stream } from "effect"

import { SettingsRejected } from "../shared/errors"
import { DEFAULT_SEARCH_TEMPLATE, DEFAULT_SETTINGS } from "../shared/settings"
import { Settings, SettingsPatch } from "../shared/settings-schema"
import { decodeOr, orDefault } from "./persistence/decode"
import { readJson } from "./persistence/json-file"
import * as PersistedRef from "./persistence/persisted-ref"

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
    downloadAskWhereToSave: orDefault(
        Settings.fields.downloadAskWhereToSave,
        () => DEFAULT_SETTINGS.downloadAskWhereToSave,
    ),
    historyEnabled: orDefault(
        Settings.fields.historyEnabled,
        () => DEFAULT_SETTINGS.historyEnabled,
    ),
    historyRetention: orDefault(
        Settings.fields.historyRetention,
        () => DEFAULT_SETTINGS.historyRetention,
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
        downloadAskWhereToSave: parsed.downloadAskWhereToSave,
        historyEnabled: parsed.historyEnabled,
        historyRetention: parsed.historyRetention,
    }
}

export interface SettingsService {
    readonly get: Effect.Effect<Settings>
    /** The current settings on subscribe, then every change. */
    readonly changes: Stream.Stream<Settings>
    /** Decode a patch, merge and persist it. Unknown keys are dropped. */
    readonly set: (patch: unknown) => Effect.Effect<Settings, SettingsRejected>
    /** No-op (and no publish) when the extension is already pinned. */
    readonly pin: (extensionId: string) => Effect.Effect<void>
    /** No-op (and no publish) when the extension is not pinned. */
    readonly unpin: (extensionId: string) => Effect.Effect<void>
}

const defaults = (): Settings => ({ ...DEFAULT_SETTINGS, pinnedExtensionIds: [] })

/**
 * Global user preferences, persisted apart from browser state so that clearing tabs and
 * containers never resets them.
 */
const make = (path: string, debounce?: Duration.Input) =>
    Effect.gen(function* () {
        const ref = yield* PersistedRef.make({
            path,
            read: readJson(path, fromPersistedSettings),
            encode: (settings: Settings) => settings,
            empty: defaults,
            debounce,
        })

        const set = (input: unknown): Effect.Effect<Settings, SettingsRejected> => {
            const decoded = decodePatch(input)
            if (Result.isFailure(decoded)) {
                return Effect.fail(new SettingsRejected({ message: decoded.failure.message }))
            }
            const patch = decoded.success
            return ref.modifySome((current) => {
                const next: Settings = {
                    ...current,
                    ...patch,
                    ...(patch.pinnedExtensionIds && {
                        pinnedExtensionIds: cleanPinned(patch.pinnedExtensionIds),
                    }),
                }
                return [next, Option.some(next)] as const
            })
        }

        const updatePins = (f: (ids: readonly string[]) => readonly string[] | null) =>
            ref.modifySome((current) => {
                const ids = f(current.pinnedExtensionIds)
                return [
                    undefined,
                    ids === null
                        ? Option.none()
                        : Option.some({ ...current, pinnedExtensionIds: ids }),
                ] as const
            })

        return SettingsStore.of({
            get: ref.get,
            changes: ref.changes,
            set,
            pin: (extensionId) =>
                updatePins((ids) => (ids.includes(extensionId) ? null : [...ids, extensionId])),
            unpin: (extensionId) =>
                updatePins((ids) =>
                    ids.includes(extensionId) ? ids.filter((id) => id !== extensionId) : null,
                ),
        })
    })

export class SettingsStore extends Context.Service<SettingsStore, SettingsService>()(
    "arbor.Settings",
) {
    static readonly layer = (path: string, debounce?: Duration.Input) =>
        Layer.effect(SettingsStore, make(path, debounce))
}
