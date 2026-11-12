import { WebContentsView, type BrowserWindow } from "electron"

import type { RevealEdge } from "../../shared/protocol"
import { chromeInsets, REVEAL_EDGE, type ChromeInsets, type Settings } from "../../shared/settings"
import { preloadPath } from "./paths"

/**
 * The shell (sidebar and toolbar) renders in a transparent view of its own,
 * not in the window's webContents.
 *
 * A window's own webContents always paints beneath its child views,
 * so a sidebar drawn there could never slide over a page.
 * As a sibling of the tab views, the shell sits under the active tab while at rest,
 * and is raised above it while a hidden or compact bar is revealed.
 * Lowering it again hands the page its input back.
 */
export interface Shell {
    readonly view: WebContentsView
    /** Space the shell keeps along the left and bottom edges, from the current settings. */
    readonly insets: () => ChromeInsets
    readonly layout: () => void
    readonly focus: () => void
    readonly setRaised: (raised: boolean) => void
    /** Put the shell back in its place after a tab view was added. */
    readonly restack: () => void
    /** Tell the shell when the mouse reaches a hidden bar's edge of `page`. */
    readonly watchEdges: (page: WebContentsView) => void
}

const edgeAt = (
    settings: Settings,
    size: { width: number; height: number },
    point: { x: number; y: number },
): RevealEdge | null => {
    if (settings.sidebarVisibility === "hidden" && point.x <= REVEAL_EDGE) return "left"
    if (point.y <= REVEAL_EDGE) return "top"
    if (settings.urlBarVisibility === "hidden" && point.y >= size.height - REVEAL_EDGE) {
        return "bottom"
    }
    return null
}

export const createShell = (
    win: BrowserWindow,
    settings: () => Settings,
    onEdge: (edge: RevealEdge) => void,
): Shell => {
    const view = new WebContentsView({ webPreferences: { preload: preloadPath } })
    view.setBackgroundColor("#00000000")
    win.contentView.addChildView(view)
    let raised = false
    let lastEdge: RevealEdge | null = null

    const alive = (): boolean => !win.isDestroyed()

    const restack = (): void => {
        if (!alive()) return
        const { children } = win.contentView
        if (raised) {
            // Adding a view that is already a child moves it to the top.
            if (children.at(-1) !== view) win.contentView.addChildView(view)
            return
        }
        for (const child of children) {
            if (child !== view) win.contentView.addChildView(child)
        }
    }

    const shell: Shell = {
        view,
        insets: () => chromeInsets(settings()),
        layout: () => {
            if (!alive()) return
            const { width, height } = win.getContentBounds()
            view.setBounds({ x: 0, y: 0, width, height })
        },
        focus: () => {
            if (!alive()) return
            win.focus()
            view.webContents.focus()
        },
        setRaised: (next) => {
            raised = next
            lastEdge = null
            restack()
        },
        restack,
        watchEdges: (page) => {
            page.webContents.on("before-mouse-event", (_event, mouse) => {
                if (raised) return
                if (mouse.type === "mouseLeave") {
                    lastEdge = null
                    return
                }
                if (mouse.type !== "mouseMove") return
                const edge = edgeAt(settings(), page.getBounds(), mouse)
                if (edge === lastEdge) return
                lastEdge = edge
                if (edge !== null) onEdge(edge)
            })
        },
    }
    shell.layout()
    return shell
}
