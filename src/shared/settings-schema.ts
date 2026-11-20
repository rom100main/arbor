// Not in settings.ts because this file should be Effect free

import { Schema, SchemaGetter, Struct } from "effect"

import {
    HISTORY_RETENTIONS,
    isNewTabImageDataUrl,
    NEW_TAB_BACKGROUND_KINDS,
    normalizeNewTabColor,
    normalizeSearchTemplate,
    SIDEBAR_VISIBILITIES,
    THEMES,
    URL_BAR_VISIBILITIES,
} from "./settings"

export const Theme = Schema.Literals(THEMES)
export const SidebarVisibility = Schema.Literals(SIDEBAR_VISIBILITIES)
export const UrlBarVisibility = Schema.Literals(URL_BAR_VISIBILITIES)

export const SearchTemplate = Schema.String.pipe(
    Schema.check(
        Schema.makeFilter(
            (template: string) =>
                normalizeSearchTemplate(template) !== null ||
                "Search template must contain %s and produce an http(s) URL",
        ),
    ),
    Schema.decodeTo(Schema.String, {
        decode: SchemaGetter.transform(
            (template: string) => normalizeSearchTemplate(template) ?? template,
        ),
        encode: SchemaGetter.passthrough(),
    }),
)

export const HistoryRetention = Schema.Literals(HISTORY_RETENTIONS)

export const NewTabBackgroundKind = Schema.Literals(NEW_TAB_BACKGROUND_KINDS)

const NewTabColor = Schema.String.pipe(
    Schema.check(
        Schema.makeFilter(
            (color: string) =>
                normalizeNewTabColor(color) !== null || "Background color must be #rrggbb",
        ),
    ),
    Schema.decodeTo(Schema.String, {
        decode: SchemaGetter.transform((color: string) => normalizeNewTabColor(color) ?? color),
        encode: SchemaGetter.passthrough(),
    }),
)

const NewTabImage = Schema.NullOr(
    Schema.String.pipe(
        Schema.check(
            Schema.makeFilter(
                (value: string) =>
                    isNewTabImageDataUrl(value) || "Background image must be an image data URL",
            ),
        ),
    ),
)

export const Settings = Schema.Struct({
    searchTemplate: SearchTemplate,
    theme: Theme,
    pinnedExtensionIds: Schema.Array(Schema.NonEmptyString),
    sidebarVisibility: SidebarVisibility,
    urlBarVisibility: UrlBarVisibility,
    downloadAskWhereToSave: Schema.Boolean,
    historyEnabled: Schema.Boolean,
    historyRetention: HistoryRetention,
    adblockEnabled: Schema.Boolean,
    adblockDisabledSites: Schema.Array(Schema.NonEmptyString),
    newTabBackgroundKind: NewTabBackgroundKind,
    newTabBackgroundColor: NewTabColor,
    newTabBackgroundImage: NewTabImage,
    newTabShowSearchBar: Schema.Boolean,
})
export type Settings = typeof Settings.Type

/** What a renderer may send: every key optional, unknown keys dropped. */
export const SettingsPatch = Settings.mapFields(Struct.map(Schema.optionalKey))
export type SettingsPatch = typeof SettingsPatch.Type
