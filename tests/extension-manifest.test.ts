import { describe, expect, it } from "vite-plus/test"

import { parseManifest, type ParsedManifest } from "../src/main/extension-manifest"

const empty: ParsedManifest = {
    name: "",
    permissions: [],
    host_permissions: [],
    optional_permissions: [],
    optional_host_permissions: [],
    optionsPage: "",
}

describe("parseManifest", () => {
    it("yields the empty manifest for non-objects", () => {
        expect(parseManifest(null)).toEqual(empty)
        expect(parseManifest(undefined)).toEqual(empty)
        expect(parseManifest("manifest")).toEqual(empty)
        expect(parseManifest(42)).toEqual(empty)
        expect(parseManifest([])).toEqual(empty)
    })

    it("defaults absent fields without sinking the rest", () => {
        expect(parseManifest({ name: "Ext" })).toEqual({ ...empty, name: "Ext" })
        expect(parseManifest({ permissions: ["storage"], name: "Ext" })).toEqual({
            ...empty,
            name: "Ext",
            permissions: ["storage"],
        })
    })

    it("falls back on mistyped fields", () => {
        expect(parseManifest({ permissions: "tabs" })).toEqual(empty)
        expect(parseManifest({ permissions: ["tabs", 1] })).toEqual(empty)
        expect(parseManifest({ permissions: ["tabs"], host_permissions: 7 })).toEqual({
            ...empty,
            permissions: ["tabs"],
        })
    })

    it("reads the permission lists", () => {
        expect(
            parseManifest({
                name: "Ext",
                permissions: ["storage", "tabs"],
                host_permissions: ["https://example.com/*"],
                optional_permissions: ["cookies"],
                optional_host_permissions: ["https://other.example/*"],
            }),
        ).toEqual({
            name: "Ext",
            permissions: ["storage", "tabs"],
            host_permissions: ["https://example.com/*"],
            optional_permissions: ["cookies"],
            optional_host_permissions: ["https://other.example/*"],
            optionsPage: "",
        })
    })

    it("prefers options_page over options_ui.page", () => {
        expect(
            parseManifest({
                options_page: "options.html",
                options_ui: { page: "ui.html" },
            }).optionsPage,
        ).toBe("options.html")
    })

    it("falls back to options_ui.page when options_page is absent", () => {
        expect(parseManifest({ options_ui: { page: "ui.html" } }).optionsPage).toBe("ui.html")
    })

    it("keeps a leading slash for the caller to strip", () => {
        expect(parseManifest({ options_page: "/options.html" }).optionsPage).toBe("/options.html")
    })

    it("resolves to empty when neither options field is usable", () => {
        expect(parseManifest({}).optionsPage).toBe("")
        expect(parseManifest({ options_ui: "nope" }).optionsPage).toBe("")
        expect(parseManifest({ options_page: 7 }).optionsPage).toBe("")
    })
})
