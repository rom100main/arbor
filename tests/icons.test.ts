import { readFileSync } from "node:fs"

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
    // icons.json is the generation source; Icon.tsx can be stale on disk while still typechecking.
    it("covers every container icon", () => {
        for (const icon of CONTAINER_ICONS) {
            expect(icons).toContain(icon)
        }
    })
})
