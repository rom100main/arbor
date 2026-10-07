import { describe, expect, it } from "vite-plus/test"

import { closeTab, reopenTab } from "../src/main/state/close-reopen"
import { createContainer, setContainerIcon, switchContainer } from "../src/main/state/containers"
import { moveTab, moveToContainer } from "../src/main/state/moves"
import { DomainError, initialState } from "../src/main/state/state"
import { createChildTab, createTab, selectTab, setCollapsed } from "../src/main/state/tabs"
import { displayTabs, stepVisibleTab } from "../src/shared/tree-display"
import { omniboxTarget } from "../src/shared/url"

const containerIdOf = (state: { containers: { id: string }[] }, index = 0): string =>
    state.containers[index].id

const tabIds = (state: { tabs: Map<string, unknown> }): string[] => [...state.tabs.keys()]

describe("containers", () => {
    it("creates a container with an empty tab on top", () => {
        const state = createContainer(initialState()).state
        expect(state.containers).toHaveLength(1)
        expect(state.containers[0].name).toBe("Container 1")
        expect(state.tabs.size).toBe(1)
        expect(state.activeContainerId).toBe(containerIdOf(state))
    })

    it("auto-names containers skipping used names", () => {
        let state = createContainer(initialState()).state
        state = createContainer(state).state
        state = closeTab(state, state.containers[1].activeTabId!) // deletes Container 2
        state = createContainer(state).state
        expect(state.containers.map((c) => c.name)).toEqual(["Container 1", "Container 2"])
    })

    it("defaults the icon and can change it", () => {
        let state = createContainer(initialState()).state
        expect(state.containers[0].icon).toBe("world")
        state = setContainerIcon(state, state.containers[0].id, "briefcase")
        expect(state.containers[0].icon).toBe("briefcase")
    })

    it("refuses to close the last tab of the last container", () => {
        const state = createContainer(initialState()).state
        const tabId = state.containers[0].activeTabId!
        expect(() => closeTab(state, tabId)).toThrow(DomainError)
    })

    it("refuses to close a collapsed root holding every remaining tab", () => {
        let state = createContainer(initialState()).state
        const a = state.containers[0].activeTabId!
        state = createChildTab(state, a).state
        const b = state.containers[0].activeTabId!
        state = createChildTab(state, b).state
        state = setCollapsed(state, a, true)
        expect(() => closeTab(state, a)).toThrow(DomainError)
    })

    it("deletes a container when its last tab closes and switches to a neighbor", () => {
        let state = createContainer(initialState()).state
        state = createContainer(state).state
        const second = state.containers[1].id
        state = switchContainer(state, state.containers[0].id)
        state = closeTab(state, state.containers[0].activeTabId!)
        expect(state.containers.map((c) => c.id)).toEqual([second])
        expect(state.activeContainerId).toBe(second)
    })
})

describe("tab placement", () => {
    it("inserts manual tabs as sibling right after the active tab", () => {
        let state = createContainer(initialState()).state
        const first = state.containers[0].activeTabId!
        state = createTab(state).state
        const second = state.containers[0].activeTabId!
        expect(tabIds(state)).toHaveLength(2)
        const firstTab = state.tabs.get(first)!
        const secondTab = state.tabs.get(second)!
        expect(secondTab.parentId).toBe(firstTab.parentId)
        expect(secondTab.order).toBe(firstTab.order + 1)
    })

    it("creates link tabs as last child of their parent and selects them", () => {
        let state = createContainer(initialState()).state
        const parent = state.containers[0].activeTabId!
        const r1 = createChildTab(state, parent)
        state = r1.state
        expect(r1.value).toBe(state.containers[0].activeTabId!)
        expect(state.tabs.get(r1.value)!.parentId).toBe(parent)
        expect(state.tabs.get(r1.value)!.order).toBe(0)
        const r2 = createChildTab(state, parent)
        state = r2.state
        expect(state.tabs.get(r2.value)!.order).toBe(1)
    })

    it("createChildTab returns its own ID and updates activeContainerId", () => {
        let state = createContainer(initialState()).state
        state = createContainer(state).state
        const firstId = state.containers[0].id
        const secondId = state.containers[1].id
        state = switchContainer(state, firstId)
        // Create a child under a tab in the inactive second container.
        const secondTab = state.containers[1].activeTabId!
        const result = createChildTab(state, secondTab)
        state = result.state
        expect(result.value).toBe(state.containers.find((c) => c.id === secondId)!.activeTabId!)
        expect(state.activeContainerId).toBe(secondId)
    })

    it("background child creation does not steal focus", () => {
        let state = createContainer(initialState()).state
        const parent = state.containers[0].activeTabId!
        const before = state.containers[0].activeTabId!
        const result = createChildTab(state, parent, { background: true })
        state = result.state
        expect(result.value).not.toBe(before)
        expect(state.containers[0].activeTabId).toBe(before)
    })
})

