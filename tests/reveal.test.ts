import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test"

import { contains, createReveal, revealZones, type RevealZone } from "../src/renderer/shell/reveal"
import {
    REVEAL_EDGE,
    SIDEBAR_COMPACT_WIDTH,
    SIDEBAR_WIDTH,
    TOOLBAR_HEIGHT,
} from "../src/shared/settings"

const viewport = { width: 1200, height: 800 }

describe("revealZones", () => {
    it("has nothing to reveal when both bars are displayed", () => {
        expect(
            revealZones(
                { sidebarVisibility: "displayed", urlBarVisibility: "displayed" },
                viewport,
            ),
        ).toEqual({ sidebar: null, toolbar: null })
    })

    it("opens a compact sidebar from its strip and keeps it over the full width", () => {
        const { sidebar } = revealZones(
            { sidebarVisibility: "compact", urlBarVisibility: "displayed" },
            viewport,
        )
        expect(contains(sidebar!.trigger, SIDEBAR_COMPACT_WIDTH - 1, 100)).toBe(true)
        expect(contains(sidebar!.trigger, SIDEBAR_COMPACT_WIDTH, 100)).toBe(false)
        expect(contains(sidebar!.keep, SIDEBAR_WIDTH - 1, 100)).toBe(true)
        // The displayed toolbar is not part of the sidebar.
        expect(contains(sidebar!.keep, 10, viewport.height - TOOLBAR_HEIGHT + 1)).toBe(false)
        expect(sidebar!.openDelayMs).toBeGreaterThan(0)
    })

    it("opens a hidden sidebar from the left edge only, at once", () => {
        const { sidebar } = revealZones(
            { sidebarVisibility: "hidden", urlBarVisibility: "hidden" },
            viewport,
        )
        expect(contains(sidebar!.trigger, REVEAL_EDGE - 1, 100)).toBe(true)
        expect(contains(sidebar!.trigger, REVEAL_EDGE + 1, 100)).toBe(false)
        // With no toolbar at rest, the sidebar runs down to the bottom.
        expect(contains(sidebar!.keep, 10, viewport.height - 1)).toBe(true)
        expect(sidebar!.openDelayMs).toBe(0)
    })

    it("opens a hidden URL bar from the bottom edge", () => {
        const { toolbar } = revealZones(
            { sidebarVisibility: "displayed", urlBarVisibility: "hidden" },
            viewport,
        )
        expect(contains(toolbar!.trigger, 600, viewport.height - 1)).toBe(true)
        expect(contains(toolbar!.trigger, 600, viewport.height - REVEAL_EDGE - 1)).toBe(false)
        expect(contains(toolbar!.keep, 600, viewport.height - TOOLBAR_HEIGHT)).toBe(true)
    })
})

describe("createReveal", () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    const zone: RevealZone = {
        trigger: { left: 0, top: 0, right: 10, bottom: 100 },
        keep: { left: 0, top: 0, right: 50, bottom: 100 },
        openDelayMs: 90,
    }

    it("opens after the delay while the pointer rests on the trigger", () => {
        const reveal = createReveal(() => zone)
        reveal.pointer(5, 5)
        expect(reveal.isOpen()).toBe(false)
        // Moving within the trigger must not restart the delay.
        vi.advanceTimersByTime(60)
        reveal.pointer(6, 5)
        vi.advanceTimersByTime(40)
        expect(reveal.isOpen()).toBe(true)
    })

    it("does not open when the pointer only passes through", () => {
        const reveal = createReveal(() => zone)
        reveal.pointer(5, 5)
        reveal.pointer(70, 5)
        vi.advanceTimersByTime(500)
        expect(reveal.isOpen()).toBe(false)
    })

    it("stays open anywhere over the bar, and closes after leaving it", () => {
        const reveal = createReveal(() => zone)
        reveal.reveal()
        expect(reveal.isOpen()).toBe(true)
        reveal.pointer(40, 5)
        vi.advanceTimersByTime(1000)
        expect(reveal.isOpen()).toBe(true)
        reveal.pointer(80, 5)
        expect(reveal.isOpen()).toBe(true)
        vi.advanceTimersByTime(1000)
        expect(reveal.isOpen()).toBe(false)
    })

    it("forgives a brief overshoot", () => {
        const reveal = createReveal(() => zone)
        reveal.reveal()
        reveal.pointer(80, 5)
        vi.advanceTimersByTime(100)
        reveal.pointer(40, 5)
        vi.advanceTimersByTime(1000)
        expect(reveal.isOpen()).toBe(true)
    })

    it("stays open while focused, whatever the pointer does", () => {
        const reveal = createReveal(() => zone)
        reveal.setFocused(true)
        expect(reveal.isOpen()).toBe(true)
        reveal.leave()
        reveal.dismiss()
        vi.advanceTimersByTime(1000)
        expect(reveal.isOpen()).toBe(true)
        reveal.setFocused(false)
        vi.advanceTimersByTime(1000)
        expect(reveal.isOpen()).toBe(false)
    })

    it("closes at once on dismiss", () => {
        const reveal = createReveal(() => zone)
        reveal.reveal()
        reveal.dismiss()
        expect(reveal.isOpen()).toBe(false)
    })

    it("never opens a bar that is always displayed, and closes one that becomes so", () => {
        let current: RevealZone | null = zone
        const reveal = createReveal(() => current)
        reveal.reveal()
        current = null
        reveal.sync()
        expect(reveal.isOpen()).toBe(false)
        reveal.reveal()
        reveal.setFocused(true)
        expect(reveal.isOpen()).toBe(false)
    })
})
