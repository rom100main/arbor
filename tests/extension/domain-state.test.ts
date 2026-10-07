import { describe, expect, it } from "vite-plus/test"

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

    it("removes only the cleared id and is idempotent", () => {
        let state = seeded()
        state = setExtensionConsent(state, "ext-bbb", { permissions: [], origins: [] })
        state = clearExtensionConsent(state, "ext-aaa")
        expect(Object.keys(state.extensionConsent)).toEqual(["ext-bbb"])
        expect(clearExtensionConsent(state, "ext-aaa")).toBe(state)
    })
})
