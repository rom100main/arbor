import { describe, expect, it } from "vite-plus/test"

import { closeTab, reopenTab } from "../src/main/state/close-reopen"
import { createContainer, setContainerIcon, switchContainer } from "../src/main/state/containers"
import { moveTab, moveToContainer } from "../src/main/state/moves"
import { initialState } from "../src/main/state/state"
import { stepVisibleTab } from "../src/main/state/tab-order"
import { createChildTab, createTab, selectTab, setCollapsed } from "../src/main/state/tabs"
import { childRow, neighborRow, parentRow } from "../src/renderer/shell/sidebar/navigation"
import { InvalidMove, LastTab } from "../src/shared/errors"
import { displayTabs } from "../src/shared/tree-display"
import { err, newChild, newContainer, newTab, nextTabId, ok } from "./support/domain"

const containerIdOf = (state: { containers: { id: string }[] }, index = 0): string =>
    state.containers[index].id

const tabIds = (state: { tabs: Map<string, unknown> }): string[] => [...state.tabs.keys()]

describe("containers", () => {
    it("creates a container with an empty tab on top", () => {
        const state = ok(createContainer(initialState(), newContainer()))
        expect(state.containers).toHaveLength(1)
        expect(state.containers[0].name).toBe("Container 1")
        expect(state.tabs.size).toBe(1)
        expect(state.activeContainerId).toBe(containerIdOf(state))
    })

    it("auto-names containers skipping used names", () => {
        let state = ok(createContainer(initialState(), newContainer()))
        state = ok(createContainer(state, newContainer()))
        state = ok(closeTab(state, state.containers[1].activeTabId!, 0)) // deletes Container 2
        state = ok(createContainer(state, newContainer()))
        expect(state.containers.map((c) => c.name)).toEqual(["Container 1", "Container 2"])
    })

    it("defaults the icon and can change it", () => {
        let state = ok(createContainer(initialState(), newContainer()))
        expect(state.containers[0].icon).toBe("world")
        state = ok(setContainerIcon(state, state.containers[0].id, "briefcase"))
        expect(state.containers[0].icon).toBe("briefcase")
    })

    it("refuses to close the last tab of the last container", () => {
        const state = ok(createContainer(initialState(), newContainer()))
        const tabId = state.containers[0].activeTabId!
        expect(err(closeTab(state, tabId, 0))).toBeInstanceOf(LastTab)
    })

    it("refuses to close a collapsed root holding every remaining tab", () => {
        let state = ok(createContainer(initialState(), newContainer()))
        const a = state.containers[0].activeTabId!
        state = ok(createChildTab(state, a, newChild()))
        const b = state.containers[0].activeTabId!
        state = ok(createChildTab(state, b, newChild()))
        state = ok(setCollapsed(state, a, true))
        expect(err(closeTab(state, a, 0))).toBeInstanceOf(LastTab)
    })

    it("deletes a container when its last tab closes and switches to a neighbor", () => {
        let state = ok(createContainer(initialState(), newContainer()))
        state = ok(createContainer(state, newContainer()))
        const second = state.containers[1].id
        state = ok(switchContainer(state, state.containers[0].id, 0))
        state = ok(closeTab(state, state.containers[0].activeTabId!, 0))
        expect(state.containers.map((c) => c.id)).toEqual([second])
        expect(state.activeContainerId).toBe(second)
    })
})

describe("tab placement", () => {
    it("inserts manual tabs as sibling right after the active tab", () => {
        let state = ok(createContainer(initialState(), newContainer()))
        const first = state.containers[0].activeTabId!
        state = ok(createTab(state, newTab()))
        const second = state.containers[0].activeTabId!
        expect(tabIds(state)).toHaveLength(2)
        const firstTab = state.tabs.get(first)!
        const secondTab = state.tabs.get(second)!
        expect(secondTab.parentId).toBe(firstTab.parentId)
        expect(secondTab.order).toBe(firstTab.order + 1)
    })

    it("creates link tabs as last child of their parent and selects them", () => {
        let state = ok(createContainer(initialState(), newContainer()))
        const parent = state.containers[0].activeTabId!
        const first = nextTabId()
        state = ok(createChildTab(state, parent, newChild({ id: first })))
        expect(first).toBe(state.containers[0].activeTabId)
        expect(state.tabs.get(first)!.parentId).toBe(parent)
        expect(state.tabs.get(first)!.order).toBe(0)
        const second = nextTabId()
        state = ok(createChildTab(state, parent, newChild({ id: second })))
        expect(state.tabs.get(second)!.order).toBe(1)
    })

    it("createChildTab activates the child and its container", () => {
        let state = ok(createContainer(initialState(), newContainer()))
        state = ok(createContainer(state, newContainer()))
        const firstId = state.containers[0].id
        const secondId = state.containers[1].id
        state = ok(switchContainer(state, firstId, 0))
        // Create a child under a tab in the inactive second container.
        const secondTab = state.containers[1].activeTabId!
        const child = nextTabId()
        state = ok(createChildTab(state, secondTab, newChild({ id: child })))
        expect(child).toBe(state.containers.find((c) => c.id === secondId)!.activeTabId)
        expect(state.activeContainerId).toBe(secondId)
    })

    it("background child creation does not steal focus", () => {
        let state = ok(createContainer(initialState(), newContainer()))
        const parent = state.containers[0].activeTabId!
        const before = state.containers[0].activeTabId!
        const child = nextTabId()
        state = ok(createChildTab(state, parent, newChild({ id: child, background: true })))
        expect(state.tabs.has(child)).toBe(true)
        expect(state.containers[0].activeTabId).toBe(before)
    })
})

