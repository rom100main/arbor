import { describe, expect, it } from "vite-plus/test"

import { isUrlLike, omniboxTarget } from "../src/shared/url"

describe("isUrlLike", () => {
    it("recognises schemes and bare hosts", () => {
        expect(isUrlLike("https://example.com")).toBe(true)
        expect(isUrlLike("arbor://settings")).toBe(true)
        expect(isUrlLike("example.com")).toBe(true)
        expect(isUrlLike("example.com/path?q=1")).toBe(true)
    })

    it("rejects bare search text and empty input", () => {
        expect(isUrlLike("hello world")).toBe(false)
        expect(isUrlLike("")).toBe(false)
        expect(isUrlLike("   ")).toBe(false)
    })
})

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
