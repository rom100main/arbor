import type { ExtensionGrant } from "../../shared/protocol"
import type { DomainState } from "./state"

const cloneGrant = (grant: ExtensionGrant): ExtensionGrant => ({
    permissions: [...grant.permissions],
    origins: [...grant.origins],
})

/** Append the extension to the pinned toolbar list; already-pinned is a no-op. */
export const pinExtension = (state: DomainState, extensionId: string): DomainState =>
    state.pinnedExtensionIds.includes(extensionId)
        ? state
        : { ...state, pinnedExtensionIds: [...state.pinnedExtensionIds, extensionId] }

/** Unknown id is a no-op. */
export const unpinExtension = (state: DomainState, extensionId: string): DomainState =>
    state.pinnedExtensionIds.includes(extensionId)
        ? {
              ...state,
              pinnedExtensionIds: state.pinnedExtensionIds.filter((id) => id !== extensionId),
          }
        : state

/** Record the consented scope for an extension, replacing any previous entry. */
export const setExtensionConsent = (
    state: DomainState,
    extensionId: string,
    grant: ExtensionGrant,
): DomainState => ({
    ...state,
    extensionConsent: { ...state.extensionConsent, [extensionId]: cloneGrant(grant) },
})

/** Drop every remembered grant for an extension; unknown id is a no-op. */
export const clearExtensionConsent = (state: DomainState, extensionId: string): DomainState => {
    if (!(extensionId in state.extensionConsent)) return state
    const extensionConsent = { ...state.extensionConsent }
    delete extensionConsent[extensionId]
    return { ...state, extensionConsent }
}

/**
 * Full teardown of an extension's domain state: forget its grants and unpin it.
 * Unpacked dev installs are also keyed by source path, so both keys go.
 */
export const forgetExtension = (
    state: DomainState,
    extensionId: string,
    sourcePath?: string | null,
): DomainState => {
    let next = clearExtensionConsent(state, extensionId)
    if (sourcePath && sourcePath !== extensionId) {
        next = clearExtensionConsent(next, sourcePath)
    }
    return unpinExtension(next, extensionId)
}
