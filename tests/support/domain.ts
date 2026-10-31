import { Option, Result } from "effect"

import type { CreateContainerOptions } from "../../src/main/state/containers"
import type { CreateChildTabOptions, CreateTabOptions } from "../../src/main/state/tabs"
import type { ContainerId, TabId } from "../../src/shared/protocol"

/** The new state of an op that must succeed. */
export const ok = Result.getOrThrow

/** The failure of an op that must fail. */
export const err = <E>(result: Result.Result<unknown, E>): E =>
    Option.getOrThrow(Result.getFailure(result))

let counter = 0
export const nextTabId = (): TabId => `tab-${++counter}`
export const nextContainerId = (): ContainerId => `container-${++counter}`

/** Creator options with fresh IDs; `now` is 0 unless given. */
export const newContainer = (
    options: Partial<CreateContainerOptions> = {},
): CreateContainerOptions => ({ id: nextContainerId(), tabId: nextTabId(), now: 0, ...options })

export const newTab = (options: Partial<CreateTabOptions> = {}): CreateTabOptions => ({
    id: nextTabId(),
    now: 0,
    ...options,
})

export const newChild = (options: Partial<CreateChildTabOptions> = {}): CreateChildTabOptions => ({
    id: nextTabId(),
    now: 0,
    ...options,
})
