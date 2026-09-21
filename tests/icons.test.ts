import { existsSync, readFileSync } from "node:fs"

import { describe, expect, it } from "vite-plus/test"

import type { IconName } from "../src/renderer/ui/Icon"
import { CONTAINER_ICONS, type ContainerIcon } from "../src/shared/protocol"

// Type-level guard (checked by `vp check`):
// every ContainerIcon must be covered by icons.json through the generated IconName union.
type EnsureIconName<T extends IconName> = T
export type ContainerIconsAreCovered = EnsureIconName<ContainerIcon>

const iconsUrl = new URL("../src/renderer/ui/icons.json", import.meta.url)
const isStringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((entry): entry is string => typeof entry === "string")
const rawIcons: unknown = JSON.parse(readFileSync(iconsUrl, "utf8"))
if (!isStringArray(rawIcons)) throw new Error("Invalid icons.json: expected an array of strings")
const icons = rawIcons

describe("icons", () => {
    it("covers every container icon", () => {
        for (const icon of CONTAINER_ICONS) {
            expect(icons).toContain(icon)
        }
    })

    it("lists unique kebab-case names with a matching Tabler SVG", () => {
        expect(new Set(icons).size).toBe(icons.length)
        for (const name of icons) {
            expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
            // `@tabler/icons/outline/*` maps to `icons/outline/*` on disk via exports.
            const svg = new URL(
                `../node_modules/@tabler/icons/icons/outline/${name}.svg`,
                import.meta.url,
            )
            expect(existsSync(svg)).toBe(true)
        }
    })

    it("is generated into Icon.tsx", () => {
        const source = readFileSync(new URL("../src/renderer/ui/Icon.tsx", import.meta.url), "utf8")
        for (const name of icons) {
            expect(source).toContain(`@tabler/icons/outline/${name}.svg?raw`)
        }
    })
})
