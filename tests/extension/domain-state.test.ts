import { describe, expect, it } from "vite-plus/test"

import { isRequestCovered, mergeGrant } from "../../src/main/extension/permissions"
import { clearExtensionConsent, setExtensionConsent } from "../../src/main/state/extension-state"
import { initialState, type DomainState } from "../../src/main/state/state"

const seeded = (): DomainState => {
    let state = initialState()
    state = setExtensionConsent(state, "ext-aaa", {
        permissions: ["storage"],
        origins: ["https://example.com/*"],
    })
    return state
}

describe("consent ledger", () => {
    it("recording a grant replaces the previous scope for that id", () => {
        let state = seeded()
        state = setExtensionConsent(state, "ext-aaa", {
            permissions: ["tabs"],
            origins: [],
        })
        expect(state.extensionConsent["ext-aaa"]).toEqual({ permissions: ["tabs"], origins: [] })
    })

    it("covers previously accepted optional permissions until the ledger is cleared", () => {
        const optional = { permissions: ["tabs"], origins: ["https://other.example/*"] }
        let state = seeded()
        state = setExtensionConsent(
            state,
            "ext-aaa",
            mergeGrant(state.extensionConsent["ext-aaa"], optional),
        )
        const held = state.extensionConsent["ext-aaa"]
        expect(isRequestCovered(optional, held)).toBe(true)

        state = clearExtensionConsent(state, "ext-aaa")
        expect(state.extensionConsent).toEqual({})
        expect(isRequestCovered(optional, state.extensionConsent["ext-aaa"] ?? {})).toBe(false)
        expect(clearExtensionConsent(state, "ext-aaa")).toBe(state)
    })

    it("removes only the cleared id", () => {
        let state = seeded()
        state = setExtensionConsent(state, "ext-bbb", { permissions: [], origins: [] })
        state = clearExtensionConsent(state, "ext-aaa")
        expect(Object.keys(state.extensionConsent)).toEqual(["ext-bbb"])
    })
})
