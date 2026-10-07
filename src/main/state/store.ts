import { Context, Effect, Layer, Ref } from "effect"

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
    type CreateContainerOptions,
} from "./containers"
import { clearExtensionConsent, setExtensionConsent } from "./extension-state"
import { moveTab, moveToContainer, type MoveTabOptions } from "./moves"
import { DomainError, snapshot, type DomainState, type TransitionResult } from "./state"
import {
    createChildTab,
    createTab,
    renameTab,
    selectTab,
    setCollapsed,
    type CreateChildTabOptions,
    type CreateTabOptions,
} from "./tabs"

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
    readonly createChildTab: (
        parentTabId: TabId,
        url?: string,
        background?: boolean,
    ) => Effect.Effect<TabId, DomainError>
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
    ) => Effect.Effect<void, DomainError>
    readonly setExtensionConsent: (
        extensionId: string,
        grant: ExtensionGrant,
    ) => Effect.Effect<void, DomainError>
    readonly clearExtensionConsent: (extensionId: string) => Effect.Effect<void, DomainError>
    /** Consent ledger (install consent + runtime grants); deliberately not in the snapshot. */
    readonly extensionConsent: Effect.Effect<Record<string, ExtensionGrant>>
}

export class BrowserStore extends Context.Tag("arbor.BrowserStore")<BrowserStore, StoreService>() {}

type RunOutcome<A> =
    | { readonly tag: "ok"; readonly value: A; readonly next: DomainState }
    | { readonly tag: "noop"; readonly value: A }
    | { readonly tag: "fail"; readonly error: DomainError }
    | { readonly tag: "die"; readonly error: unknown }

export const makeStoreLayer = (
    initial: DomainState,
    onCommit: (state: DomainState) => void,
): Layer.Layer<BrowserStore> =>
    Layer.effect(
        BrowserStore,
        Effect.gen(function* () {
            const ref = yield* Ref.make(initial)

            /** Observe post-commit failures without pretending the mutation rolled back. */
            const notify = (next: DomainState): void => {
                try {
                    onCommit(next)
                } catch (error) {
                    console.error("Post-commit observer failed:", error)
                }
            }

            /** Atomic synchronous transition: domain failures leave state unchanged. */
            const commit = <A>(
                op: (state: DomainState) => DomainState | TransitionResult<A>,
                pick: (next: DomainState) => A,
            ): Effect.Effect<A, DomainError> =>
                Effect.gen(function* () {
                    const outcome = yield* Ref.modify(
                        ref,
                        (state): readonly [RunOutcome<A>, DomainState] => {
                            try {
                                const result = op(state)
                                if (isTransition(result)) {
                                    return [
                                        { tag: "ok", value: result.value, next: result.state },
                                        result.state,
                                    ]
                                }
                                if (result === state) {
                                    return [{ tag: "noop", value: pick(state) }, state]
                                }
                                return [{ tag: "ok", value: pick(result), next: result }, result]
                            } catch (error) {
                                if (error instanceof DomainError) {
                                    return [{ tag: "fail", error }, state]
                                }
                                return [{ tag: "die", error }, state]
                            }
                        },
                    )
                    if (outcome.tag === "fail") return yield* Effect.fail(outcome.error)
                    if (outcome.tag === "die") return yield* Effect.die(outcome.error)
                    if (outcome.tag === "ok") notify(outcome.next)
                    return outcome.value
                })

            const runVoid = (op: (state: DomainState) => DomainState) =>
                commit<void>(op, () => undefined)

            const now = (): number => Date.now()
            const tabId = (): TabId => `tab-${crypto.randomUUID()}`
            const containerId = (): ContainerId => `container-${crypto.randomUUID()}`

            const service: StoreService = {
                snapshot: Effect.map(Ref.get(ref), snapshot),
                createContainer: (name, color) => {
                    const id = containerId()
                    const ts = now()
                    return commit<ContainerId>(
                        (state) =>
                            createContainer(state, {
                                id,
                                now: ts,
                                name,
                                color,
                            } satisfies CreateContainerOptions),
                        () => id,
                    )
                },
                switchContainer: (id) => runVoid((state) => switchContainer(state, id, now())),
                renameContainer: (id, name) => runVoid((state) => renameContainer(state, id, name)),
                setContainerColor: (id, color) =>
                    runVoid((state) => setContainerColor(state, id, color)),
                setContainerIcon: (id, icon) =>
                    runVoid((state) => setContainerIcon(state, id, icon)),
                reorderContainer: (id, toIndex) =>
                    runVoid((state) => reorderContainer(state, id, toIndex)),
                createTab: (url) => {
                    const id = tabId()
                    const ts = now()
                    return commit<TabId>(
                        (state) =>
                            createTab(state, { id, now: ts, url } satisfies CreateTabOptions),
                        () => id,
                    )
                },
                createChildTab: (parentTabId, url, background) => {
                    const id = tabId()
                    const ts = now()
                    return commit<TabId>(
                        (state) =>
                            createChildTab(state, parentTabId, {
                                id,
                                now: ts,
                                url,
                                background,
                            } satisfies CreateChildTabOptions),
                        () => id,
                    )
                },
                selectTab: (id) => runVoid((state) => selectTab(state, id, now())),
                setCollapsed: (id, collapsed) =>
                    runVoid((state) => setCollapsed(state, id, collapsed)),
                renameTab: (id, label) => runVoid((state) => renameTab(state, id, label)),
                closeTab: (id) => runVoid((state) => closeTab(state, id, now())),
                reopenTab: () => runVoid((state) => reopenTab(state, now())),
                moveTab: (options) => runVoid((state) => moveTab(state, options)),
                moveToContainer: (tab, container) =>
                    runVoid((state) => moveToContainer(state, tab, container)),
                updateTabMeta: (id, meta) =>
                    runVoid((state) => {
                        const tab = state.tabs.get(id)
                        if (!tab) return state
                        const title = meta.title ?? tab.title
                        const url = meta.url ?? tab.url
                        const favicon = meta.favicon !== undefined ? meta.favicon : tab.favicon
                        if (title === tab.title && url === tab.url && favicon === tab.favicon) {
                            return state
                        }
                        const next: DomainState = { ...state, tabs: new Map(state.tabs) }
                        next.tabs.set(id, { ...tab, title, url, favicon })
                        return next
                    }),
                setExtensionConsent: (extensionId, grant) =>
                    runVoid((state) => setExtensionConsent(state, extensionId, grant)),
                clearExtensionConsent: (extensionId) =>
                    runVoid((state) => clearExtensionConsent(state, extensionId)),
                extensionConsent: Effect.map(Ref.get(ref), (state) => state.extensionConsent),
            }

            return service
        }),
    )

const isTransition = <A>(value: DomainState | TransitionResult<A>): value is TransitionResult<A> =>
    "state" in value && "value" in value
