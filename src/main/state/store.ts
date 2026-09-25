import { Context, Data, Effect, Layer, Ref } from "effect"

import type { BrowserSnapshot, ContainerIcon, ContainerId, TabId } from "../../shared/protocol"
import { closeTab, reopenTab } from "./close-reopen"
import {
    createContainer,
    renameContainer,
    reorderContainer,
    setContainerColor,
    setContainerIcon,
    switchContainer,
} from "./containers"
import { moveTab, moveToContainer, type MoveTabOptions } from "./moves"
import { snapshot, type DomainState } from "./state"
import { createChildTab, createTab, renameTab, selectTab, setCollapsed } from "./tabs"

export class DomainError extends Data.TaggedError("DomainError")<{ message: string }> {}

export interface StoreService {
    readonly snapshot: Effect.Effect<BrowserSnapshot>
    readonly createContainer: (
        name?: string,
        color?: string,
    ) => Effect.Effect<ContainerId, DomainError>
    readonly switchContainer: (containerId: ContainerId) => Effect.Effect<void, DomainError>
    readonly renameContainer: (
        containerId: ContainerId,
        name: string,
    ) => Effect.Effect<void, DomainError>
    readonly setContainerColor: (
        containerId: ContainerId,
        color: string,
    ) => Effect.Effect<void, DomainError>
    readonly setContainerIcon: (
        containerId: ContainerId,
        icon: ContainerIcon,
    ) => Effect.Effect<void, DomainError>
    readonly reorderContainer: (
        containerId: ContainerId,
        toIndex: number,
    ) => Effect.Effect<void, DomainError>
    readonly createTab: (url?: string) => Effect.Effect<TabId, DomainError>
    readonly createChildTab: (parentTabId: TabId, url?: string) => Effect.Effect<TabId, DomainError>
    readonly selectTab: (tabId: TabId) => Effect.Effect<void, DomainError>
    readonly setCollapsed: (tabId: TabId, collapsed: boolean) => Effect.Effect<void, DomainError>
    readonly renameTab: (tabId: TabId, label: string | null) => Effect.Effect<void, DomainError>
    readonly closeTab: (tabId: TabId) => Effect.Effect<void, DomainError>
    readonly reopenTab: () => Effect.Effect<void, DomainError>
    readonly moveTab: (options: MoveTabOptions) => Effect.Effect<void, DomainError>
    readonly moveToContainer: (
        tabId: TabId,
        containerId: ContainerId,
    ) => Effect.Effect<void, DomainError>
    readonly updateTabMeta: (
        tabId: TabId,
        meta: { title?: string; url?: string; favicon?: string | null },
    ) => Effect.Effect<void>
}

export class BrowserStore extends Context.Tag("arbor.BrowserStore")<BrowserStore, StoreService>() {}

export const makeStoreLayer = (
    initial: DomainState,
    onCommit: (state: DomainState) => void,
): Layer.Layer<BrowserStore> =>
    Layer.effect(
        BrowserStore,
        Effect.gen(function* () {
            const ref = yield* Ref.make(initial)

            const run = <A>(
                op: (state: DomainState) => DomainState,
                pick: (next: DomainState) => A,
            ): Effect.Effect<A, DomainError> =>
                Effect.gen(function* () {
                    const state = yield* Ref.get(ref)
                    const next = yield* Effect.try({
                        try: () => op(state),
                        catch: (error) =>
                            new DomainError({
                                message: error instanceof Error ? error.message : String(error),
                            }),
                    })
                    yield* Ref.set(ref, next)
                    onCommit(next)
                    return pick(next)
                })

            const runVoid = (op: (state: DomainState) => DomainState) =>
                run<void>(op, () => undefined)

            const activeTabOf = (next: DomainState): TabId =>
                next.containers.find((c) => c.id === next.activeContainerId)!.activeTabId!

            const service: StoreService = {
                snapshot: Effect.map(Ref.get(ref), snapshot),
                createContainer: (name, color) =>
                    run<ContainerId>(
                        (state) => createContainer(state, name, color),
                        (next) => next.containers[next.containers.length - 1].id,
                    ),
                switchContainer: (containerId) =>
                    runVoid((state) => switchContainer(state, containerId)),
                renameContainer: (containerId, name) =>
                    runVoid((state) => renameContainer(state, containerId, name)),
                setContainerColor: (containerId, color) =>
                    runVoid((state) => setContainerColor(state, containerId, color)),
                setContainerIcon: (containerId, icon) =>
                    runVoid((state) => setContainerIcon(state, containerId, icon)),
                reorderContainer: (containerId, toIndex) =>
                    runVoid((state) => reorderContainer(state, containerId, toIndex)),
                createTab: (url) => run<TabId>((state) => createTab(state, { url }), activeTabOf),
                createChildTab: (parentTabId, url) =>
                    run<TabId>((state) => createChildTab(state, parentTabId, url), activeTabOf),
                selectTab: (tabId) => runVoid((state) => selectTab(state, tabId)),
                setCollapsed: (tabId, collapsed) =>
                    runVoid((state) => setCollapsed(state, tabId, collapsed)),
                renameTab: (tabId, label) => runVoid((state) => renameTab(state, tabId, label)),
                closeTab: (tabId) => runVoid((state) => closeTab(state, tabId)),
                reopenTab: () => runVoid((state) => reopenTab(state)),
                moveTab: (options) => runVoid((state) => moveTab(state, options)),
                moveToContainer: (tabId, containerId) =>
                    runVoid((state) => moveToContainer(state, tabId, containerId)),
                updateTabMeta: (tabId, meta) =>
                    Effect.gen(function* () {
                        const state = yield* Ref.get(ref)
                        const tab = state.tabs.get(tabId)
                        if (!tab) return
                        const next: DomainState = {
                            ...state,
                            tabs: new Map(state.tabs),
                        }
                        next.tabs.set(tabId, {
                            ...tab,
                            title: meta.title ?? tab.title,
                            url: meta.url ?? tab.url,
                            favicon: meta.favicon !== undefined ? meta.favicon : tab.favicon,
                        })
                        yield* Ref.set(ref, next)
                        onCommit(next)
                    }),
            }

            return service
        }),
    )
