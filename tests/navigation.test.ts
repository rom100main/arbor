import { describe, expect, it } from "vite-plus/test"

import { createContainer } from "../src/main/state/containers"
import { initialState, snapshot } from "../src/main/state/state"
import { navAvailability, type ViewHandle } from "../src/main/windows/host"
import { menuModel, menuTemplate, sameMenuModel } from "../src/main/windows/menu"
import { newContainer, ok } from "./support/domain"
import { fakeRenderer } from "./support/ipc"

const viewWithHistory = (activeIndex: number): ViewHandle => {
    const { renderer, navigationHistory } = fakeRenderer()
    // fakeRenderer's history has two entries; move the index to the requested position.
    navigationHistory.activeIndex = activeIndex
    return { tabId: "tab-test", sessionKey: { kind: "internal" }, webContents: renderer }
}

const historyItems = (template: ReturnType<typeof menuTemplate>) => {
    const history = template.find((item) => item.label === "History")
    return Array.isArray(history?.submenu) ? history.submenu : []
}

describe("navAvailability", () => {
    it("is neither way for a tab with no live page", () => {
        expect(navAvailability(undefined)).toEqual({ canGoBack: false, canGoForward: false })
    })

    it("reads back/forward off the live page's history", () => {
        // Index 1 of 2 entries: a previous entry, no next one.
        expect(navAvailability(viewWithHistory(1))).toEqual({
            canGoBack: true,
            canGoForward: false,
        })
        // Index 0: no previous entry, a next one.
        expect(navAvailability(viewWithHistory(0))).toEqual({
            canGoBack: false,
            canGoForward: true,
        })
    })
})

describe("snapshot navigation", () => {
    it("defaults to neither way, and carries the given availability", () => {
        const state = ok(createContainer(initialState(), newContainer()))
        expect(snapshot(state).navigation).toEqual({ canGoBack: false, canGoForward: false })
        expect(snapshot(state, { canGoBack: true, canGoForward: false }).navigation).toEqual({
            canGoBack: true,
            canGoForward: false,
        })
    })
})

describe("menu back/forward", () => {
    it("defaults to greyed and distinguishes availability in sameMenuModel", () => {
        const state = ok(createContainer(initialState(), newContainer()))
        const model = menuModel(state)
        expect(model.canGoBack).toBe(false)
        expect(model.canGoForward).toBe(false)
        expect(sameMenuModel(model, model)).toBe(true)
        expect(sameMenuModel(model, { ...model, canGoBack: true })).toBe(false)
        expect(sameMenuModel(model, { ...model, canGoForward: true })).toBe(false)
    })

    it("greys the History items when the active page cannot go that way", () => {
        const state = ok(createContainer(initialState(), newContainer()))
        const items = historyItems(menuTemplate(menuModel(state), () => {}))
        expect(items.find((item) => item.label === "Back")?.enabled).toBe(false)
        expect(items.find((item) => item.label === "Forward")?.enabled).toBe(false)

        const enabledItems = historyItems(
            menuTemplate({ ...menuModel(state), canGoBack: true, canGoForward: true }, () => {}),
        )
        expect(enabledItems.find((item) => item.label === "Back")?.enabled).toBe(true)
        expect(enabledItems.find((item) => item.label === "Forward")?.enabled).toBe(true)
    })
})
