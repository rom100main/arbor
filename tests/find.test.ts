import { describe, expect, it } from "vite-plus/test"

import { buildFindRegExp, escapeRegExp } from "../src/main/windows/find-in-page"

const find = (query: string, overrides = {}) => ({
    query,
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    ...overrides,
})

describe("escapeRegExp", () => {
    it("escapes every metacharacter", () => {
        expect(escapeRegExp("a.b*c?^$(x|y)[z]+")).toBe("a\\.b\\*c\\?\\^\\$\\(x\\|y\\)\\[z\\]\\+")
    })
})

describe("buildFindRegExp", () => {
    it("matches a literal case-insensitively by default", () => {
        const built = buildFindRegExp(find("Hello"))
        expect(built.ok).toBe(true)
        if (!built.ok) return
        built.regExp.lastIndex = 0
        expect("say HELLO there".match(built.regExp)).toEqual(["HELLO"])
    })

    it("is case sensitive when asked", () => {
        const built = buildFindRegExp(find("hello", { caseSensitive: true }))
        expect(built.ok).toBe(true)
        if (!built.ok) return
        expect("HELLO hello".match(built.regExp)).toEqual(["hello"])
    })

    it("treats the query literally unless regex is on", () => {
        const literal = buildFindRegExp(find("a.b"))
        const pattern = buildFindRegExp(find("a.b", { regex: true }))
        expect(literal.ok && pattern.ok).toBe(true)
        if (!literal.ok || !pattern.ok) return
        expect("a.b axb".match(literal.regExp)).toEqual(["a.b"])
        expect("a.b axb".match(pattern.regExp)).toEqual(["a.b", "axb"])
    })

    it("requires word boundaries for whole-word literal matches", () => {
        const built = buildFindRegExp(find("cat", { wholeWord: true }))
        expect(built.ok).toBe(true)
        if (!built.ok) return
        expect("cat scatter cat".match(built.regExp) ?? []).toEqual(["cat", "cat"])
    })

    it("reports invalid regex instead of throwing", () => {
        const built = buildFindRegExp(find("[", { regex: true }))
        expect(built.ok).toBe(false)
        if (built.ok) return
        expect(built.error.length).toBeGreaterThan(0)
    })

    it("rejects an empty query", () => {
        expect(buildFindRegExp(find("")).ok).toBe(false)
    })
})
