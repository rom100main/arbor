import path from "node:path"

import { describe, expect, it } from "vite-plus/test"

import { iconPathFor, resolveIcon } from "../../src/main/extension/action"

const ROOT = path.resolve("/ext")

describe("resolveIcon", () => {
    it("resolves a path relative to the extension root", () => {
        expect(resolveIcon(ROOT, "assets/icon.png")).toBe(path.join(ROOT, "assets/icon.png"))
    })

    it("strips leading slashes, which manifests write extension-relative", () => {
        // Proton Pass ships "/assets/protonpass-icon-32.png". Resolved without stripping,
        // path.resolve would escape the root and the icon would be dropped.
        expect(resolveIcon(ROOT, "/assets/icon-32.png")).toBe(path.join(ROOT, "assets/icon-32.png"))
    })

    it("refuses to read outside the extension root", () => {
        expect(resolveIcon(ROOT, "../../../etc/passwd")).toBeNull()
        expect(resolveIcon(ROOT, "assets/../../secret")).toBeNull()
    })
})

describe("iconPathFor", () => {
    const map = { "16": "icon16.png", "32": "icon32.png", "48": "icon48.png", "128": "icon128.png" }

    it("prefers the exact size", () => {
        expect(iconPathFor(ROOT, map, 32)).toBe(path.join(ROOT, "icon32.png"))
        expect(iconPathFor(ROOT, map, 16)).toBe(path.join(ROOT, "icon16.png"))
    })

    it("falls up to the next larger size rather than rendering nothing", () => {
        expect(iconPathFor(ROOT, map, 24)).toBe(path.join(ROOT, "icon32.png"))
        expect(iconPathFor(ROOT, map, 64)).toBe(path.join(ROOT, "icon128.png"))
    })

    it("uses the largest available when every size is smaller than asked", () => {
        expect(iconPathFor(ROOT, map, 8)).toBe(path.join(ROOT, "icon16.png"))
    })

    it("accepts a bare path", () => {
        expect(iconPathFor(ROOT, "icon.png", 32)).toBe(path.join(ROOT, "icon.png"))
    })

    it("returns null for an unusable size map", () => {
        expect(iconPathFor(ROOT, {}, 32)).toBeNull()
        expect(iconPathFor(ROOT, { large: "icon.png" }, 32)).toBeNull()
    })
})
