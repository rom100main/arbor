import { describe, expect, it } from "vite-plus/test"

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
import { newChild, newContainer, newTab, nextTabId, ok } from "./support/domain"

const buildRichState = (): DomainState => {
    let state = ok(
        createContainer(initialState(), newContainer({ name: "Work", color: "#ef4444" })),
    )
    const rootA = state.containers[0].activeTabId!
    const child = nextTabId()
    state = ok(
        createChildTab(state, rootA, newChild({ id: child, url: "https://example.com/child" })),
    )
    state = ok(setCollapsed(state, rootA, true))
    state = ok(renameTab(state, child, "My label"))
    state = ok(createTab(state, newTab({ url: "https://example.org" })))
    state = ok(createContainer(state, newContainer({ name: "Personal", color: "#22c55e" })))
    state = ok(switchContainer(state, state.containers[0].id, 0))
    state = ok(selectTab(state, rootA, 0))
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

    it("round-trips extensionConsent", () => {
        let state = buildRichState()
        state = ok(
            setExtensionConsent(state, "ext-aaa", {
                permissions: ["storage"],
                origins: ["https://example.com/*"],
            }),
        )
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

    it("drops records whose id lacks its prefix", () => {
        const state = buildRichState()
        const persisted = clonePersisted(state)
        // A leaf tab, so dropping it orphans nothing else.
        const leaf = persisted.tabs.find((t) => !persisted.tabs.some((o) => o.parentId === t.id))!
        const data = {
            ...persisted,
            tabs: persisted.tabs.map((t) => (t.id === leaf.id ? { ...t, id: "abc" } : t)),
            containers: [...persisted.containers, { id: "abc", name: "Bare", color: "#000000" }],
        }
        const restored = fromPersisted(data)!
        expect([...restored.tabs.keys()]).not.toContain("abc")
        expect(restored.tabs.size).toBe(state.tabs.size - 1)
        expect(restored.containers.map((c) => c.id)).not.toContain("abc")
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
        data.tabs = data.tabs.map((tab) => ({ ...tab, order: 42 }))
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
        data.containers = data.containers.map((c) => ({ ...c, activeTabId: "tab-gone" }))
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
