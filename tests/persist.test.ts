import { describe, expect, it } from "vite-plus/test"

import { createDebouncedSaver } from "../src/main/persistence"
import { createContainer, switchContainer } from "../src/main/state/containers"
import { setExtensionConsent } from "../src/main/state/extension-state"
import { fromPersisted, PERSIST_VERSION, toPersisted } from "../src/main/state/persist"
import type { PersistedState } from "../src/main/state/persist"
import { initialState, type DomainState } from "../src/main/state/state"
import {
    createChildTab,
    createTab,
    renameTab,
    selectTab,
    setCollapsed,
} from "../src/main/state/tabs"
import type { ContainerMeta, TabNode } from "../src/shared/protocol"

const buildRichState = (): DomainState => {
    let state = createContainer(initialState(), { name: "Work", color: "#ef4444" }).state
    const rootA = state.containers[0].activeTabId!
    const childResult = createChildTab(state, rootA, { url: "https://example.com/child" })
    state = childResult.state
    const child = childResult.value
    state = setCollapsed(state, rootA, true)
    state = renameTab(state, child, "My label")
    state = createTab(state, { url: "https://example.org" }).state
    state = createContainer(state, { name: "Personal", color: "#22c55e" }).state
    state = switchContainer(state, state.containers[0].id)
    state = selectTab(state, rootA)
    return state
}

const clonePersisted = (state: DomainState): PersistedState => {
    const persisted = toPersisted(state)
    return {
        version: persisted.version,
        containers: persisted.containers.map((c) => ({ ...c })),
        tabs: persisted.tabs.map((t) => ({ ...t })),
        activeContainerId: persisted.activeContainerId,
        extensionConsent: Object.fromEntries(
            Object.entries(persisted.extensionConsent).map(([id, grant]) => [
                id,
                { permissions: [...grant.permissions], origins: [...grant.origins] },
            ]),
        ),
    }
}

const tabFixture = (overrides: Partial<TabNode> = {}): TabNode => ({
    id: "tab-a",
    containerId: "container-1",
    parentId: null,
    order: 0,
    url: "about:blank",
    title: "",
    collapsed: false,
    userLabel: null,
    favicon: null,
    lastActiveAt: 0,
    ...overrides,
})

const containerFixture = (overrides: Partial<ContainerMeta> = {}): ContainerMeta => ({
    id: "container-1",
    name: "C1",
    color: "#fff",
    icon: "world",
    activeTabId: null,
    ...overrides,
})

describe("persist round-trip", () => {
    it("keeps containers, trees, collapsed, labels, and actives", () => {
        const state = buildRichState()
        const restored = fromPersisted(toPersisted(state))
        expect(restored).not.toBeNull()
        expect(restored!.containers).toEqual(state.containers)
        expect(restored!.activeContainerId).toBe(state.activeContainerId)
        expect(restored!.closeHistory).toEqual([])
        expect([...restored!.tabs.values()].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
            [...state.tabs.values()].sort((a, b) => a.id.localeCompare(b.id)),
        )
    })

    it("preserves ids verbatim (container ids key session partitions)", () => {
        const state = buildRichState()
        const restored = fromPersisted(toPersisted(state))!
        expect(restored.containers.map((c) => c.id)).toEqual(state.containers.map((c) => c.id))
        expect([...restored.tabs.keys()].sort()).toEqual([...state.tabs.keys()].sort())
    })

    it("round-trips collapsed and userLabel", () => {
        const state = buildRichState()
        const restored = fromPersisted(toPersisted(state))!
        for (const tab of state.tabs.values()) {
            const copy = restored.tabs.get(tab.id)!
            expect(copy.collapsed).toBe(tab.collapsed)
            expect(copy.userLabel).toBe(tab.userLabel)
            expect(copy.parentId).toBe(tab.parentId)
        }
    })

    it("round-trips extensionConsent", () => {
        let state = buildRichState()
        state = setExtensionConsent(state, "ext-aaa", {
            permissions: ["storage"],
            origins: ["https://example.com/*"],
        })
        const restored = fromPersisted(toPersisted(state))!
        expect(restored.extensionConsent).toEqual({
            "ext-aaa": { permissions: ["storage"], origins: ["https://example.com/*"] },
        })
    })

    it("defaults extensionConsent on legacy payloads", () => {
        const data = clonePersisted(buildRichState())
        delete (data as Partial<PersistedState>).extensionConsent
        const restored = fromPersisted(data)!
        expect(restored.extensionConsent).toEqual({})
    })

    it("drops malformed consent entries", () => {
        const data = clonePersisted(buildRichState())
        // A malformed record must not sink the whole payload (as on disk).
        const restored = fromPersisted({
            ...data,
            extensionConsent: {
                "ext-keep": { permissions: ["storage"], origins: [] },
                "ext-bad": "nope",
                "": { permissions: [], origins: [] },
            },
        })!
        expect(restored.extensionConsent).toEqual({
            "ext-keep": { permissions: ["storage"], origins: [] },
        })
    })
})

