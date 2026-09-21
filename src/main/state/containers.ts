import { CONTAINER_COLORS } from "../../shared/protocol"
import type { ContainerIcon, ContainerId } from "../../shared/protocol"
import { containerOf, DomainError, touch, withTabs, type DomainState } from "./state"
import { createTab } from "./tabs"

export const createContainer = (state: DomainState, name?: string, color?: string): DomainState => {
    const id = `container-${crypto.randomUUID()}`
    const usedColors = new Set(state.containers.map((c) => c.color))
    const pickedColor =
        color ?? CONTAINER_COLORS.find((c) => !usedColors.has(c)) ?? CONTAINER_COLORS[0]
    const resolvedName =
        name ??
        (() => {
            let n = state.containers.length + 1
            while (state.containers.some((c) => c.name === `Container ${n}`)) n += 1
            return `Container ${n}`
        })()
    const container = {
        id,
        name: resolvedName,
        color: pickedColor,
        icon: "world" as ContainerIcon,
        activeTabId: null,
    }
    return createTab(
        { ...state, containers: [...state.containers, container] },
        { containerId: id },
    )
}

export const switchContainer = (state: DomainState, containerId: ContainerId): DomainState => {
    const container = containerOf(state, containerId)
    if (container.activeTabId === null) {
        throw new DomainError(`Container ${containerId} has no tabs`)
    }
    const next = withTabs(state, new Map(state.tabs))
    const active = next.tabs.get(container.activeTabId)
    if (active) next.tabs.set(active.id, touch(active))
    return { ...next, activeContainerId: containerId }
}

export const renameContainer = (
    state: DomainState,
    containerId: ContainerId,
    name: string,
): DomainState => {
    containerOf(state, containerId)
    return {
        ...state,
        containers: state.containers.map((c) => (c.id === containerId ? { ...c, name } : c)),
    }
}

export const setContainerColor = (
    state: DomainState,
    containerId: ContainerId,
    color: string,
): DomainState => {
    containerOf(state, containerId)
    return {
        ...state,
        containers: state.containers.map((c) => (c.id === containerId ? { ...c, color } : c)),
    }
}

export const setContainerIcon = (
    state: DomainState,
    containerId: ContainerId,
    icon: ContainerIcon,
): DomainState => {
    containerOf(state, containerId)
    return {
        ...state,
        containers: state.containers.map((c) => (c.id === containerId ? { ...c, icon } : c)),
    }
}

export const reorderContainer = (
    state: DomainState,
    containerId: ContainerId,
    toIndex: number,
): DomainState => {
    const from = state.containers.findIndex((c) => c.id === containerId)
    if (from === -1) throw new DomainError(`Unknown container: ${containerId}`)
    const clamped = Math.max(0, Math.min(toIndex, state.containers.length - 1))
    if (from === clamped) return state
    const next = [...state.containers]
    const [moved] = next.splice(from, 1)
    next.splice(clamped, 0, moved)
    return { ...state, containers: next }
}
