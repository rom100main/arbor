import { describe, expect, it } from "vite-plus/test"

import { parseManifest, type ParsedManifest } from "../../src/main/extension/manifest"

const empty: ParsedManifest = {
    name: "",
    permissions: [],
    host_permissions: [],
    optional_permissions: [],
    optional_host_permissions: [],
    optionsPage: "",
    actionTitle: "",
    actionIcon: null,
    actionPopup: "",
    serviceWorker: "",
}

describe("action fields", () => {
    it("reads title, icon and popup from an MV3 action", () => {
        const manifest = parseManifest({
            name: "Ext",
            action: {
                default_title: "Ext title",
                default_icon: { "16": "icon16.png" },
                default_popup: "popup.html",
            },
        })
        expect(manifest.actionTitle).toBe("Ext title")
        expect(manifest.actionIcon).toEqual({ "16": "icon16.png" })
        expect(manifest.actionPopup).toBe("popup.html")
    })

    it("accepts a bare icon path as well as a size map", () => {
        expect(parseManifest({ action: { default_icon: "icon.png" } }).actionIcon).toBe("icon.png")
    })

    it("falls back to browser_action for an MV2 extension", () => {
        const manifest = parseManifest({
            name: "Ext",
            browser_action: { default_title: "Legacy", default_icon: "legacy.png" },
        })
        expect(manifest.actionTitle).toBe("Legacy")
        expect(manifest.actionIcon).toBe("legacy.png")
    })

    it("prefers action over browser_action, as Chrome does", () => {
        const manifest = parseManifest({
            name: "Ext",
            action: { default_title: "Modern" },
            browser_action: { default_title: "Legacy" },
        })
        expect(manifest.actionTitle).toBe("Modern")
    })

    it("falls back to the extension name when no title is declared", () => {
        expect(parseManifest({ name: "Ext", action: {} }).actionTitle).toBe("Ext")
    })

    it("repairs a mistyped action without losing it", () => {
        const manifest = parseManifest({ name: "Ext", action: "nonsense" })
        expect(manifest.actionTitle).toBe("Ext")
        expect(manifest.actionIcon).toBeNull()
    })
})

/**
 * `actionTitle` falls back to the extension name, so a manifest that declares a name but no
 * action is not the empty baseline.
 */
const named = (name: string, rest: Partial<ParsedManifest> = {}): ParsedManifest => ({
    ...empty,
    name,
    actionTitle: name,
    ...rest,
})

describe("parseManifest", () => {
    it("yields the empty manifest for non-objects", () => {
        expect(parseManifest(null)).toEqual(empty)
        expect(parseManifest(undefined)).toEqual(empty)
        expect(parseManifest("manifest")).toEqual(empty)
        expect(parseManifest(42)).toEqual(empty)
        expect(parseManifest([])).toEqual(empty)
    })

    it("defaults absent fields without sinking the rest", () => {
        expect(parseManifest({ name: "Ext" })).toEqual(named("Ext"))
        expect(parseManifest({ permissions: ["storage"], name: "Ext" })).toEqual(
            named("Ext", { permissions: ["storage"] }),
        )
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
        ).toEqual(
            named("Ext", {
                permissions: ["storage", "tabs"],
                host_permissions: ["https://example.com/*"],
                optional_permissions: ["cookies"],
                optional_host_permissions: ["https://other.example/*"],
            }),
        )
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

describe("service worker", () => {
    it("reads an MV3 background service worker", () => {
        const manifest = parseManifest({
            manifest_version: 3,
            background: { service_worker: "sw.js" },
        })
        expect(manifest.serviceWorker).toBe("sw.js")
    })

    it("ignores a service worker outside MV3", () => {
        expect(
            parseManifest({ manifest_version: 2, background: { service_worker: "sw.js" } })
                .serviceWorker,
        ).toBe("")
        expect(
            parseManifest({ manifest_version: 3, background: { scripts: [] } }).serviceWorker,
        ).toBe("")
    })
})
