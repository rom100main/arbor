import { Result } from "effect"

import { NoContainer } from "../../shared/errors"
import type { ContainerId, TabId, TabNode } from "../../shared/protocol"
import {
    childrenOf,
    containerOf,
    putTab,
    reindex,
    siblingsOf,
    tabOf,
    touch,
    withTabs,
    type DomainState,
} from "./state"

export interface CreateTabOptions {
    id: TabId
    now: number
    containerId?: ContainerId
    url?: string
}

export interface CreateChildTabOptions {
    id: TabId
    now: number
    url?: string
    /** Background opens must not steal focus from the originating tab. */
    background?: boolean
}

export interface TabMeta {
    title?: string
    url?: string
    favicon?: string | null
}

export const createTab = (state: DomainState, options: CreateTabOptions) =>
    Result.gen(function* () {
        if (state.containers.length === 0) return yield* Result.fail(new NoContainer())
        const { id, now } = options
        const containerId = options.containerId ?? state.activeContainerId ?? state.containers[0].id
        const container = yield* containerOf(state, containerId)
        const anchor =
            container.activeTabId !== null ? state.tabs.get(container.activeTabId) : undefined

        const base: TabNode = {
            id,
            containerId,
            parentId: null,
            order: 0,
            url: options.url ?? "about:blank",
            title: "",
            collapsed: false,
            userLabel: null,
            favicon: null,
            lastActiveAt: now,
        }

        let next = withTabs(state, new Map(state.tabs))
        let tab = base
        if (anchor) {
            tab = { ...base, parentId: anchor.parentId }
            const siblings = siblingsOf(state, anchor)
            const index = siblings.findIndex((s) => s.id === anchor.id)
            siblings.splice(index + 1, 0, tab)
            for (const updated of reindex(siblings)) next.tabs.set(updated.id, updated)
        } else {
            const roots = childrenOf(state, containerId, null)
            tab = { ...base, order: roots.length }
            next.tabs.set(tab.id, tab)
        }

        next = {
            ...next,
            containers: next.containers.map((c) =>
                c.id === containerId ? { ...c, activeTabId: tab.id } : c,
            ),
            activeContainerId: containerId,
        }
        return next
    })

/** Tab opened by a link (ctrl+click, target=_blank): last child of the parent. */
export const createChildTab = (
    state: DomainState,
    parentTabId: TabId,
    options: CreateChildTabOptions,
) =>
    Result.gen(function* () {
        const parent = yield* tabOf(state, parentTabId)
        const tab: TabNode = {
            id: options.id,
            containerId: parent.containerId,
            parentId: parent.id,
            order: 0,
            url: options.url ?? "about:blank",
            title: "",
            collapsed: false,
            userLabel: null,
            favicon: null,
            lastActiveAt: options.now,
        }
        const next = withTabs(state, new Map(state.tabs))
        const siblings = childrenOf(state, parent.containerId, parent.id)
        siblings.push(tab)
        for (const updated of reindex(siblings)) next.tabs.set(updated.id, updated)
        if (options.background) return next
        return {
            ...next,
            activeContainerId: parent.containerId,
            containers: next.containers.map((c) =>
                c.id === parent.containerId ? { ...c, activeTabId: tab.id } : c,
            ),
        }
    })

export const selectTab = (state: DomainState, tabId: TabId, now: number) =>
    Result.gen(function* () {
        const tab = yield* tabOf(state, tabId)
        const next = putTab(state, touch(tab, now))
        return {
            ...next,
            activeContainerId: tab.containerId,
            containers: next.containers.map((c) =>
                c.id === tab.containerId ? { ...c, activeTabId: tab.id } : c,
            ),
        }
    })

export const setCollapsed = (state: DomainState, tabId: TabId, collapsed: boolean) =>
    Result.gen(function* () {
        const tab = yield* tabOf(state, tabId)
        if (tab.collapsed === collapsed) return state
        return putTab(state, { ...tab, collapsed })
    })

/** Custom label overriding the page title until cleared. */
export const renameTab = (state: DomainState, tabId: TabId, label: string | null) =>
    Result.gen(function* () {
        const tab = yield* tabOf(state, tabId)
        return putTab(state, { ...tab, userLabel: label && label.length > 0 ? label : null })
    })

export const updateTabMeta = (
    state: DomainState,
    tabId: TabId,
    meta: TabMeta,
): Result.Result<DomainState> => {
    const tab = state.tabs.get(tabId)
    if (!tab) return Result.succeed(state) // tab deleted during update
    const title = meta.title ?? tab.title
    const url = meta.url ?? tab.url
    const favicon = meta.favicon !== undefined ? meta.favicon : tab.favicon
    if (title === tab.title && url === tab.url && favicon === tab.favicon) {
        return Result.succeed(state)
    }
    return Result.succeed(putTab(state, { ...tab, title, url, favicon }))
}