describe("close semantics", () => {
    const buildTree = () => {
        let state = ok(createContainer(initialState(), newContainer()))
        const a = state.containers[0].activeTabId!
        const b = nextTabId()
        state = ok(createChildTab(state, a, newChild({ id: b })))
        const c = nextTabId()
        state = ok(createChildTab(state, a, newChild({ id: c })))
        const d = nextTabId()
        state = ok(createChildTab(state, b, newChild({ id: d })))
        return { state, a, b, c, d }
    }

    it("closing a collapsed tab removes its whole subtree", () => {
        const built = buildTree()
        let { state } = built
        const { a, b, d } = built
        state = ok(setCollapsed(state, b, true))
        state = ok(closeTab(state, b, 0))
        expect(state.tabs.has(b)).toBe(false)
        expect(state.tabs.has(d)).toBe(false)
        expect(state.tabs.has(a)).toBe(true)
    })

    it("closing an expanded tab promotes direct children into its position", () => {
        const built = buildTree()
        let { state } = built
        const { a, b, c, d } = built
        state = ok(closeTab(state, b, 0))
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
        let state = ok(createContainer(initialState(), newContainer()))
        const a = state.containers[0].activeTabId!
        const b = nextTabId()
        state = ok(createChildTab(state, a, newChild({ id: b })))
        const c = nextTabId()
        state = ok(createChildTab(state, b, newChild({ id: c })))
        state = ok(closeTab(state, a, 0))
        expect(state.tabs.has(a)).toBe(false)
        expect(state.tabs.get(b)!.parentId).toBeNull()
        expect(state.tabs.get(c)!.parentId).toBe(b)
    })

    it("reopen restores a closed subtree at its original position", () => {
        const built = buildTree()
        let { state } = built
        const { a, b, c, d } = built
        state = ok(closeTab(state, b, 0))
        state = ok(reopenTab(state, 0))
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
        let state = ok(createContainer(initialState(), newContainer()))
        state = ok(createContainer(state, newContainer()))
        const firstTab = state.containers[0].activeTabId!
        state = ok(closeTab(state, firstTab, 0))
        expect(state.containers).toHaveLength(1)
        state = ok(reopenTab(state, 0))
        expect(state.containers).toHaveLength(2)
        expect(state.tabs.has(firstTab)).toBe(true)
        expect(state.activeContainerId).toBe(state.tabs.get(firstTab)!.containerId)
    })

    it("reopen falls back to a root when the original parent moved away", () => {
        let state = ok(createContainer(initialState(), newContainer()))
        const a = state.containers[0].activeTabId!
        // Add a sibling so the container survives the parent's departure.
        state = ok(createTab(state, newTab()))
        const child = nextTabId()
        state = ok(createChildTab(state, a, newChild({ id: child })))
        state = ok(closeTab(state, child, 0))
        // Move parent a to another container (original container survives).
        state = ok(createContainer(state, newContainer()))
        const target = state.containers[1].id
        state = ok(moveToContainer(state, a, target))
        state = ok(reopenTab(state, 0))
        // The reopened child becomes a root in its original container (parent moved away).
        expect(state.tabs.get(child)!.parentId).toBeNull()
        expect(state.tabs.get(child)!.containerId).toBe(state.containers[0].id)
    })

    it("reopen falls back to a valid container when the original is gone", () => {
        let state = ok(createContainer(initialState(), newContainer()))
        const a = state.containers[0].activeTabId!
        const child = nextTabId()
        state = ok(createChildTab(state, a, newChild({ id: child })))
        state = ok(closeTab(state, child, 0))
        // Move the only tab out so the original container auto-deletes.
        state = ok(createContainer(state, newContainer()))
        const target = state.containers[1].id
        state = ok(moveToContainer(state, a, target))
        expect(state.containers).toHaveLength(1)
        state = ok(reopenTab(state, 0))
        expect(state.tabs.has(child)).toBe(true)
        // Restored into the surviving container (the original is gone).
        expect(state.tabs.get(child)!.containerId).toBe(target)
    })

    it("activates a sibling after closing the active tab", () => {
        let state = ok(createContainer(initialState(), newContainer()))
        state = ok(createTab(state, newTab()))
        const second = state.containers[0].activeTabId!
        state = ok(closeTab(state, second, 0))
        expect(state.containers[0].activeTabId).not.toBeNull()
        expect(state.tabs.has(state.containers[0].activeTabId!)).toBe(true)
    })
})

