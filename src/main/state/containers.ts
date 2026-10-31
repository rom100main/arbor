import { Result } from "effect"

import { CONTAINER_COLORS } from "../../shared/constants"
import { EmptyContainer } from "../../shared/errors"
import type { ContainerIcon, ContainerId, ContainerMeta, TabId } from "../../shared/protocol"
import { containerOf, putTab, touch, type DomainState } from "./state"
import { createTab } from "./tabs"

export interface CreateContainerOptions {
    id: ContainerId
    tabId: TabId
    now: number
    name?: string
    color?: string
}

export const createContainer = (state: DomainState, options: CreateContainerOptions) => {
    const usedColors = new Set(state.containers.map((c) => c.color))
    const pickedColor =
        options.color ?? CONTAINER_COLORS.find((c) => !usedColors.has(c)) ?? CONTAINER_COLORS[0]
    const resolvedName =
        options.name ??
        (() => {
            let n = state.containers.length + 1
            while (state.containers.some((c) => c.name === `Container ${n}`)) n += 1
            return `Container ${n}`
        })()
    const container: ContainerMeta = {
        id: options.id,
        name: resolvedName,
        color: pickedColor,
        icon: "world",
        activeTabId: null,
    }
    return createTab(
        { ...state, containers: [...state.containers, container] },
        { id: options.tabId, now: options.now, containerId: options.id },
    )
}

export const switchContainer = (state: DomainState, containerId: ContainerId, now: number) =>
    Result.gen(function* () {
        const container = yield* containerOf(state, containerId)
        if (container.activeTabId === null) {
            return yield* Result.fail(new EmptyContainer({ containerId }))
        }
        const active = state.tabs.get(container.activeTabId)
        const next = active ? putTab(state, touch(active, now)) : state
        return { ...next, activeContainerId: containerId }
    })

const updateContainer = (
    state: DomainState,
    containerId: ContainerId,
    patch: Partial<Pick<ContainerMeta, "name" | "color" | "icon">>,
) =>
    Result.gen(function* () {
        yield* containerOf(state, containerId)
        return {
            ...state,
            containers: state.containers.map((c) =>
                c.id === containerId ? { ...c, ...patch } : c,
            ),
        }
    })

export const renameContainer = (state: DomainState, containerId: ContainerId, name: string) =>
    updateContainer(state, containerId, { name })

export const setContainerColor = (state: DomainState, containerId: ContainerId, color: string) =>
    updateContainer(state, containerId, { color })

export const setContainerIcon = (
    state: DomainState,
    containerId: ContainerId,
    icon: ContainerIcon,
) => updateContainer(state, containerId, { icon })

export const reorderContainer = (state: DomainState, containerId: ContainerId, toIndex: number) =>
    Result.gen(function* () {
        const container = yield* containerOf(state, containerId)
        const from = state.containers.indexOf(container)
        const clamped = Math.max(0, Math.min(toIndex, state.containers.length - 1))
        if (from === clamped) return state
        const next = [...state.containers]
        const [moved] = next.splice(from, 1)
        next.splice(clamped, 0, moved)
        return { ...state, containers: next }
    })
