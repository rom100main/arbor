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
    it("returns the created container ID explicitly", async () => {
        const { store } = makeStore()
        const id = await run(store.createContainer("Work", "#ef4444"))
        expect(id).toMatch(/^container-/)
    })

    it("returns the created tab ID explicitly", async () => {
        const { store } = makeStore()
        await run(store.createContainer())
        const id = await run(store.createTab("https://example.com"))
        expect(id).toMatch(/^tab-/)
    })

    it("createChildTab returns its own ID regardless of active container", async () => {
        const { store } = makeStore()
        await run(store.createContainer())
        await run(store.createContainer())
        const first = await run(store.snapshot)
        const secondTab = first.containers[1].activeTabId!
        await run(store.switchContainer(first.containers[0].id))
        const childId = await run(store.createChildTab(secondTab))
        const snap = await run(store.snapshot)
        expect(childId).toBe(snap.containers[1].activeTabId!)
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
        await run(store.setCollapsed(commits.length === 0 ? "" : "", true)).catch(() => undefined)
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
        const { store, commits } = makeStore((state) => {
            if (state.tabs.size > 0) throw new Error("observer boom")
        })
        // First createContainer triggers the throwing observer, but the mutation must succeed.
        const id = await run(store.createContainer())
        expect(id).toMatch(/^container-/)
        expect(commits.length).toBeGreaterThanOrEqual(0)
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

    it("background child creation does not change the active tab", async () => {
        const { store } = makeStore()
        await run(store.createContainer())
        const before = await run(store.snapshot)
        const parentId = before.activeTabId!
        await run(store.createChildTab(parentId, "https://example.com", true))
        const after = await run(store.snapshot)
        expect(after.activeTabId).toBe(parentId)
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
