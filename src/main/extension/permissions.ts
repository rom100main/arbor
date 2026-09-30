/**
 * Pure permission-scope math for extension consent.
 *
 * `electron-chrome-extensions` seeds its permission map from the manifest
 * and applies a grant only when our `requestPermissions` hook returns `true`,
 * so deciding "already covered vs. needs a prompt" is ours.
 * All of that stays side-effect free here.
 */

import { originsCoveredBy } from "../shared/match-patterns"
import type { ExtensionGrant, PermissionPromptRequest } from "../shared/protocol"

/** Manifest fields that declare what an extension may do. */
export interface ManifestPermissions {
    permissions?: string[]
    host_permissions?: string[]
    optional_permissions?: string[]
    optional_host_permissions?: string[]
}

/** A requested (or held) scope; missing lists mean "nothing asked for". */
export interface PermissionScope {
    permissions?: string[]
    origins?: string[]
}

const unique = (values: readonly string[]): string[] => [...new Set(values)]

export const emptyGrant = (): ExtensionGrant => ({ permissions: [], origins: [] })

/** Required scope: what the library seeds into its map on load. */
export const manifestGranted = (manifest: ManifestPermissions): ExtensionGrant => ({
    permissions: unique(manifest.permissions ?? []),
    origins: unique(manifest.host_permissions ?? []),
})

/** Everything the extension may ever ask for (required + optional). */
export const optionalScope = (manifest: ManifestPermissions): ExtensionGrant => ({
    permissions: unique([
        ...(manifest.permissions ?? []),
        ...(manifest.optional_permissions ?? []),
    ]),
    origins: unique([
        ...(manifest.host_permissions ?? []),
        ...(manifest.optional_host_permissions ?? []),
    ]),
})

/** Union of two scopes. */
export const mergeGrant = (a: PermissionScope, b: PermissionScope): ExtensionGrant => ({
    permissions: unique([...(a.permissions ?? []), ...(b.permissions ?? [])]),
    origins: unique([...(a.origins ?? []), ...(b.origins ?? [])]),
})

/** True when `granted` already covers every API name and origin in `request`. */
export const isRequestCovered = (request: PermissionScope, granted: PermissionScope): boolean => {
    for (const permission of request.permissions ?? []) {
        if (!granted.permissions?.includes(permission)) return false
    }
    return originsCoveredBy(granted.origins ?? [], request.origins ?? [])
}

/** The prompt payload for a runtime request. */
export const toPromptRequest = (
    extensionId: string,
    name: string,
    request: PermissionScope,
): PermissionPromptRequest => ({
    kind: "request",
    id: extensionId,
    name,
    permissions: unique(request.permissions ?? []),
    origins: unique(request.origins ?? []),
    icon: null,
})