describe("close semantics", () => {
    const buildTree = () => {
        let state = createContainer(initialState()).state
        const a = state.containers[0].activeTabId!
        const r1 = createChildTab(state, a)
        state = r1.state
        const b = r1.value
        const r2 = createChildTab(state, a)
        state = r2.state
        const c = r2.value
        const r3 = createChildTab(state, b)
        state = r3.state
        const d = r3.value
        return { state, a, b, c, d }
    }

    it("closing a collapsed tab removes its whole subtree", () => {
        const built = buildTree()
        let { state } = built
        const { a, b, d } = built
        state = setCollapsed(state, b, true)
        state = closeTab(state, b)
        expect(state.tabs.has(b)).toBe(false)
        expect(state.tabs.has(d)).toBe(false)
        expect(state.tabs.has(a)).toBe(true)
    })

    it("closing an expanded tab promotes direct children into its position", () => {
        const built = buildTree()
        let { state } = built
        const { a, b, c, d } = built
        state = closeTab(state, b)
        expect(state.tabs.has(b)).toBe(false)
        const promoted = state.tabs.get(d)!
        expect(promoted.parentId).toBe(a)
        const aChildren = [...state.tabs.values()]
            .filter((t) => t.parentId === a)
            .sort((x, y) => x.order - y.order)
        expect(aChildren.map((t) => t.id)).toEqual([d, c])
    })

    it("closing an expanded tab preserves grandchildren under their parent", () => {
        // A → B → C: closing A should make B a root and keep C under B.
        let state = createContainer(initialState()).state
        const a = state.containers[0].activeTabId!
        const rb = createChildTab(state, a)
        state = rb.state
        const b = rb.value
        const rc = createChildTab(state, b)
        state = rc.state
        const c = rc.value
        state = closeTab(state, a)
        expect(state.tabs.has(a)).toBe(false)
        expect(state.tabs.get(b)!.parentId).toBeNull()
        expect(state.tabs.get(c)!.parentId).toBe(b)
    })

    it("reopen restores a closed subtree at its original position", () => {
        const built = buildTree()
        let { state } = built
        const { a, b, c, d } = built
        state = closeTab(state, b)
        state = reopenTab(state)
        expect(state.tabs.has(b)).toBe(true)
        const reopened = state.tabs.get(b)!
        expect(reopened.parentId).toBe(a)
        const aChildren = [...state.tabs.values()]
            .filter((t) => t.parentId === a)
            .sort((x, y) => x.order - y.order)
            .map((t) => t.id)
        expect(aChildren).toEqual([b, c])
        expect(state.tabs.get(d)!.parentId).toBe(b)
        expect(state.containers[0].activeTabId).toBe(b)
    })

    it("reopen resurrects an auto-deleted container", () => {
        let state = createContainer(initialState()).state
        state = createContainer(state).state
        const firstTab = state.containers[0].activeTabId!
        state = closeTab(state, firstTab)
        expect(state.containers).toHaveLength(1)
        state = reopenTab(state)
        expect(state.containers).toHaveLength(2)
        expect(state.tabs.has(firstTab)).toBe(true)
        expect(state.activeContainerId).toBe(state.tabs.get(firstTab)!.containerId)
    })

    it("reopen falls back to a root when the original parent moved away", () => {
        let state = createContainer(initialState()).state
        const a = state.containers[0].activeTabId!
        // Add a sibling so the container survives the parent's departure.
        state = createTab(state).state
        const rc = createChildTab(state, a)
        state = rc.state
        const child = rc.value
        state = closeTab(state, child)
        // Move parent a to another container (original container survives).
        state = createContainer(state).state
        const target = state.containers[1].id
        state = moveToContainer(state, a, target)
        state = reopenTab(state)
        // The reopened child becomes a root in its original container (parent moved away).
        expect(state.tabs.get(child)!.parentId).toBeNull()
        expect(state.tabs.get(child)!.containerId).toBe(state.containers[0].id)
    })

    it("reopen falls back to a valid container when the original is gone", () => {
        let state = createContainer(initialState()).state
        const a = state.containers[0].activeTabId!
        const rc = createChildTab(state, a)
        state = rc.state
        const child = rc.value
        state = closeTab(state, child)
        // Move the only tab out so the original container auto-deletes.
        state = createContainer(state).state
        const target = state.containers[1].id
        state = moveToContainer(state, a, target)
        expect(state.containers).toHaveLength(1)
        state = reopenTab(state)
        expect(state.tabs.has(child)).toBe(true)
        // Restored into the surviving container (the original is gone).
        expect(state.tabs.get(child)!.containerId).toBe(target)
    })

    it("activates a sibling after closing the active tab", () => {
        let state = createContainer(initialState()).state
        state = createTab(state).state
        const second = state.containers[0].activeTabId!
        state = closeTab(state, second)
        expect(state.containers[0].activeTabId).not.toBeNull()
        expect(state.tabs.has(state.containers[0].activeTabId!)).toBe(true)
    })
})

