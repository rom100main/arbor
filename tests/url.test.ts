import { describe, expect, it } from "vite-plus/test"

import { displayTabLabel, displayUrl, omniboxTarget, urlDisplayParts } from "../src/shared/url"

describe("omniboxTarget", () => {
    it("passes a scheme through unchanged, including internal pages", () => {
        expect(omniboxTarget("arbor://settings")).toBe("arbor://settings")
        expect(omniboxTarget("https://example.com/a")).toBe("https://example.com/a")
        expect(omniboxTarget("about:blank")).toBe("about:blank")
    })

    it("upgrades a bare host to https", () => {
        expect(omniboxTarget("example.com")).toBe("https://example.com")
        expect(omniboxTarget("example.com/a/b")).toBe("https://example.com/a/b")
    })

    it("searches with the supplied template", () => {
        expect(omniboxTarget("hello world", "https://kagi.com/search?q=%s")).toBe(
            "https://kagi.com/search?q=hello%20world",
        )
    })

    it("falls back to the default engine when no template is given", () => {
        expect(omniboxTarget("hello")).toBe("https://duckduckgo.com/?q=hello")
    })

    it("falls back to the default engine when the stored template is unusable", () => {
        // A bad template must never navigate somewhere broken.
        expect(omniboxTarget("hello", "https://duckduckgo.com/")).toBe(
            "https://duckduckgo.com/?q=hello",
        )
        expect(omniboxTarget("hello", "garbage")).toBe("https://duckduckgo.com/?q=hello")
    })

    it("returns about:blank for empty input", () => {
        expect(omniboxTarget("")).toBe("about:blank")
        expect(omniboxTarget("   ")).toBe("about:blank")
    })
})

describe("urlDisplayParts", () => {
    it("keeps only the host full-strength, greying scheme and path", () => {
        expect(urlDisplayParts("https://example.com/a/b?q=1#frag")).toEqual({
            prefix: "https://",
            host: "example.com",
            suffix: "/a/b?q=1#frag",
        })
        expect(urlDisplayParts("arbor://settings")).toEqual({
            prefix: "arbor://",
            host: "settings",
            suffix: "",
        })
    })

    it("locates the host past userinfo and before the port", () => {
        expect(urlDisplayParts("https://user:secret@example.com:8080/p")).toEqual({
            prefix: "https://user:secret@",
            host: "example.com",
            suffix: ":8080/p",
        })
        expect(urlDisplayParts("http://[::1]:3000/x")).toEqual({
            prefix: "http://",
            host: "[::1]",
            suffix: ":3000/x",
        })
    })

    it("handles protocol-relative and bare hosts", () => {
        expect(urlDisplayParts("//example.com/p")).toEqual({
            prefix: "//",
            host: "example.com",
            suffix: "/p",
        })
        expect(urlDisplayParts("example.com:8080/p")).toEqual({
            prefix: "",
            host: "example.com",
            suffix: ":8080/p",
        })
        expect(urlDisplayParts("localhost:3000")).toEqual({
            prefix: "",
            host: "localhost",
            suffix: ":3000",
        })
    })

    it("preserves the raw string, including casing and punycode", () => {
        const value = "https://EXAMPLE.com/%C3%A9"
        const parts = urlDisplayParts(value)
        expect(parts.prefix + parts.host + parts.suffix).toBe(value)
        expect(parts.host).toBe("EXAMPLE.com")
    })

    it("returns no host for search queries, opaque schemes and empty input", () => {
        for (const value of [
            "hello world",
            "hello",
            "about:blank",
            "mailto:a@b.com",
            "",
            "file:///etc/hosts",
        ]) {
            expect(urlDisplayParts(value)).toEqual({ prefix: value, host: "", suffix: "" })
        }
    })
})

describe("displayUrl", () => {
    it("is empty for the new-tab page and legacy blank pages", () => {
        expect(displayUrl("arbor://newtab")).toBe("")
        expect(displayUrl("arbor://newtab/")).toBe("")
        expect(displayUrl("about:blank")).toBe("")
    })

    it("keeps ordinary and internal page URLs", () => {
        expect(displayUrl("https://example.com")).toBe("https://example.com")
        expect(displayUrl("arbor://settings")).toBe("arbor://settings")
    })
})

describe("displayTabLabel", () => {
    it("is 'New tab' for the new-tab page until renamed", () => {
        expect(displayTabLabel({ url: "arbor://newtab", title: "", userLabel: null })).toBe(
            "New tab",
        )
        expect(displayTabLabel({ url: "about:blank", title: "", userLabel: null })).toBe("New tab")
        expect(displayTabLabel({ url: "arbor://newtab", title: "", userLabel: "Pinned" })).toBe(
            "Pinned",
        )
    })

    it("falls back to title then URL for ordinary pages", () => {
        expect(
            displayTabLabel({ url: "https://example.com", title: "Example", userLabel: null }),
        ).toBe("Example")
        expect(displayTabLabel({ url: "https://example.com", title: "", userLabel: null })).toBe(
            "https://example.com",
        )
    })
})
