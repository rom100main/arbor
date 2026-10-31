import type { Result } from "effect"
import { describe, expect, it } from "vite-plus/test"

import type { closeTab } from "../src/main/state/close-reopen"
import { PersistedTab } from "../src/main/state/persist"
import type { LastTab, UnknownContainer, UnknownTab } from "../src/shared/errors"
import type { ContainerId, TabId, TabNode } from "../src/shared/protocol"

// Type-level guards (checked by `vp check`).
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Expect<T extends true> = T

// The two IDs are distinct types: neither is assignable to the other.
export type TabIdIsNotContainerId = Expect<Equals<TabId extends ContainerId ? true : false, false>>
export type ContainerIdIsNotTabId = Expect<Equals<ContainerId extends TabId ? true : false, false>>

// The lenient disk record decodes to exactly the strict record.
export type PersistedTabIsTabNode = Expect<Equals<typeof PersistedTab.Type, TabNode>>

// An op's error union is exactly how it can fail: widening it is caught here.
type ErrorOf<R> = R extends Result.Result<unknown, infer E> ? E : never
export type CloseTabFailsPrecisely = Expect<
    Equals<ErrorOf<ReturnType<typeof closeTab>>, UnknownTab | UnknownContainer | LastTab>
>

describe("protocol types", () => {
    it("are checked by the compiler", () => {
        expect(PersistedTab.fields.id).toBeDefined()
    })
})