describe("moves", () => {
    it("reorders tabs between parents", () => {
        let state = createContainer(initialState()).state
        const a = state.containers[0].activeTabId!
        state = createTab(state).state
        const b = state.containers[0].activeTabId!
        state = createChildTab(state, b).state
        const c = state.containers[0].activeTabId!
        state = moveTab(state, { tabId: c, parentId: a, index: 0 })
        expect(state.tabs.get(c)!.parentId).toBe(a)
        expect(state.tabs.get(c)!.order).toBe(0)
    })

    it("refuses to move a tab into its own subtree", () => {
        let state = createContainer(initialState()).state
        const a = state.containers[0].activeTabId!
        state = createChildTab(state, a).state
        const child = state.containers[0].activeTabId!
        state = createChildTab(state, child).state
        const grandchild = state.containers[0].activeTabId!
        expect(() => moveTab(state, { tabId: a, parentId: grandchild, index: 0 })).toThrow(
            DomainError,
        )
    })

    it("moves a tab and its subtree to another container as roots", () => {
        let state = createContainer(initialState()).state
        const a = state.containers[0].activeTabId!
        state = createChildTab(state, a).state
        const child = state.containers[0].activeTabId!
        state = createContainer(state).state
        const target = state.containers[1].id
        state = moveToContainer(state, a, target)
        expect(state.tabs.get(a)!.containerId).toBe(target)
        expect(state.tabs.get(a)!.parentId).toBeNull()
        expect(state.tabs.get(child)!.containerId).toBe(target)
        expect(state.tabs.get(child)!.parentId).toBe(a)
        expect(state.containers).toHaveLength(1)
        expect(state.activeContainerId).toBe(target)
    })

    it("repairs the source container active pointer on cross-container move", () => {
        let state = createContainer(initialState()).state
        state = createTab(state).state
        const movable = state.containers[0].activeTabId!
        state = createContainer(state).state
        const target = state.containers[1].id
        state = moveToContainer(state, movable, target)
        // Source container survives with the first tab; its activeTabId must not reference the moved tab.
        const source = state.containers.find((c) => c.id !== target)!
        expect(source.activeTabId).not.toBe(movable)
        expect(source.activeTabId).not.toBeNull()
        expect(state.tabs.get(source.activeTabId!)!.containerId).toBe(source.id)
    })
})

describe("display order", () => {
    it("renders depth-first and prunes collapsed subtrees", () => {
        let state = createContainer(initialState()).state
        const a = state.containers[0].activeTabId!
        state = createChildTab(state, a).state
        const b = state.containers[0].activeTabId!
        state = createTab(state).state
        const c = state.containers[0].activeTabId!
        state = createChildTab(state, b).state
        const d = state.containers[0].activeTabId!
        const containerId = state.containers[0].id

        expect(displayTabs([...state.tabs.values()], containerId).map((t) => t.id)).toEqual([
            a,
            b,
            d,
            c,
        ])

        state = setCollapsed(state, b, true)
        expect(displayTabs([...state.tabs.values()], containerId).map((t) => t.id)).toEqual([
            a,
            b,
            c,
        ])
    })
})

