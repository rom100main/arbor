/**
 * The WindowManager module: opens the main window and keeps it showing the store's state.
 * Behind it: tab views, navigation, overlays, the menu and the window's IPC.
 *
 * One window per run: it opens at startup, and closing it ends `start`, which quits the app.
 */

import { Context, Effect, FiberSet, Layer, Semaphore, Stream } from "effect"

import { UnknownTab } from "../../shared/errors"
import type { TabId, TabNode } from "../../shared/protocol"
import { stepVisibleTab } from "../../shared/tree-display"
import { Extensions } from "../extension/extensions"
import { PermissionPrompts } from "../extension/prompts"
import { IpcPush, serveEvents, serveRequests } from "../ipc/router"
import { windowEvents, windowRequests, type WindowContext } from "../ipc/window-channels"
import { SettingsStore } from "../settings"
import { snapshot, type DomainState } from "../state/state"
import { BrowserStore } from "../state/store"
import type { TabMeta } from "../state/tabs"
import { Updater } from "../update/updater"
import { CurrentWindow } from "./current-window"
import { makeWindowHost } from "./electron-host"
import {
    sameSessionKey,
    sessionKeyFor,
    type HistoryStep,
    type MenuAction,
    type ViewEvent,
    type ViewHandle,
} from "./host"
import { menuModel, sameMenuModel } from "./menu"

export interface WindowManagerService {
    /** Open the main window and run it. Completes when the user closes it: the app then quits. */
    readonly start: Effect.Effect<void>
}

/** What a page event changes in its tab. */
const metaFrom = (event: Exclude<ViewEvent, { kind: "openChild" }>): TabMeta =>
    event.kind === "title"
        ? { title: event.title }
        : event.kind === "navigated"
          ? { url: event.url, title: "", favicon: null }
          : event.kind === "navigatedInPage"
            ? { url: event.url }
            : { favicon: event.favicon }