describe("persist repair", () => {
    it("drops tabs whose container is missing", () => {
        const data = clonePersisted(buildRichState())
        data.containers = data.containers.slice(0, 1)
        const restored = fromPersisted(data)!
        expect(restored.containers).toHaveLength(1)
        for (const tab of restored.tabs.values()) {
            expect(tab.containerId).toBe(restored.containers[0].id)
        }
    })

    it("drops tabs whose parent is dangling and keeps the rest", () => {
        const data = clonePersisted(buildRichState())
        const before = data.tabs.length
        data.tabs = [...data.tabs, tabFixture({ id: "tab-orphan", parentId: "tab-missing" })]
        const restored = fromPersisted(data)!
        expect(restored.tabs.has("tab-orphan")).toBe(false)
        expect(restored.tabs.size).toBe(before)
    })

    it("drops parent-cycles", () => {
        const data = {
            version: PERSIST_VERSION,
            containers: [containerFixture({ activeTabId: "tab-a" })],
            tabs: [
                tabFixture({ id: "tab-a", parentId: "tab-b" }),
                tabFixture({ id: "tab-b", parentId: "tab-a" }),
            ],
            activeContainerId: "container-1",
        }
        expect(fromPersisted(data)).toBeNull()
    })

    it("reindexes sibling order", () => {
        const data = clonePersisted(buildRichState())
        for (const tab of data.tabs) tab.order = 42
        const restored = fromPersisted(data)!
        const byGroup = new Map<string, number[]>()
        for (const tab of restored.tabs.values()) {
            const key = `${tab.containerId}\0${tab.parentId ?? ""}`
            const bucket = byGroup.get(key)
            if (bucket) bucket.push(tab.order)
            else byGroup.set(key, [tab.order])
        }
        expect(byGroup.size).toBeGreaterThan(0)
        for (const orders of byGroup.values()) {
            expect([...orders].sort((a, b) => a - b)).toEqual(orders.map((_, i) => i))
        }
    })

    it("resets dangling activeTabId and activeContainerId", () => {
        const data = clonePersisted(buildRichState())
        for (const container of data.containers) container.activeTabId = "tab-gone"
        data.activeContainerId = "container-gone"
        const restored = fromPersisted(data)!
        expect(restored.containers[0].activeTabId).not.toBe("tab-gone")
        expect(restored.activeContainerId).toBe(restored.containers[0].id)
    })

    it("drops empty containers and rejects a file with none left", () => {
        const data = clonePersisted(buildRichState())
        data.tabs = []
        expect(fromPersisted(data)).toBeNull()
    })
})

describe("persist reject", () => {
    it("rejects non-objects, bad version, and bad shapes", () => {
        expect(fromPersisted(null)).toBeNull()
        expect(fromPersisted("nope")).toBeNull()
        expect(fromPersisted({ version: 99, containers: [], tabs: [] })).toBeNull()
        expect(fromPersisted({ version: PERSIST_VERSION })).toBeNull()
        expect(fromPersisted({ version: PERSIST_VERSION, containers: {}, tabs: [] })).toBeNull()
    })
})

describe("debounced saver", () => {
    const setup = () => {
        let now = 0
        let nextHandle = 1
        const timers = new Map<number, { fn: () => void; at: number }>()
        const writes: number[] = []
        const saver = createDebouncedSaver({
            write: () => writes.push(now),
            delayMs: 500,
            setTimer: (fn, ms) => {
                const handle = nextHandle
                nextHandle += 1
                timers.set(handle, { fn, at: now + ms })
                return handle
            },
            clearTimer: (handle) => {
                if (typeof handle === "number") timers.delete(handle)
            },
        })
        const tick = (ms: number) => {
            now += ms
            for (const [handle, timer] of [...timers]) {
                if (timer.at <= now) {
                    timers.delete(handle)
                    timer.fn()
                }
            }
        }
        return { saver, tick, writes, time: () => now }
    }

    it("coalesces bursts into one write", () => {
        const { saver, tick, writes } = setup()
        saver.schedule()
        tick(100)
        saver.schedule()
        tick(100)
        saver.schedule()
        expect(writes).toHaveLength(0)
        tick(500)
        expect(writes).toHaveLength(1)
    })

    it("flush writes immediately and clears the timer", () => {
        const { saver, tick, writes } = setup()
        saver.schedule()
        saver.flush()
        expect(writes).toHaveLength(1)
        tick(1000)
        expect(writes).toHaveLength(1)
    })

    it("flush without dirty state writes nothing", () => {
        const { saver, writes } = setup()
        saver.flush()
        expect(writes).toHaveLength(0)
    })
})
