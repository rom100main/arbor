import { describe, expect, it } from "vite-plus/test"

import {
    matchPatternCovers,
    originsCoveredBy,
    parseMatchPattern,
} from "../src/shared/match-patterns"

describe("parseMatchPattern", () => {
    it("parses scheme, host, and path", () => {
        expect(parseMatchPattern("https://account.proton.me/*")).toEqual({
            scheme: "https",
            host: "account.proton.me",
            path: "/*",
        })
    })

    it("parses <all_urls>", () => {
        expect(parseMatchPattern("<all_urls>")).toEqual({
            scheme: "<all_urls>",
            host: "<all_urls>",
            path: "<all_urls>",
        })
    })

    it("rejects invalid patterns", () => {
        expect(parseMatchPattern("not-a-pattern")).toBeNull()
        expect(parseMatchPattern("https://example.com")).toBeNull()
    })
})

describe("matchPatternCovers", () => {
    it("covers identical patterns", () => {
        expect(matchPatternCovers("https://*/*", "https://*/*")).toBe(true)
    })

    it("covers narrower host under https://*/* (Proton minimal origins)", () => {
        expect(matchPatternCovers("https://*/*", "https://account.proton.me/*")).toBe(true)
        expect(matchPatternCovers("https://*/*", "https://pass.proton.me/*")).toBe(true)
    })

    it("does not let http cover https or vice versa", () => {
        expect(matchPatternCovers("http://*/*", "https://example.com/*")).toBe(false)
        expect(matchPatternCovers("https://*/*", "http://example.com/*")).toBe(false)
    })

    it("scheme * covers http and https only", () => {
        expect(matchPatternCovers("*://*/*", "http://example.com/*")).toBe(true)
        expect(matchPatternCovers("*://*/*", "https://example.com/*")).toBe(true)
        expect(matchPatternCovers("*://*/*", "ftp://example.com/*")).toBe(false)
    })

    it("covers via <all_urls>", () => {
        expect(matchPatternCovers("<all_urls>", "https://example.com/*")).toBe(true)
    })

    it("does not cover a broader request with a narrower grant", () => {
        expect(matchPatternCovers("https://account.proton.me/*", "https://*/*")).toBe(false)
        expect(matchPatternCovers("https://account.proton.me/*", "https://pass.proton.me/*")).toBe(
            false,
        )
    })

    it("covers subdomains under *.example.com", () => {
        expect(matchPatternCovers("https://*.example.com/*", "https://www.example.com/*")).toBe(
            true,
        )
        expect(matchPatternCovers("https://*.example.com/*", "https://example.com/*")).toBe(true)
        expect(
            matchPatternCovers("https://*.example.com/*", "https://example.com.evil.com/*"),
        ).toBe(false)
    })

    it("covers paths under a /* prefix", () => {
        expect(
            matchPatternCovers("https://example.com/foo/*", "https://example.com/foo/bar/*"),
        ).toBe(true)
        expect(
            matchPatternCovers("https://example.com/foo/*", "https://example.com/foobar/*"),
        ).toBe(false)
    })
})

describe("originsCoveredBy", () => {
    it("Proton Pass minimal host permissions under broad host_permissions", () => {
        const granted = ["https://*/*", "http://*/*"]
        const requested = ["https://account.proton.me/*", "https://pass.proton.me/*"]
        expect(originsCoveredBy(granted, requested)).toBe(true)
    })

    it("false when any requested origin is uncovered", () => {
        expect(
            originsCoveredBy(["https://*/*"], ["https://a.example/*", "http://b.example/*"]),
        ).toBe(false)
    })

    it("false when granted is empty", () => {
        expect(originsCoveredBy([], ["https://account.proton.me/*"])).toBe(false)
    })
})
