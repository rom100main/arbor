import { describe, expect, it } from "vite-plus/test"

import {
    normalizeSearchTemplate,
    SEARCH_ENGINES,
    searchUrl,
    SUGGESTED_SEARCH_TEMPLATES,
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

    it("includes Google and Kagi", () => {
        const names = SEARCH_ENGINES.map((engine) => engine.name)
        expect(names).toContain("Google")
        expect(names).toContain("Kagi")
    })

    it("derives the bare template list from the same source", () => {
        expect(SUGGESTED_SEARCH_TEMPLATES).toEqual(SEARCH_ENGINES.map((e) => e.template))
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

    it("accepts every suggested template", () => {
        for (const template of SUGGESTED_SEARCH_TEMPLATES) {
            expect(normalizeSearchTemplate(template)).toBe(template)
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

    it("substitutes every occurrence of the token", () => {
        expect(searchUrl("https://x.test/%s/%s", "q")).toBe("https://x.test/q/q")
    })

    it("returns null when there is no token to substitute", () => {
        expect(searchUrl("https://duckduckgo.com/", "hi")).toBeNull()
    })
})
