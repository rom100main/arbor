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
    /** `action.default_title`, falling back to `browser_action.default_title`, else the name. */
    readonly actionTitle: string
    /**
     * `action.default_icon` / `browser_action.default_icon`:
     * a path, or a size-keyed map of paths.
     * Passed through to the library's action map,
     * which resolves it against the extension root when serving `crx://extension-icon`.
     */
    readonly actionIcon: string | Record<string, string> | null
    /** `action.default_popup` / `browser_action.default_popup`; "" when neither is set. */
    readonly actionPopup: string
    /** MV3 `background.service_worker`; "" for MV2 or when there is none. */
    readonly serviceWorker: string
}

const StringList = orDefault(Schema.mutable(Schema.Array(Schema.String)), (): string[] => [])

/** A path or a size-keyed map of paths, both of which the library understands. */
const IconSpec = Schema.NullOr(
    Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.String)]),
)

const emptyActionSpec = () => ({ default_title: "", default_icon: null, default_popup: "" })

const ActionSpec = Schema.Struct({
    default_title: orDefault(Schema.String, () => ""),
    default_icon: orDefault(IconSpec, () => null),
    default_popup: orDefault(Schema.String, () => ""),
})

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
    action: orDefault(ActionSpec, emptyActionSpec),
    browser_action: orDefault(ActionSpec, emptyActionSpec),
    manifest_version: orDefault(Schema.Finite, () => 2),
    background: orDefault(
        Schema.Struct({ service_worker: orDefault(Schema.String, () => "") }),
        () => ({ service_worker: "" }),
    ),
})

const decodeManifest = decodeOr(ManifestSchema)

const emptyManifest = (): ParsedManifest => ({
    name: "",
    permissions: [],
    host_permissions: [],
    optional_permissions: [],
    optional_host_permissions: [],
    optionsPage: "",
    actionTitle: "",
    actionIcon: null,
    actionPopup: "",
    serviceWorker: "",
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
        // MV3 `action` wins over the MV2 `browser_action`, as in Chrome.
        actionTitle:
            manifest.action.default_title || manifest.browser_action.default_title || manifest.name,
        actionIcon: manifest.action.default_icon ?? manifest.browser_action.default_icon,
        actionPopup: manifest.action.default_popup || manifest.browser_action.default_popup,
        serviceWorker: manifest.manifest_version === 3 ? manifest.background.service_worker : "",
    }
}
