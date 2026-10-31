import { WebContentsView, type BrowserWindow, type WebContents } from "electron"

import type { RevealEdge } from "../../shared/protocol"
import { chromeInsets, REVEAL_EDGE, type ChromeInsets, type Settings } from "../../shared/settings"
import type { Pusher } from "../ipc/router"
import { loadRenderer, preloadPath } from "./paths"

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
interface Shell {
    readonly win: BrowserWindow
    readonly view: WebContentsView
    readonly getSettings: () => Settings
    raised: boolean
}

let shell: Shell | null = null

let lastEdge: RevealEdge | null = null

export const createShellView = async (
    win: BrowserWindow,
    getSettings: () => Settings,
    ipc: Pusher,
): Promise<WebContentsView> => {
    const view = new WebContentsView({ webPreferences: { preload: preloadPath } })
    ipc.attach(view.webContents)
    view.setBackgroundColor("#00000000")
    win.contentView.addChildView(view)
    const current: Shell = { win, view, getSettings, raised: false }
    shell = current
    win.on("closed", () => {
        if (shell === current) shell = null
    })
    layoutShell()
    await loadRenderer(view.webContents)
    return view
}

export const shellWebContents = (): WebContents | null =>
    shell && !shell.view.webContents.isDestroyed() ? shell.view.webContents : null

export const focusShell = (): void => {
    if (!shell || shell.win.isDestroyed()) return
    shell.win.focus()
    shell.view.webContents.focus()
}

export const shellInsets = (): ChromeInsets =>
    chromeInsets(
        shell
            ? shell.getSettings()
            : { sidebarVisibility: "displayed", urlBarVisibility: "displayed" },
    )

export const layoutShell = (): void => {
    if (!shell || shell.win.isDestroyed()) return
    const { width, height } = shell.win.getContentBounds()
    shell.view.setBounds({ x: 0, y: 0, width, height })
}

export const setShellRaised = (raised: boolean): void => {
    if (!shell) return
    shell.raised = raised
    lastEdge = null
    restackShell()
}

export const restackShell = (): void => {
    if (!shell || shell.win.isDestroyed()) return
    const { win, view, raised } = shell
    const { children } = win.contentView
    if (raised) {
        if (children.at(-1) !== view) win.contentView.addChildView(view) // if view already in the windows is moved instead
        return
    }
    for (const child of children) {
        if (child !== view) win.contentView.addChildView(child)
    }
}

const edgeAt = (
    settings: Settings,
    size: { width: number; height: number },
    point: { x: number; y: number },
): RevealEdge | null => {
    if (settings.sidebarVisibility === "hidden" && point.x <= REVEAL_EDGE) return "left"
    if (settings.urlBarVisibility === "hidden" && point.y >= size.height - REVEAL_EDGE) {
        return "bottom"
    }
    return null
}

export const watchShellEdges = (view: WebContentsView, ipc: Pusher): void => {
    view.webContents.on("before-mouse-event", (_event, mouse) => {
        if (!shell || shell.raised) return
        if (mouse.type === "mouseLeave") {
            lastEdge = null
            return
        }
        if (mouse.type !== "mouseMove") return
        const edge = edgeAt(shell.getSettings(), view.getBounds(), mouse)
        if (edge === lastEdge) return
        lastEdge = edge
        if (edge !== null) ipc.push("shellEdge", edge)
    })
}
