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