describe("moves", () => {
    it("reorders tabs between parents", () => {
        let state = ok(createContainer(initialState(), newContainer()))
        const a = state.containers[0].activeTabId!
        state = ok(createTab(state, newTab()))
        const b = state.containers[0].activeTabId!
        state = ok(createChildTab(state, b, newChild()))
        const c = state.containers[0].activeTabId!
        state = ok(moveTab(state, { tabId: c, parentId: a, index: 0 }))
        expect(state.tabs.get(c)!.parentId).toBe(a)
        expect(state.tabs.get(c)!.order).toBe(0)
    })

    it("refuses to move a tab into its own subtree", () => {
        let state = ok(createContainer(initialState(), newContainer()))
        const a = state.containers[0].activeTabId!
        state = ok(createChildTab(state, a, newChild()))
        const child = state.containers[0].activeTabId!
        state = ok(createChildTab(state, child, newChild()))
        const grandchild = state.containers[0].activeTabId!
        expect(err(moveTab(state, { tabId: a, parentId: grandchild, index: 0 }))).toBeInstanceOf(
            InvalidMove,
        )
    })

    it("moves a tab and its subtree to another container as roots", () => {
        let state = ok(createContainer(initialState(), newContainer()))
        const a = state.containers[0].activeTabId!
        state = ok(createChildTab(state, a, newChild()))
        const child = state.containers[0].activeTabId!
        state = ok(createContainer(state, newContainer()))
        const target = state.containers[1].id
        state = ok(moveToContainer(state, a, target))
        expect(state.tabs.get(a)!.containerId).toBe(target)
        expect(state.tabs.get(a)!.parentId).toBeNull()
        expect(state.tabs.get(child)!.containerId).toBe(target)
        expect(state.tabs.get(child)!.parentId).toBe(a)
        expect(state.containers).toHaveLength(1)
        expect(state.activeContainerId).toBe(target)
    })

    it("repairs the source container active pointer on cross-container move", () => {
        let state = ok(createContainer(initialState(), newContainer()))
        state = ok(createTab(state, newTab()))
        const movable = state.containers[0].activeTabId!
        state = ok(createContainer(state, newContainer()))
        const target = state.containers[1].id
        state = ok(moveToContainer(state, movable, target))
        // Source container survives with the first tab; its activeTabId must not reference the moved tab.
        const source = state.containers.find((c) => c.id !== target)!
        expect(source.activeTabId).not.toBe(movable)
        expect(source.activeTabId).not.toBeNull()
        expect(state.tabs.get(source.activeTabId!)!.containerId).toBe(source.id)
    })
})

describe("display order", () => {
    it("renders depth-first and prunes collapsed subtrees", () => {
        let state = ok(createContainer(initialState(), newContainer()))
        const a = state.containers[0].activeTabId!
        state = ok(createChildTab(state, a, newChild()))
        const b = state.containers[0].activeTabId!
        state = ok(createTab(state, newTab()))
        const c = state.containers[0].activeTabId!
        state = ok(createChildTab(state, b, newChild()))
        const d = state.containers[0].activeTabId!
        const containerId = state.containers[0].id

        expect(displayTabs([...state.tabs.values()], containerId).map((t) => t.id)).toEqual([
            a,
            b,
            d,
            c,
        ])

        state = ok(setCollapsed(state, b, true))
        expect(displayTabs([...state.tabs.values()], containerId).map((t) => t.id)).toEqual([
            a,
            b,
            c,
        ])
    })
})

