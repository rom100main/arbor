import type { ExtensionGrant } from "../../shared/protocol"
import type { DomainState } from "./state"

const cloneGrant = (grant: ExtensionGrant): ExtensionGrant => ({
    permissions: [...grant.permissions],
    origins: [...grant.origins],
})

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
