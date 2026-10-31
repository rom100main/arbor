import { Clock, Context, Effect, Layer, Option, Result, SubscriptionRef, type Stream } from "effect"

import type {
    BrowserSnapshot,
    ContainerIcon,
    ContainerId,
    ExtensionGrant,
    TabId,
} from "../../shared/protocol"
import { closeTab, reopenTab } from "./close-reopen"
import {
    createContainer,
    renameContainer,
    reorderContainer,
    setContainerColor,
    setContainerIcon,
    switchContainer,
} from "./containers"
import { clearExtensionConsent, setExtensionConsent } from "./extension-state"
import { moveTab, moveToContainer, type MoveTabOptions } from "./moves"
import { snapshot, type DomainState } from "./state"
import {
    createChildTab,
    createTab,
    renameTab,
    selectTab,
    setCollapsed,
    updateTabMeta,
    type TabMeta,
} from "./tabs"

/** The precise failure union of an op, read off its `Result`. */
type OpError<Op> = Op extends (...args: never[]) => Result.Result<unknown, infer E> ? E : never

export interface StoreService {
    readonly state: Effect.Effect<DomainState>
    /** The current state on subscribe, then every effective change, once each. */
    readonly changes: Stream.Stream<DomainState>
    readonly snapshot: Effect.Effect<BrowserSnapshot>
    readonly createContainer: (
        name?: string,
        color?: string,
    ) => Effect.Effect<ContainerId, OpError<typeof createContainer>>
    readonly switchContainer: (
        containerId: ContainerId,
    ) => Effect.Effect<void, OpError<typeof switchContainer>>
    readonly renameContainer: (
        containerId: ContainerId,
        name: string,
    ) => Effect.Effect<void, OpError<typeof renameContainer>>
    readonly setContainerColor: (
        containerId: ContainerId,
        color: string,
    ) => Effect.Effect<void, OpError<typeof setContainerColor>>
    readonly setContainerIcon: (
        containerId: ContainerId,
        icon: ContainerIcon,
    ) => Effect.Effect<void, OpError<typeof setContainerIcon>>
    readonly reorderContainer: (
        containerId: ContainerId,
        toIndex: number,
    ) => Effect.Effect<void, OpError<typeof reorderContainer>>
    readonly createTab: (url?: string) => Effect.Effect<TabId, OpError<typeof createTab>>
    readonly createChildTab: (
        parentTabId: TabId,
        url?: string,
        background?: boolean,
    ) => Effect.Effect<TabId, OpError<typeof createChildTab>>
    readonly selectTab: (tabId: TabId) => Effect.Effect<void, OpError<typeof selectTab>>
    readonly setCollapsed: (
        tabId: TabId,
        collapsed: boolean,
    ) => Effect.Effect<void, OpError<typeof setCollapsed>>
    readonly renameTab: (
        tabId: TabId,
        label: string | null,
    ) => Effect.Effect<void, OpError<typeof renameTab>>
    readonly closeTab: (tabId: TabId) => Effect.Effect<void, OpError<typeof closeTab>>
    readonly reopenTab: () => Effect.Effect<void, OpError<typeof reopenTab>>
    readonly moveTab: (options: MoveTabOptions) => Effect.Effect<void, OpError<typeof moveTab>>
    readonly moveToContainer: (
        tabId: TabId,
        containerId: ContainerId,
    ) => Effect.Effect<void, OpError<typeof moveToContainer>>
    readonly updateTabMeta: (tabId: TabId, meta: TabMeta) => Effect.Effect<void>
    readonly setExtensionConsent: (
        extensionId: string,
        grant: ExtensionGrant,
    ) => Effect.Effect<void>
    readonly clearExtensionConsent: (extensionId: string) => Effect.Effect<void>
    /** Consent ledger (install consent + runtime grants); deliberately not in the snapshot. */
    readonly extensionConsent: Effect.Effect<Record<string, ExtensionGrant>>
}