export class WindowManager extends Context.Service<WindowManager, WindowManagerService>()(
    "arbor.WindowManager",
) {
    static readonly layer = Layer.effect(
        WindowManager,
        Effect.gen(function* () {
            const store = yield* BrowserStore
            const settings = yield* SettingsStore
            const pushes = yield* IpcPush
            const host = yield* makeWindowHost
            const prompts = yield* PermissionPrompts
            const extensions = yield* Extensions
            const currentWindow = yield* CurrentWindow
            const updater = yield* Updater

            const logged = (label: string) => (effect: Effect.Effect<unknown, unknown>) =>
                effect.pipe(
                    Effect.asVoid,
                    Effect.catchCause((cause) => Effect.logDebug(label, cause)),
                )

            /** A fresh profile gets one Container. */
            const seedIfEmpty = Effect.gen(function* () {
                if ((yield* store.state).containers.length > 0) return
                yield* store.createContainer().pipe(Effect.ignore)
            })

            const runWindow = Effect.gen(function* () {
                const handle = yield* host.open
                const scope = yield* Effect.scope
                const run = yield* FiberSet.makeRuntime()
                const background = (effect: Effect.Effect<unknown, unknown>): void => {
                    run(logged("Window task failed")(effect))
                }

                const { overlays } = handle

                const views = new Map<TabId, ViewHandle>()
                let shown: TabId | null = null
                // Views change from the store's changes and from `ensureTabView`, one at a time.
                const lock = yield* Semaphore.make(1)

                const loadInBackground = (view: ViewHandle, url: string) =>
                    Effect.forkIn(
                        handle
                            .load(view, url)
                            .pipe(
                                Effect.catchTag("LoadFailed", (error) =>
                                    Effect.logDebug(
                                        `Load failed url=${error.url} errno=${error.errno}`,
                                    ),
                                ),
                            ),
                        scope,
                    )

                const viewFor = (tab: TabNode) =>
                    Effect.gen(function* () {
                        const existing = views.get(tab.id)
                        if (existing) return existing
                        const view = yield* handle.createView(tab.id, sessionKeyFor(tab))
                        views.set(tab.id, view)
                        yield* loadInBackground(view, tab.url)
                        return view
                    })

                /**
                 * One rule per state, with no diffing:
                 * close the views that no longer fit their tab, show the active tab, push the state.
                 */
                const reconcile = (state: DomainState) =>
                    Effect.gen(function* () {
                        for (const [tabId, view] of views) {
                            const tab = state.tabs.get(tabId)
                            // A tab moved to another Container,
                            // or into or out of `arbor://`, needs a view on another session.
                            if (tab && sameSessionKey(view.sessionKey, sessionKeyFor(tab))) continue
                            views.delete(tabId)
                            if (shown === tabId) shown = null
                            yield* handle.close(view)
                        }
                        const next = snapshot(state)
                        const active = next.activeTabId
                            ? state.tabs.get(next.activeTabId)
                            : undefined
                        if (active && shown !== active.id) {
                            yield* handle.show(yield* viewFor(active))
                            shown = active.id
                        }
                        yield* pushes.push("state", next)
                    }).pipe(Semaphore.withPermit(lock))

                const navigate = (tabId: TabId, url: string) =>
                    Effect.gen(function* () {
                        const tab = (yield* store.state).tabs.get(tabId)
                        if (!tab) return
                        // Decided before recording the URL:
                        // another session means another view, which reconciliation creates and loads.
                        const sameView = sameSessionKey(
                            sessionKeyFor(tab),
                            sessionKeyFor({ containerId: tab.containerId, url }),
                        )
                        yield* store.updateTabMeta(tabId, { url })
                        const view = views.get(tabId)
                        if (sameView && view) yield* loadInBackground(view, url)
                    })

                const applyViewEvent = (event: ViewEvent) => {
                    if (event.kind === "openChild") {
                        return logged("Child tab failed")(
                            store.createChildTab(event.tabId, event.url, event.background),
                        )
                    }
                    return store.updateTabMeta(event.tabId, metaFrom(event))
                }

                // --- menu

                const focusAddressBar = Effect.andThen(
                    handle.focusShell,
                    pushes.push("focusOmnibox"),
                )

                const historyStep = (step: HistoryStep) =>
                    Effect.gen(function* () {
                        const { activeTabId } = snapshot(yield* store.state)
                        const view = activeTabId ? views.get(activeTabId) : undefined
                        if (view) yield* handle.history(view, step)
                    })

                const menuAction = (action: MenuAction): Effect.Effect<void> =>
                    Effect.flatMap(store.state, (state) => {
                        const { activeContainerId, activeTabId } = snapshot(state)
                        switch (action.kind) {
                            case "newTab":
                                return Effect.andThen(
                                    Effect.ignore(store.createTab()),
                                    focusAddressBar,
                                )
                            case "newContainer":
                                return Effect.ignore(store.createContainer())
                            case "focusAddressBar":
                                return focusAddressBar
                            case "closeTab":
                                return activeTabId
                                    ? Effect.ignore(store.closeTab(activeTabId))
                                    : Effect.void
                            case "reopenTab":
                                return Effect.ignore(store.reopenTab())
                            case "stepTab": {
                                const next =
                                    activeContainerId === null
                                        ? null
                                        : stepVisibleTab(
                                              state.tabs,
                                              activeContainerId,
                                              activeTabId,
                                              action.delta,
                                          )
                                return next === null
                                    ? Effect.void
                                    : Effect.ignore(store.selectTab(next))
                            }
                            case "switchContainer": {
                                const container = state.containers[action.index]
                                return container
                                    ? Effect.ignore(store.switchContainer(container.id))
                                    : Effect.void
                            }
                            // The last kind left: "history".
                            default:
                                return historyStep(action.step)
                        }
                    })

                /** Rebuilt only when what it shows changes: not on every title or favicon update. */
                const menu = store.changes.pipe(
                    Stream.map(menuModel),
                    Stream.changesWith(sameMenuModel),
                    Stream.runForEach((model) =>
                        host.setMenu(model, (action) => {
                            background(menuAction(action))
                        }),
                    ),
                )

                /** Every settings change goes to every renderer. */
                const broadcastSettings = settings.changes.pipe(
                    Stream.drop(1), // first emission already loaded
                    Stream.runForEach((next) => pushes.push("settings", next)),
                )

                // --- start

                const ctx: WindowContext = {
                    store,
                    settings,
                    pushes,
                    prompts,
                    extensions,
                    updater,
                    handle,
                    overlays,
                    viewOf: (tabId) => views.get(tabId),
                    navigate,
                    background,
                }
                yield* Effect.all([
                    serveRequests(windowRequests(ctx)),
                    serveEvents(windowEvents(ctx)),
                ])
                // After the channels: the shell asks for the snapshot and settings as it loads.
                // Before the tab views: a tab restored on `arbor://settings` that loads
                // while the dev server is still serving the shell gets ERR_FAILED on its assets.
                yield* handle.loadShell

                yield* handle.viewEvents.pipe(Stream.runForEach(applyViewEvent), Effect.forkScoped)
                // The first emission is the current state: the window renders it at once.
                yield* store.changes.pipe(
                    Stream.runForEach((state) =>
                        reconcile(state).pipe(
                            Effect.catchCause((cause) =>
                                Effect.logError("Window sync failed", cause),
                            ),
                        ),
                    ),
                    Effect.forkScoped,
                )
                yield* Effect.forkScoped(menu)
                yield* Effect.forkScoped(broadcastSettings)
                // A second launch of Arbor quits at once and brings this window forward.
                yield* host.relaunches.pipe(
                    Stream.runForEach(() => handle.focus),
                    Effect.forkScoped,
                )

                yield* currentWindow.opened({
                    native: handle.native,
                    overlays,
                    ensureTabView: (tabId) =>
                        Effect.gen(function* () {
                            const tab = (yield* store.state).tabs.get(tabId)
                            if (!tab) return yield* new UnknownTab({ tabId })
                            return yield* viewFor(tab)
                        }).pipe(Semaphore.withPermit(lock)),
                    tabIdFor: (webContents) => {
                        for (const [tabId, view] of views) {
                            if (view.webContents === webContents) return tabId
                        }
                        return null
                    },
                })
                yield* handle.closed
            }).pipe(Effect.scoped)

            return { start: Effect.andThen(seedIfEmpty, runWindow) }
        }),
    )
}
