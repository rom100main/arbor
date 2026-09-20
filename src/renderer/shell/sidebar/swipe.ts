export type SwipeDirection = 1 | -1

export interface SwipeTrackerOptions {
    /** Accumulated delta needed to fire. Defaults to 48. */
    threshold?: number
    /** Quiet time after the last active tick that ends a gesture. Defaults to 150. */
    gestureEndMs?: number
    /** Ticks smaller than this don't extend a consumed gesture (momentum tail). Defaults to 5. */
    activeTick?: number
    /** Hard cap on lock duration; guarantees recovery. Defaults to 900. */
    maxLockMs?: number
    /** A tick this strong after weak ones is a fresh intentional swipe. Defaults to 26. */
    freshTick?: number
    /** Ticks below this count as weak for fresh-swipe detection. Defaults to 12. */
    weakTick?: number
    now?: () => number
    onSwipe?: (direction: SwipeDirection) => void
}

/**
 * Trackpad swipe state machine:
 * one continuous swipe fires exactly one `onSwipe`,
 * no matter how strong the flick or how long its momentum tail.
 *
 * Guarantees:
 * - At most one swipe per gesture burst (strong flicks can't skip containers).
 * - The lock always releases: after `gestureEndMs` of quiet,
 *   on a fresh strong tick cutting through momentum, or at `maxLockMs` at the latest.
 * - Slow swipes still work: small ticks accumulate while the gesture is fresh.
 *
 * Positive deltaX maps to direction `1`, negative to `-1`.
 */
export const createSwipeTracker = (options: SwipeTrackerOptions = {}) => {
    const threshold = options.threshold ?? 48
    const gestureEndMs = options.gestureEndMs ?? 150
    const activeTick = options.activeTick ?? 5
    const maxLockMs = options.maxLockMs ?? 900
    const freshTick = options.freshTick ?? 26
    const weakTick = options.weakTick ?? 12
    const nowFn = options.now ?? (() => performance.now())
    const onSwipe = options.onSwipe

    let accum = 0
    let consumed = false
    let lastActiveTime = 0
    let lockStartedAt = 0
    let weakStreak = 0

    /**
     * Feed one wheel event.
     * Returns true when the event is a horizontal swipe tick (caller should preventDefault),
     * false for vertical scroll.
     */
    const handle = (deltaX: number, deltaY: number): boolean => {
        if (Math.abs(deltaX) <= Math.abs(deltaY)) return false
        const now = nowFn()
        const mag = Math.abs(deltaX)

        // Fresh intentional swipe cutting through momentum:
        // a strong tick right after weak ones starts a new gesture immediately.
        if (consumed && mag >= freshTick && weakStreak >= 1) {
            consumed = false
            accum = 0
            weakStreak = 0
        }
        // Gesture ended (quiet) or lock overstayed: always recover.
        if (now - lastActiveTime > gestureEndMs || (consumed && now - lockStartedAt > maxLockMs)) {
            accum = 0
            consumed = false
            weakStreak = 0
        }
        if (!consumed || mag >= activeTick) lastActiveTime = now
        weakStreak = mag < weakTick ? weakStreak + 1 : 0
        if (consumed) return true

        accum += deltaX
        if (Math.abs(accum) < threshold) return true
        const direction: SwipeDirection = accum > 0 ? 1 : -1
        accum = 0
        consumed = true
        lockStartedAt = now
        weakStreak = 0
        onSwipe?.(direction)
        return true
    }

    return { handle }
}
