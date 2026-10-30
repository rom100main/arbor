import { describe, expect, it } from "vite-plus/test"

import { PersistedTab } from "../src/main/state/persist"
import type { ContainerId, TabId, TabNode } from "../src/shared/protocol"

// Type-level guards (checked by `vp check`).
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Expect<T extends true> = T

// The two IDs are distinct types: neither is assignable to the other.
export type TabIdIsNotContainerId = Expect<Equals<TabId extends ContainerId ? true : false, false>>
export type ContainerIdIsNotTabId = Expect<Equals<ContainerId extends TabId ? true : false, false>>

// The lenient disk record decodes to exactly the strict record.
export type PersistedTabIsTabNode = Expect<Equals<typeof PersistedTab.Type, TabNode>>

describe("protocol types", () => {
    it("are checked by the compiler", () => {
        expect(PersistedTab.fields.id).toBeDefined()
    })
})
