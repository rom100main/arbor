// Not in settings.ts because this file should be Effect free

import { Schema, SchemaGetter, Struct } from "effect"

import {
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

export const Settings = Schema.Struct({
    searchTemplate: SearchTemplate,
    theme: Theme,
    pinnedExtensionIds: Schema.Array(Schema.NonEmptyString),
    sidebarVisibility: SidebarVisibility,
    urlBarVisibility: UrlBarVisibility,
})
export type Settings = typeof Settings.Type

/** What a renderer may send: every key optional, unknown keys dropped. */
export const SettingsPatch = Settings.mapFields(Struct.map(Schema.optionalKey))
export type SettingsPatch = typeof SettingsPatch.Type
