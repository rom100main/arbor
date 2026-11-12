import { createSignal, type Accessor } from "solid-js"

import {
    chromeInsets,
    REVEAL_EDGE,
    SIDEBAR_COMPACT_WIDTH,
    SIDEBAR_WIDTH,
    TITLEBAR_HEIGHT,
    TOOLBAR_HEIGHT,
    type Settings,
} from "../../shared/settings"

export const REVEAL_MS = 200
const COMPACT_OPEN_DELAY_MS = 90
const CLOSE_DELAY_MS = 220

export interface Rect {
    readonly left: number
    readonly top: number
    readonly right: number
    readonly bottom: number
}

export const contains = (rect: Rect | null, x: number, y: number): boolean =>
    rect !== null && x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom

export interface RevealZone {
    readonly trigger: Rect
    readonly keep: Rect
    readonly openDelayMs: number
}

/** `null` for a bar that is always displayed. */
export interface RevealZones {
    readonly sidebar: RevealZone | null
    readonly toolbar: RevealZone | null
    readonly titlebar: RevealZone // no null because title bar is never displayed
}

export const revealZones = (
    settings: Pick<Settings, "sidebarVisibility" | "urlBarVisibility">,
    viewport: { width: number; height: number },
): RevealZones => {
    const { width, height } = viewport
    const sidebarBottom = height - chromeInsets(settings).bottom
    const sidebar =
        settings.sidebarVisibility === "displayed"
            ? null
            : {
                  trigger: {
                      left: 0,
                      top: 0,
                      right:
                          settings.sidebarVisibility === "compact"
                              ? SIDEBAR_COMPACT_WIDTH
                              : REVEAL_EDGE,
                      bottom: sidebarBottom,
                  },
                  keep: { left: 0, top: 0, right: SIDEBAR_WIDTH, bottom: sidebarBottom },
                  openDelayMs: settings.sidebarVisibility === "compact" ? COMPACT_OPEN_DELAY_MS : 0,
              }
    const toolbar =
        settings.urlBarVisibility === "displayed"
            ? null
            : {
                  trigger: { left: 0, top: height - REVEAL_EDGE, right: width, bottom: height },
                  keep: { left: 0, top: height - TOOLBAR_HEIGHT, right: width, bottom: height },
                  openDelayMs: 0,
              }
    const titlebar: RevealZone = {
        trigger: { left: 0, top: 0, right: width, bottom: REVEAL_EDGE },
        keep: { left: 0, top: 0, right: width, bottom: TITLEBAR_HEIGHT },
        openDelayMs: 0,
    }
    return { sidebar, toolbar, titlebar }
}

export interface Reveal {
    readonly open: Accessor<boolean>
    /** The same state, current even before the signal flushes. */
    readonly isOpen: () => boolean
    /** The pointer moved over the shell. */
    readonly pointer: (x: number, y: number) => void
    /** The pointer left the shell. */
    readonly leave: () => void
    /** Open now, as if the pointer already rested on the bar (its edge was reached over the page). */
    readonly reveal: () => void
    /** Keep the bar out while focus is inside it, e.g. typing in the URL bar. */
    readonly setFocused: (focused: boolean) => void
    /** Keep the bar out while something anchored to it is open, e.g. a toolbar popup. */
    readonly setPinned: (pinned: boolean) => void
    /** Close now, skipping the grace delay. */
    readonly dismiss: () => void
    /** Re-evaluate after the zones changed (settings, window size). */
    readonly sync: () => void
}

/**
 * Open/close state for one bar that hides or collapses at rest.
 *
 * Hover is judged from the pointer's coordinates rather than from enter/leave events:
 * a bar sliding in under a pointer that does not move never receives `mouseenter`.
 *
 * Plain variables carry the logic, the signal only feeds rendering,
 * so decisions never read a signal write that has not flushed yet.
 */
export const createReveal = (zone: () => RevealZone | null): Reveal => {
    const [open, setOpen] = createSignal(false)
    let isOpen = false
    let hovering = false
    let focused = false
    let pinned = false
    let pending: boolean | null = null
    let timer: ReturnType<typeof setTimeout> | undefined

    const cancel = (): void => {
        clearTimeout(timer)
        timer = undefined
        pending = null
    }

    const apply = (next: boolean): void => {
        cancel()
        if (next === isOpen) return
        isOpen = next
        setOpen(next)
    }

    const settle = (immediate = false): void => {
        const current = zone()
        const want = current !== null && (hovering || focused || pinned)
        if (want === isOpen) {
            cancel()
            return
        }
        // Already on its way there: restarting the delay on every move would never let it land.
        if (pending === want) return
        const delay = immediate ? 0 : want ? current.openDelayMs : CLOSE_DELAY_MS
        if (delay === 0) {
            apply(want)
            return
        }
        cancel()
        pending = want
        timer = setTimeout(() => apply(want), delay)
    }

    return {
        open,
        isOpen: () => isOpen,
        pointer: (x, y) => {
            const current = zone()
            hovering = contains(current ? (isOpen ? current.keep : current.trigger) : null, x, y)
            settle()
        },
        leave: () => {
            hovering = false
            settle()
        },
        reveal: () => {
            if (zone() === null) return
            hovering = true
            settle(true)
        },
        setFocused: (next) => {
            focused = next
            settle(next)
        },
        setPinned: (next) => {
            pinned = next
            settle(next)
        },
        dismiss: () => {
            hovering = false
            if (!focused && !pinned) apply(false)
        },
        sync: () => {
            if (zone() === null) {
                hovering = false
                focused = false
                apply(false)
                return
            }
            settle()
        },
    }
}
