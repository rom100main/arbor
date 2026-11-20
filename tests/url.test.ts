import { describe, expect, it } from "vite-plus/test"

import { omniboxTarget } from "../src/shared/url"

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
