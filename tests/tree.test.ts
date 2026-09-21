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
        const state = createContainer(initialState())
        expect(state.containers).toHaveLength(1)
        expect(state.containers[0].name).toBe("Container 1")
        expect(state.tabs.size).toBe(1)
        expect(state.activeContainerId).toBe(containerIdOf(state))
    })

    it("auto-names containers skipping used names", () => {
        let state = createContainer(initialState())
        state = createContainer(state)
        state = closeTab(state, state.containers[1].activeTabId!) // deletes Container 2
        state = createContainer(state)
        expect(state.containers.map((c) => c.name)).toEqual(["Container 1", "Container 2"])
    })

    it("defaults the icon and can change it", () => {
        let state = createContainer(initialState())
        expect(state.containers[0].icon).toBe("world")
        state = setContainerIcon(state, state.containers[0].id, "briefcase")
        expect(state.containers[0].icon).toBe("briefcase")
    })

    it("refuses to close the last tab of the last container", () => {
        const state = createContainer(initialState())
        const tabId = state.containers[0].activeTabId!
        expect(() => closeTab(state, tabId)).toThrow(DomainError)
    })

    it("deletes a container when its last tab closes and switches to a neighbor", () => {
        let state = createContainer(initialState())
        state = createContainer(state)
        const second = state.containers[1].id
        state = switchContainer(state, state.containers[0].id)
        state = closeTab(state, state.containers[0].activeTabId!)
        expect(state.containers.map((c) => c.id)).toEqual([second])
        expect(state.activeContainerId).toBe(second)
    })
})

describe("tab placement", () => {
    it("inserts manual tabs as sibling right after the active tab", () => {
        let state = createContainer(initialState())
        const first = state.containers[0].activeTabId!
        state = createTab(state)
        const second = state.containers[0].activeTabId!
        expect(tabIds(state)).toHaveLength(2)
        const firstTab = state.tabs.get(first)!
        const secondTab = state.tabs.get(second)!
        expect(secondTab.parentId).toBe(firstTab.parentId)
        expect(secondTab.order).toBe(firstTab.order + 1)
    })

    it("creates link tabs as last child of their parent and selects them", () => {
        let state = createContainer(initialState())
        const parent = state.containers[0].activeTabId!
        state = createChildTab(state, parent)
        const child = state.containers[0].activeTabId!
        expect(state.tabs.get(child)!.parentId).toBe(parent)
        expect(state.tabs.get(child)!.order).toBe(0)
        state = createChildTab(state, parent)
        const secondChild = state.containers[0].activeTabId!
        expect(state.tabs.get(secondChild)!.order).toBe(1)
    })
})

