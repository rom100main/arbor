import { describe, expect, it } from "vite-plus/test"

import { SEARCH_ENGINES } from "../src/renderer/settings/search-engines"
import {
    isNewTabImageDataUrl,
    MAX_NEW_TAB_IMAGE_CHARS,
    normalizeNewTabColor,
    normalizeSearchTemplate,
    searchUrl,
} from "../src/shared/settings"

describe("the suggested engines", () => {
    it("gives every engine a distinct name and a valid template", () => {
        const names = new Set<string>()
        for (const engine of SEARCH_ENGINES) {
            expect(names.has(engine.name)).toBe(false)
            names.add(engine.name)
            expect(normalizeSearchTemplate(engine.template)).toBe(engine.template)
        }
    })
})

describe("normalizeSearchTemplate", () => {
    it("accepts a template that already has %s and an https scheme", () => {
        expect(normalizeSearchTemplate("https://duckduckgo.com/?q=%s")).toBe(
            "https://duckduckgo.com/?q=%s",
        )
    })

    it("fills in a missing scheme on a bare host", () => {
        expect(normalizeSearchTemplate("duckduckgo.com/?q=%s")).toBe("https://duckduckgo.com/?q=%s")
        expect(normalizeSearchTemplate("kagi.com/search?q=%s")).toBe("https://kagi.com/search?q=%s")
    })

    it("trims surrounding whitespace", () => {
        expect(normalizeSearchTemplate("  https://kagi.com/?q=%s  ")).toBe("https://kagi.com/?q=%s")
    })

    it("rejects a template with no %s", () => {
        expect(normalizeSearchTemplate("https://duckduckgo.com/")).toBeNull()
        expect(normalizeSearchTemplate("")).toBeNull()
        expect(normalizeSearchTemplate("   ")).toBeNull()
    })

    it("rejects a template that is not http(s)", () => {
        expect(normalizeSearchTemplate("ftp://example.com/?q=%s")).toBeNull()
        expect(normalizeSearchTemplate("javascript:alert(%s)")).toBeNull()
        // No scheme and not a bare host either.
        expect(normalizeSearchTemplate("not a url %s")).toBeNull()
    })

    it("returns null for a URL with an empty host instead of throwing", () => {
        expect(normalizeSearchTemplate("https:///?q=%s")).toBeNull()
    })

    it("is total for arbitrary strings", () => {
        for (const input of ["", "%s", ":///%s", "https://%s", "http:// %s", "\u0000%s"]) {
            expect(() => normalizeSearchTemplate(input)).not.toThrow()
        }
    })
})

describe("searchUrl", () => {
    it("substitutes and encodes the query", () => {
        expect(searchUrl("https://duckduckgo.com/?q=%s", "hello world")).toBe(
            "https://duckduckgo.com/?q=hello%20world",
        )
    })

    it("encodes characters that would otherwise break the URL", () => {
        expect(searchUrl("https://x.test/?q=%s", "a&b=c#d")).toBe("https://x.test/?q=a%26b%3Dc%23d")
    })

    it("returns null when there is no token to substitute", () => {
        expect(searchUrl("https://duckduckgo.com/", "hi")).toBeNull()
    })
})

describe("the new-tab page", () => {
    it("normalises a #rrggbb color and rejects anything else", () => {
        expect(normalizeNewTabColor("#FF8800")).toBe("#ff8800")
        expect(normalizeNewTabColor("  #123abc ")).toBe("#123abc")
        expect(normalizeNewTabColor("red")).toBeNull()
        expect(normalizeNewTabColor("#fff")).toBeNull()
        expect(normalizeNewTabColor("#12345")).toBeNull()
        expect(normalizeNewTabColor("")).toBeNull()
    })

    it("accepts only bounded image data URLs", () => {
        expect(isNewTabImageDataUrl("data:image/jpeg;base64,AAAA")).toBe(true)
        expect(isNewTabImageDataUrl("data:image/png;base64,BBBB")).toBe(true)
        expect(isNewTabImageDataUrl(null)).toBe(false)
        expect(isNewTabImageDataUrl("https://example.com/bg.png")).toBe(false)
        expect(isNewTabImageDataUrl("data:image/jpeg,not-base64")).toBe(false)
        expect(
            isNewTabImageDataUrl(`data:image/jpeg;base64,${"A".repeat(MAX_NEW_TAB_IMAGE_CHARS)}`),
        ).toBe(false)
    })
})
