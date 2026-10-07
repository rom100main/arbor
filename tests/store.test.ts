import { Effect } from "effect"
import { describe, expect, it } from "vite-plus/test"

import { createContainer } from "../src/main/state/containers"
import { initialState, type DomainState } from "../src/main/state/state"
import { BrowserStore, makeStoreLayer } from "../src/main/state/store"

const makeStore = (onCommit?: (state: DomainState) => void) => {
    const commits: DomainState[] = []
    const track = (state: DomainState): void => {
        commits.push(state)
        onCommit?.(state)
    }
    const layer = makeStoreLayer(initialState(), track)
    const store = Effect.runSync(
        Effect.gen(function* () {
            return yield* BrowserStore
        }).pipe(Effect.provide(layer)),
    )
    return { store, commits }
}

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)

describe("store transitions", () => {
    it("creators return the IDs of the entities they created", async () => {
        const { store } = makeStore()
        const containerId = await run(store.createContainer("Work", "#ef4444"))
        const tabId = await run(store.createTab("https://example.com"))
        const childId = await run(store.createChildTab(tabId, "https://example.com/x"))
        const snap = await run(store.snapshot)
        expect(snap.containers.map((c) => c.id)).toContain(containerId)
        const tabIds = new Set(snap.tabs.map((t) => t.id))
        expect(tabIds.has(tabId)).toBe(true)
        expect(tabIds.has(childId)).toBe(true)
    })

    it("domain failure leaves state unchanged and publishes zero times", async () => {
        const { store, commits } = makeStore()
        await run(store.createContainer())
        commits.length = 0
        await expect(run(store.closeTab("tab-missing"))).rejects.toThrow()
        expect(commits).toHaveLength(0)
    })

    it("a changed state publishes once; a no-op publishes zero times", async () => {
        const { store, commits } = makeStore()
        await run(store.createContainer())
        commits.length = 0
        // setCollapsed on a real tab with the same value is a no-op.
        const snap = await run(store.snapshot)
        const tabId = snap.activeTabId!
        await run(store.setCollapsed(tabId, false)) // already false → no-op
        expect(commits).toHaveLength(0)
        await run(store.setCollapsed(tabId, true))
        expect(commits).toHaveLength(1)
    })

    it("updateTabMeta with unchanged metadata does not publish", async () => {
        const { store, commits } = makeStore()
        await run(store.createContainer())
        const snap = await run(store.snapshot)
        const tabId = snap.activeTabId!
        const tab = snap.tabs.find((t) => t.id === tabId)!
        commits.length = 0
        await run(store.updateTabMeta(tabId, { title: tab.title, url: tab.url }))
        expect(commits).toHaveLength(0)
    })

    it("post-commit observer failure does not fail the mutation", async () => {
        const { store } = makeStore((state) => {
            if (state.tabs.size > 0) throw new Error("observer boom")
        })
        // First createContainer triggers the throwing observer, but the mutation must succeed.
        const id = await run(store.createContainer())
        const snap = await run(store.snapshot)
        expect(snap.containers.map((c) => c.id)).toContain(id)
    })

    it("concurrent mutations retain all successful updates", async () => {
        const { store } = makeStore()
        await run(store.createContainer())
        const results = await Promise.all([
            run(store.createTab("https://a.test")),
            run(store.createTab("https://b.test")),
            run(store.createTab("https://c.test")),
        ])
        expect(results).toHaveLength(3)
        expect(new Set(results).size).toBe(3)
        const snap = await run(store.snapshot)
        expect(snap.tabs.length).toBe(4) // 1 initial + 3 created
    })
})

describe("store with pre-built state", () => {
    it("starts from the provided initial state", async () => {
        const seeded = createContainer(initialState()).state
        const commits: DomainState[] = []
        const layer = makeStoreLayer(seeded, (s) => commits.push(s))
        const store = Effect.runSync(
            Effect.gen(function* () {
                return yield* BrowserStore
            }).pipe(Effect.provide(layer)),
        )
        const snap = await run(store.snapshot)
        expect(snap.containers).toHaveLength(1)
    })
})
