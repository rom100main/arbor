import { describe, expect, it } from "vite-plus/test"

import { createSwipeTracker, type SwipeDirection } from "../src/renderer/shell/sidebar/swipe"

const setup = () => {
    let t = 1000
    const calls: { at: number; direction: SwipeDirection }[] = []
    const tracker = createSwipeTracker({
        now: () => t,
        onSwipe: (direction) => {
            calls.push({ at: t, direction })
        },
    })
    const tick = (deltaX: number, dtMs: number, deltaY = 0): void => {
        t += dtMs
        tracker.handle(deltaX, deltaY)
    }
    return { calls, tick, time: () => t }
}

describe("swipe tracker", () => {
    it("fires exactly once for a hard flick with a long momentum tail", () => {
        const { calls, tick } = setup()
        // Finger contact: strong ticks at 60Hz.
        for (let i = 0; i < 8; i += 1) tick(30, 16)
        // Momentum tail: decaying ticks.
        for (let i = 0; i < 30; i += 1) tick(Math.max(1, 18 - i), 16)
        expect(calls).toHaveLength(1)
        expect(calls[0].direction).toBe(1)
    })

    it("fires again for the next swipe after a pause", () => {
        const { calls, tick } = setup()
        for (let i = 0; i < 8; i += 1) tick(30, 16)
        for (let i = 0; i < 30; i += 1) tick(Math.max(1, 18 - i), 16)
        tick(0, 2000)
        for (let i = 0; i < 5; i += 1) tick(30, 16)
        expect(calls).toHaveLength(2)
    })

    it("lets a fast second swipe cut through momentum via a fresh strong tick", () => {
        const { calls, tick } = setup()
        for (let i = 0; i < 4; i += 1) tick(30, 16)
        expect(calls).toHaveLength(1)
        // Short weak tail, then a fresh hard tick well before the lock cap.
        for (let i = 0; i < 3; i += 1) tick(3, 16)
        tick(35, 16)
        tick(30, 16)
        expect(calls).toHaveLength(2)
    })

    it("always recovers via the lock cap even under endless strong input", () => {
        const { calls, tick } = setup()
        for (let i = 0; i < 3; i += 1) tick(30, 16)
        expect(calls).toHaveLength(1)
        // Pathological: strong ticks nonstop for 1.2s.
        for (let i = 0; i < 75; i += 1) tick(20, 16)
        // Lock must have released; fresh ticks fire again.
        tick(30, 200)
        tick(30, 16)
        expect(calls.length).toBeGreaterThanOrEqual(2)
    })

    it("accumulates slow swipes and maps direction (positive = next)", () => {
        const { calls, tick } = setup()
        for (let i = 0; i < 20; i += 1) tick(4, 30)
        expect(calls).toHaveLength(1)
        expect(calls[0].direction).toBe(1)
        tick(0, 1000)
        tick(-60, 16)
        expect(calls).toHaveLength(2)
        expect(calls[1].direction).toBe(-1)
    })

    it("ignores vertical scroll and sub-threshold flicks", () => {
        const { calls, tick } = setup()
        for (let i = 0; i < 10; i += 1) tick(5, 16, 50)
        tick(10, 16)
        tick(10, 16)
        expect(calls).toHaveLength(0)
    })
})
