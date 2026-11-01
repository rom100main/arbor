import { Deferred, Effect, Exit, Stream, type Scope } from "effect"
import { TestClock } from "effect/testing"
import { describe, expect, it } from "vite-plus/test"

import { initialState, type DomainState } from "../src/main/state/state"
import { BrowserStore, type StoreService } from "../src/main/state/store"
import { LastTab } from "../src/shared/errors"
import { runTest, settle } from "./support/effect"

const makeStore = (initial: DomainState = initialState()) =>
    Effect.gen(function* () {
        return yield* BrowserStore
    }).pipe(Effect.provide(BrowserStore.layer(initial)))

/** Every change published after the call, collected by a consumer fiber like the app's. */
const collectChanges = (store: StoreService): Effect.Effect<DomainState[], never, Scope.Scope> =>
    Effect.gen(function* () {
        const changes: DomainState[] = []
        const subscribed = yield* Deferred.make<void>()
        yield* store.changes.pipe(
            Stream.tap(() => Deferred.succeed(subscribed, undefined)),
            // The first emission is the state at subscription, not a change.
            Stream.drop(1),
            Stream.runForEach((state) => Effect.sync(() => changes.push(state))),
            Effect.forkScoped,
        )
        yield* Deferred.await(subscribed)
        return changes
    })

const scopedTest = <A, E>(effect: Effect.Effect<A, E, Scope.Scope | TestClock.TestClock>) =>
    runTest(Effect.scoped(effect))

describe("store transitions", () => {
    it("creators return the IDs of the entities they created", () =>
        scopedTest(
            Effect.gen(function* () {
                const store = yield* makeStore()
                const containerId = yield* store.createContainer("Work", "#ef4444")
                const tabId = yield* store.createTab("https://example.com")
                const childId = yield* store.createChildTab(tabId, "https://example.com/x")
                const snap = yield* store.snapshot
                expect(snap.containers.map((c) => c.id)).toContain(containerId)
                const tabIds = new Set(snap.tabs.map((t) => t.id))
                expect(tabIds.has(tabId)).toBe(true)
                expect(tabIds.has(childId)).toBe(true)
            }),
        ))

    it("a domain failure is a typed failure, leaves state unchanged and publishes nothing", () =>
        scopedTest(
            Effect.gen(function* () {
                const store = yield* makeStore()
                yield* store.createContainer()
                const before = yield* store.state
                const tabId = (yield* store.snapshot).activeTabId!
                const changes = yield* collectChanges(store)

                const exit = yield* Effect.exit(store.closeTab(tabId))
                yield* settle

                // A failure, not a defect: the error channel carries the tag.
                expect(Exit.isFailure(exit) && Exit.hasFails(exit)).toBe(true)
                const error = yield* Effect.flip(store.closeTab(tabId))
                expect(error).toBeInstanceOf(LastTab)
                expect(yield* store.state).toBe(before)
                expect(changes).toHaveLength(0)
            }),
        ))

    it("a changed state publishes once; a no-op publishes nothing", () =>
        scopedTest(
            Effect.gen(function* () {
                const store = yield* makeStore()
                yield* store.createContainer()
                const tabId = (yield* store.snapshot).activeTabId!
                const changes = yield* collectChanges(store)

                yield* store.setCollapsed(tabId, false) // already false: a no-op
                yield* settle
                expect(changes).toHaveLength(0)

                yield* store.setCollapsed(tabId, true)
                yield* settle
                expect(changes).toHaveLength(1)
            }),
        ))

    it("updateTabMeta with unchanged metadata does not publish", () =>
        scopedTest(
            Effect.gen(function* () {
                const store = yield* makeStore()
                yield* store.createContainer()
                const snap = yield* store.snapshot
                const tab = snap.tabs.find((t) => t.id === snap.activeTabId)!
                const changes = yield* collectChanges(store)

                yield* store.updateTabMeta(tab.id, { title: tab.title, url: tab.url })
                yield* settle
                expect(changes).toHaveLength(0)
            }),
        ))

    it("a failing consumer cannot fail a mutation", () =>
        scopedTest(
            Effect.gen(function* () {
                const store = yield* makeStore()
                yield* store.changes.pipe(
                    Stream.drop(1),
                    Stream.runForEach(() => Effect.die(new Error("observer boom"))),
                    Effect.forkScoped,
                )
                const id = yield* store.createContainer()
                yield* settle
                const snap = yield* store.snapshot
                expect(snap.containers.map((c) => c.id)).toContain(id)
            }),
        ))

    it("stamps lastActiveAt with the clock's time", () =>
        scopedTest(
            Effect.gen(function* () {
                const store = yield* makeStore()
                yield* store.createContainer()
                const first = (yield* store.snapshot).activeTabId!
                yield* store.createTab()

                yield* TestClock.setTime(1_234_567)
                yield* store.selectTab(first)

                const tab = (yield* store.state).tabs.get(first)!
                expect(tab.lastActiveAt).toBe(1_234_567)
            }),
        ))

    it("concurrent mutations retain all successful updates", () =>
        scopedTest(
            Effect.gen(function* () {
                const store = yield* makeStore()
                yield* store.createContainer()
                const results = yield* Effect.all(
                    [
                        store.createTab("https://a.test"),
                        store.createTab("https://b.test"),
                        store.createTab("https://c.test"),
                    ],
                    { concurrency: "unbounded" },
                )
                expect(new Set(results).size).toBe(3)
                const snap = yield* store.snapshot
                expect(snap.tabs.length).toBe(4) // 1 initial + 3 created
            }),
        ))
})