describe("keyboard tree navigation", () => {
    const rows = () => {
        let state = ok(createContainer(initialState(), newContainer()))
        const a = state.containers[0].activeTabId!
        const b = nextTabId()
        state = ok(createChildTab(state, a, newChild({ id: b })))
        const c = nextTabId()
        state = ok(createChildTab(state, b, newChild({ id: c })))
        const d = nextTabId()
        state = ok(createChildTab(state, a, newChild({ id: d })))
        state = ok(selectTab(state, a, 0))
        return {
            state,
            a,
            b,
            c,
            d,
            visible: displayTabs([...state.tabs.values()], state.containers[0].id),
        }
    }

    it("moves between visible rows without wrapping", () => {
        const { a, b, c, d, visible } = rows()
        // a, b, c, d
        expect(neighborRow(visible, a, 1)).toBe(b)
        expect(neighborRow(visible, b, 1)).toBe(c)
        expect(neighborRow(visible, d, 1)).toBeNull()
        expect(neighborRow(visible, a, -1)).toBeNull()
        expect(neighborRow(visible, c, -1)).toBe(b)
    })

    it("finds the first child and the parent of a row", () => {
        const { a, b, c, d, visible } = rows()
        expect(childRow(visible, a)).toBe(b)
        expect(childRow(visible, b)).toBe(c)
        expect(childRow(visible, c)).toBeNull()
        expect(parentRow(visible, c)).toBe(b)
        expect(parentRow(visible, b)).toBe(a)
        expect(parentRow(visible, a)).toBeNull()
        expect(parentRow(visible, d)).toBe(a)
    })
})

describe("recency", () => {
    it("new tabs are more recent than their parent", () => {
        let state = ok(createContainer(initialState(), newContainer({ now: 1000 })))
        const a = state.containers[0].activeTabId!
        const child = nextTabId()
        state = ok(createChildTab(state, a, newChild({ id: child, now: 2000 })))
        expect(state.tabs.get(child)!.lastActiveAt).toBe(2000)
        expect(state.tabs.get(a)!.lastActiveAt).toBe(1000)
    })

    it("selecting a tab updates its recency", () => {
        let state = ok(createContainer(initialState(), newContainer({ now: 1000 })))
        const a = state.containers[0].activeTabId!
        const b = nextTabId()
        state = ok(createTab(state, newTab({ id: b, now: 2000 })))
        state = ok(selectTab(state, a, 3000))
        expect(state.tabs.get(a)!.lastActiveAt).toBe(3000)
        expect(state.tabs.get(b)!.lastActiveAt).toBe(2000)
    })

    it("switching container touches its active tab", () => {
        let state = ok(createContainer(initialState(), newContainer({ now: 1000 })))
        const first = state.containers[0].id
        const firstTab = state.containers[0].activeTabId!
        state = ok(createContainer(state, newContainer({ now: 2000 })))
        const second = state.containers[1].id
        state = ok(selectTab(state, firstTab, 3000))
        state = ok(switchContainer(state, second, 4000))
        state = ok(switchContainer(state, first, 5000))
        expect(state.tabs.get(firstTab)!.lastActiveAt).toBe(5000)
        expect(
            state.tabs.get(state.containers.find((c) => c.id === second)!.activeTabId!)!
                .lastActiveAt,
        ).toBe(4000)
    })
})

describe("stepVisibleTab (Ctrl+Tab visual order)", () => {
    const buildTree = () => {
        let state = ok(createContainer(initialState(), newContainer()))
        const a = state.containers[0].activeTabId!
        const b = nextTabId()
        state = ok(createChildTab(state, a, newChild({ id: b })))
        state = ok(selectTab(state, a, 0))
        const c = nextTabId()
        state = ok(createChildTab(state, a, newChild({ id: c })))
        state = ok(selectTab(state, b, 0))
        const d = nextTabId()
        state = ok(createChildTab(state, b, newChild({ id: d })))
        state = ok(selectTab(state, a, 0))
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
        const collapsed = ok(setCollapsed(state, b, true))
        const container = collapsed.containers[0].id
        // Visible order: a, b, c — d is hidden under the collapsed b
        expect(stepVisibleTab(collapsed.tabs, container, a, 1)).toBe(b)
        expect(stepVisibleTab(collapsed.tabs, container, b, 1)).toBe(c)
        expect(stepVisibleTab(collapsed.tabs, container, c, -1)).toBe(b)
        expect(stepVisibleTab(collapsed.tabs, container, a, -1)).toBe(c)
        expect(stepVisibleTab(collapsed.tabs, container, d, 1)).toBe(a)
    })

    it("handles an empty container and unknown active tab", () => {
        let state = ok(createContainer(initialState(), newContainer()))
        const first = state.containers[0].id
        state = ok(createContainer(state, newContainer()))
        const second = state.containers[1].id
        expect(stepVisibleTab(state.tabs, second, null, 1)).not.toBeNull()
        expect(stepVisibleTab(state.tabs, first, "tab-missing", 1)).not.toBeNull()
    })
})