describe("close semantics", () => {
    const buildTree = () => {
        let state = createContainer(initialState())
        const a = state.containers[0].activeTabId!
        state = createChildTab(state, a)
        const b = state.containers[0].activeTabId!
        state = createChildTab(state, a)
        const c = state.containers[0].activeTabId!
        state = createChildTab(state, b)
        const d = state.containers[0].activeTabId!
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

    it("closing an expanded tab promotes children into its position", () => {
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
        let state = createContainer(initialState())
        state = createContainer(state)
        const firstTab = state.containers[0].activeTabId!
        state = closeTab(state, firstTab)
        expect(state.containers).toHaveLength(1)
        state = reopenTab(state)
        expect(state.containers).toHaveLength(2)
        expect(state.tabs.has(firstTab)).toBe(true)
        expect(state.activeContainerId).toBe(state.tabs.get(firstTab)!.containerId)
    })

    it("activates a sibling after closing the active tab", () => {
        let state = createContainer(initialState())
        state = createTab(state)
        const second = state.containers[0].activeTabId!
        state = closeTab(state, second)
        expect(state.containers[0].activeTabId).not.toBeNull()
        expect(state.tabs.has(state.containers[0].activeTabId!)).toBe(true)
    })
})

describe("moves", () => {
    it("reorders tabs between parents", () => {
        let state = createContainer(initialState())
        const a = state.containers[0].activeTabId!
        state = createTab(state)
        const b = state.containers[0].activeTabId!
        state = createChildTab(state, b)
        const c = state.containers[0].activeTabId!
        state = moveTab(state, { tabId: c, parentId: a, index: 0 })
        expect(state.tabs.get(c)!.parentId).toBe(a)
        expect(state.tabs.get(c)!.order).toBe(0)
    })

    it("refuses to move a tab into its own subtree", () => {
        let state = createContainer(initialState())
        const a = state.containers[0].activeTabId!
        state = createChildTab(state, a)
        const child = state.containers[0].activeTabId!
        state = createChildTab(state, child)
        const grandchild = state.containers[0].activeTabId!
        expect(() => moveTab(state, { tabId: a, parentId: grandchild, index: 0 })).toThrow(
            DomainError,
        )
    })

    it("moves a tab and its subtree to another container as roots", () => {
        let state = createContainer(initialState())
        const a = state.containers[0].activeTabId!
        state = createChildTab(state, a)
        const child = state.containers[0].activeTabId!
        state = createContainer(state)
        const target = state.containers[1].id
        state = moveToContainer(state, a, target)
        expect(state.tabs.get(a)!.containerId).toBe(target)
        expect(state.tabs.get(a)!.parentId).toBeNull()
        expect(state.tabs.get(child)!.containerId).toBe(target)
        expect(state.tabs.get(child)!.parentId).toBe(a)
        expect(state.containers).toHaveLength(1)
        expect(state.activeContainerId).toBe(target)
    })
})

describe("display order", () => {
    it("renders depth-first and prunes collapsed subtrees", () => {
        let state = createContainer(initialState())
        const a = state.containers[0].activeTabId!
        state = createChildTab(state, a)
        const b = state.containers[0].activeTabId!
        state = createTab(state)
        const c = state.containers[0].activeTabId!
        state = createChildTab(state, b)
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
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

    it("new tabs are more recent than their parent", () => {
        let state = createContainer(initialState())
        const a = state.containers[0].activeTabId!
        state = createChildTab(state, a)
        const b = state.containers[0].activeTabId!
        expect(state.tabs.get(b)!.lastActiveAt).toBeGreaterThanOrEqual(
            state.tabs.get(a)!.lastActiveAt,
        )
    })

    it("selecting a tab updates its recency", async () => {
        let state = createContainer(initialState())
        const a = state.containers[0].activeTabId!
        state = createTab(state)
        const b = state.containers[0].activeTabId!
        await sleep(2)
        state = selectTab(state, a)
        expect(state.tabs.get(a)!.lastActiveAt).toBeGreaterThan(state.tabs.get(b)!.lastActiveAt)
    })

    it("switching container touches its active tab", async () => {
        let state = createContainer(initialState())
        const first = state.containers[0].id
        const firstTab = state.containers[0].activeTabId!
        await sleep(2)
        state = createContainer(state)
        const second = state.containers[1].id
        await sleep(2)
        state = selectTab(state, firstTab)
        await sleep(2)
        state = switchContainer(state, second)
        await sleep(2)
        state = switchContainer(state, first)
        expect(state.tabs.get(firstTab)!.lastActiveAt).toBeGreaterThan(
            state.tabs.get(state.containers.find((c) => c.id === second)!.activeTabId!)!
                .lastActiveAt,
        )
    })
})

describe("stepVisibleTab (Ctrl+Tab visual order)", () => {
    const buildTree = () => {
        let state = createContainer(initialState())
        const a = state.containers[0].activeTabId!
        state = createChildTab(state, a)
        const b = state.containers[0].activeTabId!
        state = selectTab(state, a)
        state = createChildTab(state, a)
        const c = state.containers[0].activeTabId!
        state = selectTab(state, b)
        state = createChildTab(state, b)
        const d = state.containers[0].activeTabId!
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
        let state = createContainer(initialState())
        const first = state.containers[0].id
        state = createContainer(state)
        const second = state.containers[1].id
        expect(stepVisibleTab(state.tabs, second, null, 1)).not.toBeNull()
        expect(stepVisibleTab(state.tabs, first, "tab-missing", 1)).not.toBeNull()
    })
})