const make = (initial: DomainState) =>
    Effect.gen(function* () {
        const ref = yield* SubscriptionRef.make(initial)

        /** Atomic: a failure or a no-op leaves the ref untouched and publishes nothing. */
        const commit = <E>(op: (state: DomainState) => Result.Result<DomainState, E>) =>
            SubscriptionRef.modifySome(ref, (state) => {
                const result = op(state)
                const next =
                    Result.isSuccess(result) && result.success !== state
                        ? Option.some(result.success)
                        : Option.none()
                return [result, next] as const
            }).pipe(Effect.flatMap(Effect.fromResult), Effect.asVoid)

        return BrowserStore.of({
            state: SubscriptionRef.get(ref),
            changes: SubscriptionRef.changes(ref),
            snapshot: Effect.map(SubscriptionRef.get(ref), snapshot),
            createContainer: Effect.fn("BrowserStore.createContainer")(function* (
                name?: string,
                color?: string,
            ) {
                const id: ContainerId = `container-${crypto.randomUUID()}`
                const tabId: TabId = `tab-${crypto.randomUUID()}`
                const now = yield* Clock.currentTimeMillis
                yield* commit((state) => createContainer(state, { id, tabId, now, name, color }))
                return id
            }),
            switchContainer: Effect.fn("BrowserStore.switchContainer")(function* (
                containerId: ContainerId,
            ) {
                const now = yield* Clock.currentTimeMillis
                yield* commit((state) => switchContainer(state, containerId, now))
            }),
            renameContainer: (containerId, name) =>
                commit((state) => renameContainer(state, containerId, name)),
            setContainerColor: (containerId, color) =>
                commit((state) => setContainerColor(state, containerId, color)),
            setContainerIcon: (containerId, icon) =>
                commit((state) => setContainerIcon(state, containerId, icon)),
            reorderContainer: (containerId, toIndex) =>
                commit((state) => reorderContainer(state, containerId, toIndex)),
            createTab: Effect.fn("BrowserStore.createTab")(function* (url?: string) {
                const id: TabId = `tab-${crypto.randomUUID()}`
                const now = yield* Clock.currentTimeMillis
                yield* commit((state) => createTab(state, { id, now, url }))
                return id
            }),
            createChildTab: Effect.fn("BrowserStore.createChildTab")(function* (
                parentTabId: TabId,
                url?: string,
                background?: boolean,
            ) {
                const id: TabId = `tab-${crypto.randomUUID()}`
                const now = yield* Clock.currentTimeMillis
                yield* commit((state) =>
                    createChildTab(state, parentTabId, { id, now, url, background }),
                )
                return id
            }),
            selectTab: Effect.fn("BrowserStore.selectTab")(function* (tabId: TabId) {
                const now = yield* Clock.currentTimeMillis
                yield* commit((state) => selectTab(state, tabId, now))
            }),
            setCollapsed: (tabId, collapsed) =>
                commit((state) => setCollapsed(state, tabId, collapsed)),
            renameTab: (tabId, label) => commit((state) => renameTab(state, tabId, label)),
            closeTab: Effect.fn("BrowserStore.closeTab")(function* (tabId: TabId) {
                const now = yield* Clock.currentTimeMillis
                yield* commit((state) => closeTab(state, tabId, now))
            }),
            reopenTab: Effect.fn("BrowserStore.reopenTab")(function* () {
                const now = yield* Clock.currentTimeMillis
                yield* commit((state) => reopenTab(state, now))
            }),
            moveTab: (options) => commit((state) => moveTab(state, options)),
            moveToContainer: (tabId, containerId) =>
                commit((state) => moveToContainer(state, tabId, containerId)),
            updateTabMeta: (tabId, meta) => commit((state) => updateTabMeta(state, tabId, meta)),
            setExtensionConsent: (extensionId, grant) =>
                commit((state) => setExtensionConsent(state, extensionId, grant)),
            clearExtensionConsent: (extensionId) =>
                commit((state) => clearExtensionConsent(state, extensionId)),
            extensionConsent: Effect.map(
                SubscriptionRef.get(ref),
                (state) => state.extensionConsent,
            ),
        })
    })

export class BrowserStore extends Context.Service<BrowserStore, StoreService>()(
    "arbor.BrowserStore",
) {
    static readonly layer = (initial: DomainState): Layer.Layer<BrowserStore> =>
        Layer.effect(BrowserStore, make(initial))
}
