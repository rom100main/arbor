/**
 * Chrome extension manifest fields Arbor reads.
 * Manifests arrive as `any` at the Electron boundary,
 * so every field falls back instead of rejecting the record.
 */

import { Schema } from "effect"

import { decodeOr, orDefault } from "../../shared/decode"

/** The slice of a manifest Arbor needs, already defaulted. */
export interface ParsedManifest {
    readonly name: string
    readonly permissions: string[]
    readonly host_permissions: string[]
    readonly optional_permissions: string[]
    readonly optional_host_permissions: string[]
    /** Chrome precedence: `options_page` wins over `options_ui.page`; "" when neither is set. */
    readonly optionsPage: string
}

const StringList = orDefault(Schema.mutable(Schema.Array(Schema.String)), (): string[] => [])

const ManifestSchema = Schema.Struct({
    name: orDefault(Schema.String, () => ""),
    permissions: StringList,
    host_permissions: StringList,
    optional_permissions: StringList,
    optional_host_permissions: StringList,
    options_page: orDefault(Schema.String, () => ""),
    options_ui: orDefault(Schema.Struct({ page: orDefault(Schema.String, () => "") }), () => ({
        page: "",
    })),
})

const decodeManifest = decodeOr(ManifestSchema)

const emptyManifest = (): ParsedManifest => ({
    name: "",
    permissions: [],
    host_permissions: [],
    optional_permissions: [],
    optional_host_permissions: [],
    optionsPage: "",
})

/**
 * Lenient read of the fields we need: a non-object yields the empty manifest,
 * and a mistyped field falls back without sinking the rest of the record.
 */
export const parseManifest = (raw: unknown): ParsedManifest => {
    const manifest = decodeManifest(raw)
    if (!manifest) return emptyManifest()
    return {
        name: manifest.name,
        permissions: manifest.permissions,
        host_permissions: manifest.host_permissions,
        optional_permissions: manifest.optional_permissions,
        optional_host_permissions: manifest.optional_host_permissions,
        optionsPage: manifest.options_page || manifest.options_ui.page,
    }
}