describe("omnibox", () => {
    it("keeps absolute URLs", () => {
        expect(omniboxTarget("https://example.com/x")).toBe("https://example.com/x")
    })

    it("upgrades bare hosts", () => {
        expect(omniboxTarget("example.com")).toBe("https://example.com")
        expect(omniboxTarget("example.com:8080/path")).toBe("https://example.com:8080/path")
    })

    it("searches DuckDuckGo otherwise", () => {
        expect(omniboxTarget("how to make a browser")).toBe(
            `https://duckduckgo.com/?q=${encodeURIComponent("how to make a browser")}`,
        )
    })
})

describe("recency", () => {
    it("new tabs are more recent than their parent", () => {
        let state = createContainer(initialState(), { now: 1000 }).state
        const a = state.containers[0].activeTabId!
        const r = createChildTab(state, a, { now: 2000 })
        state = r.state
        expect(state.tabs.get(r.value)!.lastActiveAt).toBe(2000)
        expect(state.tabs.get(a)!.lastActiveAt).toBe(1000)
    })

    it("selecting a tab updates its recency", () => {
        let state = createContainer(initialState(), { now: 1000 }).state
        const a = state.containers[0].activeTabId!
        const r = createTab(state, { now: 2000 })
        state = r.state
        state = selectTab(state, a, 3000)
        expect(state.tabs.get(a)!.lastActiveAt).toBe(3000)
        expect(state.tabs.get(r.value)!.lastActiveAt).toBe(2000)
    })

    it("switching container touches its active tab", () => {
        let state = createContainer(initialState(), { now: 1000 }).state
        const first = state.containers[0].id
        const firstTab = state.containers[0].activeTabId!
        state = createContainer(state, { now: 2000 }).state
        const second = state.containers[1].id
        state = selectTab(state, firstTab, 3000)
        state = switchContainer(state, second, 4000)
        state = switchContainer(state, first, 5000)
        expect(state.tabs.get(firstTab)!.lastActiveAt).toBe(5000)
        expect(
            state.tabs.get(state.containers.find((c) => c.id === second)!.activeTabId!)!
                .lastActiveAt,
        ).toBe(4000)
    })
})

describe("stepVisibleTab (Ctrl+Tab visual order)", () => {
    const buildTree = () => {
        let state = createContainer(initialState()).state
        const a = state.containers[0].activeTabId!
        const rb = createChildTab(state, a)
        state = rb.state
        const b = rb.value
        state = selectTab(state, a)
        const rc = createChildTab(state, a)
        state = rc.state
        const c = rc.value
        state = selectTab(state, b)
        const rd = createChildTab(state, b)
        state = rd.state
        const d = rd.value
        state = selectTab(state, a)
        return { state, a, b, c, d }
    }

    it("steps depth-first through visible rows and wraps cyclically", () => {
        const { state, a, b, c, d } = buildTree()
        const container = state.containers[0].id
        // Visual order: a, b, d, c
        expect(stepVisibleTab(state.tabs, container, a, 1)).toBe(b)
        expect(stepVisibleTab(state.tabs, container, b, 1)).toBe(d)
        expect(stepVisibleTab(state.tabs, container, d, 1)).toBe(c)
        expect(stepVisibleTab(state.tabs, container, c, 1)).toBe(a)
        expect(stepVisibleTab(state.tabs, container, a, -1)).toBe(c)
    })

    it("skips collapsed subtrees", () => {
        const { state, a, b, c, d } = buildTree()
        const collapsed = setCollapsed(state, b, true)
        const container = collapsed.containers[0].id
        // Visible order: a, b, c — d is hidden under the collapsed b
        expect(stepVisibleTab(collapsed.tabs, container, a, 1)).toBe(b)
        expect(stepVisibleTab(collapsed.tabs, container, b, 1)).toBe(c)
        expect(stepVisibleTab(collapsed.tabs, container, c, -1)).toBe(b)
        expect(stepVisibleTab(collapsed.tabs, container, a, -1)).toBe(c)
        expect(stepVisibleTab(collapsed.tabs, container, d, 1)).toBe(a)
    })

    it("handles an empty container and unknown active tab", () => {
        let state = createContainer(initialState()).state
        const first = state.containers[0].id
        state = createContainer(state).state
        const second = state.containers[1].id
        expect(stepVisibleTab(state.tabs, second, null, 1)).not.toBeNull()
        expect(stepVisibleTab(state.tabs, first, "tab-missing", 1)).not.toBeNull()
    })
})
