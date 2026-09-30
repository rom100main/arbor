import { describe, expect, it } from "vite-plus/test"

import {
    isRequestCovered,
    manifestGranted,
    mergeGrant,
    optionalScope,
} from "../../src/main/extension/permissions"

const manifest = {
    permissions: ["storage", "tabs"],
    host_permissions: ["https://example.com/*"],
    optional_permissions: ["cookies"],
    optional_host_permissions: ["https://other.example/*"],
}

describe("manifestGranted", () => {
    it("reads required permissions and host permissions", () => {
        expect(manifestGranted(manifest)).toEqual({
            permissions: ["storage", "tabs"],
            origins: ["https://example.com/*"],
        })
    })

    it("treats missing lists as empty", () => {
        expect(manifestGranted({})).toEqual({ permissions: [], origins: [] })
    })

    it("dedupes repeated entries", () => {
        expect(
            manifestGranted({ permissions: ["tabs", "tabs"], host_permissions: ["https://*/*"] })
                .permissions,
        ).toEqual(["tabs"])
    })
})

describe("optionalScope", () => {
    it("unions required and optional declarations", () => {
        expect(optionalScope(manifest)).toEqual({
            permissions: ["storage", "tabs", "cookies"],
            origins: ["https://example.com/*", "https://other.example/*"],
        })
    })
})

describe("isRequestCovered", () => {
    it("is covered by the manifest scope", () => {
        expect(
            isRequestCovered(
                { permissions: ["storage"], origins: ["https://example.com/*"] },
                manifestGranted(manifest),
            ),
        ).toBe(true)
    })

    it("is covered by a wider granted origin (match patterns)", () => {
        expect(
            isRequestCovered(
                { origins: ["https://deep.example.com/*"] },
                { origins: ["https://*/*"] },
            ),
        ).toBe(true)
    })

    it("is not covered when only part of the ask is granted", () => {
        expect(
            isRequestCovered({ permissions: ["storage", "cookies"] }, manifestGranted(manifest)),
        ).toBe(false)
        expect(
            isRequestCovered({ origins: ["https://other.example/*"] }, manifestGranted(manifest)),
        ).toBe(false)
    })

    it("rejects asks outside the declared optional scope", () => {
        const scope = optionalScope(manifest)
        expect(
            isRequestCovered(
                { permissions: ["cookies"], origins: ["https://other.example/*"] },
                scope,
            ),
        ).toBe(true)
        expect(isRequestCovered({ permissions: ["history"] }, scope)).toBe(false)
        expect(isRequestCovered({ origins: ["<all_urls>"] }, scope)).toBe(false)
    })

    it("treats an empty ask as covered", () => {
        expect(isRequestCovered({}, manifestGranted(manifest))).toBe(true)
    })
})

describe("mergeGrant", () => {
    it("unions and dedupes both lists", () => {
        expect(
            mergeGrant(
                { permissions: ["a"], origins: ["https://a/*"] },
                { permissions: ["a", "b"], origins: ["https://b/*"] },
            ),
        ).toEqual({
            permissions: ["a", "b"],
            origins: ["https://a/*", "https://b/*"],
        })
    })
})
