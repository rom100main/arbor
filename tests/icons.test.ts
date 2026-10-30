import { readFileSync } from "node:fs"

import { Schema } from "effect"
import { describe, expect, it } from "vite-plus/test"

import type { IconName } from "../src/renderer/ui/Icon"
import { CONTAINER_ICONS, type ContainerIcon } from "../src/shared/constants"

// Type-level guard (checked by `vp check`):
// every ContainerIcon must be covered by icons.json through the generated IconName union.
type EnsureIconName<T extends IconName> = T
export type ContainerIconsAreCovered = EnsureIconName<ContainerIcon>

const iconsUrl = new URL("../src/renderer/ui/icons.json", import.meta.url)
const icons = Schema.decodeUnknownSync(Schema.Array(Schema.String))(
    JSON.parse(readFileSync(iconsUrl, "utf8")),
)

describe("icons", () => {
    // icons.json is the generation source; Icon.tsx can be stale on disk while still typechecking.
    it("covers every container icon", () => {
        for (const icon of CONTAINER_ICONS) {
            expect(icons).toContain(icon)
        }
    })
})
