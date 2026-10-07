import { Deferred, Effect, Queue } from "effect"
import { BrowserWindow, session, type BrowserWindow as ParentWindow } from "electron"

import type { PermissionPromptRequest, RenameTarget } from "../../shared/protocol"
import { loadRenderer, preloadPath } from "./paths"

// --- omnibox popup

const POPUP_GAP = 6
const DEFAULT_HEIGHT = 160
const MAX_HEIGHT = 400

let popup: BrowserWindow | null = null
let anchor: { x: number; y: number; width: number } | null = null
let popupHeight = DEFAULT_HEIGHT
let lastQuery = ""

export const popupWebContents = (): Electron.WebContents | null =>
    popup && !popup.isDestroyed() ? popup.webContents : null

const repositionPopup = (win: ParentWindow): void => {
    if (!popup || popup.isDestroyed() || !anchor) return
    const bounds = win.getContentBounds()
    popup.setBounds({
        x: Math.round(bounds.x + anchor.x),
        y: Math.round(bounds.y + anchor.y - popupHeight - POPUP_GAP),
        width: Math.round(anchor.width),
        height: Math.round(popupHeight),
    })
}

export const showOmniboxPopup = (
    win: ParentWindow,
    rect: { x: number; y: number; width: number },
    query: string,
): void => {
    anchor = rect
    lastQuery = query
    if (!popup || popup.isDestroyed()) {
        const bounds = win.getContentBounds()
        popup = new BrowserWindow({
            x: Math.round(bounds.x + rect.x),
            y: Math.round(bounds.y + rect.y - popupHeight - POPUP_GAP),
            width: Math.round(rect.width),
            height: Math.round(popupHeight),
            show: false,
            frame: false,
            transparent: true,
            resizable: false,
            movable: false,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            skipTaskbar: true,
            focusable: false,
            hasShadow: false,
            parent: win,
            webPreferences: { preload: preloadPath },
        })
        popup.on("closed", () => {
            popup = null
        })
        // Queries sent while the popup renderer is still loading would be lost.
        popup.webContents.on("did-finish-load", () => {
            popup?.webContents.send("arbor:omnibox:query", lastQuery)
        })
        void loadRenderer(popup, "omnibox")
    }
    repositionPopup(win)
    popup.webContents.send("arbor:omnibox:query", lastQuery)
    popup.showInactive()
}

export const setOmniboxPopupHeight = (win: ParentWindow, height: number): void => {
    if (typeof height !== "number" || !Number.isFinite(height) || height <= 0) return
    popupHeight = Math.min(MAX_HEIGHT, Math.round(height))
    repositionPopup(win)
}

export const hideOmniboxPopup = (): void => {
    if (popup && !popup.isDestroyed()) popup.hide()
}

// --- extensions popup

const EXTENSIONS_POPUP_WIDTH = 320
const EXTENSIONS_POPUP_DEFAULT_HEIGHT = 72
const EXTENSIONS_POPUP_MAX_HEIGHT = 480

let extensionsPopup: BrowserWindow | null = null
let extensionsAnchor: { x: number; y: number; width: number } | null = null
let extensionsPopupHeight = EXTENSIONS_POPUP_DEFAULT_HEIGHT

const repositionExtensionsPopup = (win: ParentWindow): void => {
    if (!extensionsPopup || extensionsPopup.isDestroyed() || !extensionsAnchor) return
    const bounds = win.getContentBounds()
    extensionsPopup.setBounds({
        x: Math.round(
            bounds.x + extensionsAnchor.x + extensionsAnchor.width - EXTENSIONS_POPUP_WIDTH,
        ),
        y: Math.round(bounds.y + extensionsAnchor.y - extensionsPopupHeight - POPUP_GAP),
        width: EXTENSIONS_POPUP_WIDTH,
        height: Math.round(extensionsPopupHeight),
    })
}

export const toggleExtensionsPopup = (
    win: ParentWindow,
    rect: { x: number; y: number; width: number },
): void => {
    const open = extensionsPopup
    if (open && !open.isDestroyed()) {
        extensionsPopup = null
        open.destroy()
        return
    }
    extensionsAnchor = rect
    extensionsPopupHeight = EXTENSIONS_POPUP_DEFAULT_HEIGHT
    const bounds = win.getContentBounds()
    extensionsPopup = new BrowserWindow({
        x: Math.round(bounds.x + rect.x + rect.width - EXTENSIONS_POPUP_WIDTH),
        y: Math.round(bounds.y + rect.y - extensionsPopupHeight - POPUP_GAP),
        width: EXTENSIONS_POPUP_WIDTH,
        height: Math.round(extensionsPopupHeight),
        show: false,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        focusable: false,
        hasShadow: false,
        parent: win,
        webPreferences: { preload: preloadPath },
    })
    extensionsPopup.on("closed", () => {
        extensionsPopup = null
    })
    void loadRenderer(extensionsPopup, "extensions")
    repositionExtensionsPopup(win)
    extensionsPopup.showInactive()
}

export const setExtensionsPopupHeight = (win: ParentWindow, height: number): void => {
    if (typeof height !== "number" || !Number.isFinite(height) || height <= 0) return
    extensionsPopupHeight = Math.min(EXTENSIONS_POPUP_MAX_HEIGHT, Math.round(height))
    repositionExtensionsPopup(win)
}

export const hideExtensionsPopup = (): void => {
    const open = extensionsPopup
    if (open && !open.isDestroyed()) {
        extensionsPopup = null
        open.destroy()
    }
}

// --- extension action popups (chrome.action popup windows)

const EXTENSION_POPUP_MIN_WIDTH = 360
const EXTENSION_POPUP_MIN_HEIGHT = 480
const EXTENSION_POPUP_GAP = 5

/** Toolbar anchor for a pinned extension's action popup, in window content coords. */
type ExtensionAnchor = { x: number; y: number; width: number; height: number }

const extensionAnchors = new Map<string, ExtensionAnchor>()

/** Remember where a pinned toolbar icon sits so its action popup opens above it. */
export const setExtensionAnchor = (extensionId: string, rect: ExtensionAnchor): void => {
    extensionAnchors.set(extensionId, rect)
}

/** Shape of electron-chrome-extensions' PopupView used for re-anchoring. */
export interface ExtensionPopupView {
    parent?: Electron.BaseWindow
    browserWindow?: Electron.BrowserWindow
    extensionId?: string
}

export const isExtensionPopupView = (value: unknown): value is ExtensionPopupView =>
    typeof value === "object" && value !== null && "browserWindow" in value && "parent" in value

/** Apply the minimum size and place the popup above its anchor. */
const anchorAbove = (
    rect: Electron.Rectangle,
    parent: Electron.BaseWindow | undefined,
    extensionId: string | undefined,
): Electron.Rectangle => {
    const width = Math.max(rect.width, EXTENSION_POPUP_MIN_WIDTH)
    const height = Math.max(rect.height, EXTENSION_POPUP_MIN_HEIGHT)
    // Pinned toolbar icon when present, else the puzzle button that lists extensions.
    const target = (extensionId ? extensionAnchors.get(extensionId) : undefined) ?? extensionsAnchor
    if (!target || !parent || parent.isDestroyed()) return { x: rect.x, y: rect.y, width, height }
    const content = parent.getContentBounds()
    return {
        x: Math.round(content.x + target.x + target.width - width),
        y: Math.round(content.y + target.y - height - EXTENSION_POPUP_GAP),
        width,
        height,
    }
}

/**
 * Re-anchor action popups above the toolbar button
 * and enforce a readable minimum size.
 * Routes window.open from the popup through `onWindowOpen`
 * (some extension falls back to window.open when browser.tabs is missing).
 */
export const attachExtensionPopupPositioning = (
    view: ExtensionPopupView,
    onWindowOpen?: (url: string) => void,
): void => {
    const popupWin = view.browserWindow
    if (!popupWin || popupWin.isDestroyed()) return
    const origSetBounds = popupWin.setBounds.bind(popupWin)
    popupWin.setBounds = (rect: Electron.Rectangle): void => {
        origSetBounds(anchorAbove(rect, view.parent, view.extensionId))
    }
    popupWin.webContents.setWindowOpenHandler(({ url }) => {
        if (url && url !== "about:blank") onWindowOpen?.(url)
        return { action: "deny" }
    })
}

// --- pinned extension action popup

/**
 * A `chrome.action` popup opened by Arbor rather than by electron-chrome-extensions.
 *
 * The library can only open these for extensions and tabs sharing one session;
 * Arbor keeps extensions in the default session and tabs in per-Container sessions, so it cannot.
 */
let actionPopup: BrowserWindow | null = null
let actionPopupExtensionId: string | null = null

let dismissedAt = 0
let dismissedExtensionId: string | null = null
const DISMISS_WINDOW_MS = 400

const closeExtensionActionPopup = (extensionId?: string, markDismissed = false): void => {
    // records the close, so the click that caused it is not mistaken for a reopen
    if (actionPopup && !actionPopup.isDestroyed()) {
        if (markDismissed && extensionId) {
            dismissedAt = Date.now()
            dismissedExtensionId = extensionId
        }
        actionPopup.destroy()
    }
    actionPopup = null
    actionPopupExtensionId = null
}

export const openExtensionActionPopup = (
    win: BrowserWindow,
    extensionId: string,
    popupUrl: string,
    onWindowOpen: (url: string) => void,
): void => {
    // Clicking the same button again closes the popup.
    if (actionPopupExtensionId === extensionId) {
        closeExtensionActionPopup(extensionId)
        return
    }
    // Clicking the pinned button to close an open popup races with the popup's focus-loss close.
    if (dismissedExtensionId === extensionId && Date.now() - dismissedAt < DISMISS_WINDOW_MS) {
        dismissedExtensionId = null
        return
    }
    closeExtensionActionPopup()

    const bounds = win.getContentBounds()
    const actionWin = new BrowserWindow({
        x: bounds.x,
        y: bounds.y,
        width: EXTENSION_POPUP_MIN_WIDTH,
        height: EXTENSION_POPUP_MIN_HEIGHT,
        show: false,
        frame: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        hasShadow: true,
        parent: win,
        webPreferences: { session: session.defaultSession },
    })
    actionPopup = actionWin
    actionPopupExtensionId = extensionId

    actionWin.on("closed", () => {
        if (actionPopup === actionWin) {
            actionPopup = null
            actionPopupExtensionId = null
        }
    })
    // Anchor above the pinned button and keep a readable minimum size.
    attachExtensionPopupPositioning(
        { browserWindow: actionWin, parent: win, extensionId },
        onWindowOpen,
    )
    actionWin.setBounds(actionWin.getBounds())
    actionWin.show()
    actionWin.on("blur", () => closeExtensionActionPopup(extensionId, true))
    void actionWin.loadURL(popupUrl)
}

// --- rename modal

let modal: BrowserWindow | null = null
let pendingTarget: RenameTarget | null = null

export const closeRenameModal = (): void => {
    if (modal && !modal.isDestroyed()) modal.destroy()
    modal = null
    pendingTarget = null
}

export const repositionRenameModal = (win: BrowserWindow): void => {
    if (!modal || modal.isDestroyed()) return
    modal.setBounds(win.getContentBounds())
}

export const openRenameModal = (win: BrowserWindow, target: RenameTarget): void => {
    closeRenameModal()
    pendingTarget = target

    const bounds = win.getContentBounds()
    modal = new BrowserWindow({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        show: false,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        hasShadow: false,
        parent: win,
        webPreferences: { preload: preloadPath },
    })
    modal.on("closed", () => {
        modal = null
        pendingTarget = null
    })
    // The renderer registers its target listener during load; replay afterwards.
    modal.webContents.on("did-finish-load", () => {
        modal?.webContents.send("arbor:rename:target", pendingTarget)
    })
    void loadRenderer(modal, "rename")
    modal.show()
}

// --- permission prompt modal (extension install / permissions.request)

interface PromptJob {
    readonly request: PermissionPromptRequest
    readonly parent: BrowserWindow | null
    readonly answer: Deferred.Deferred<boolean>
}

const promptQueue = Effect.runSync(Queue.unbounded<PromptJob>())
let permissionModal: BrowserWindow | null = null
let activeAnswer: Deferred.Deferred<boolean> | null = null

const showPrompt = (job: PromptJob): void => {
    activeAnswer = job.answer
    const win = job.parent && !job.parent.isDestroyed() ? job.parent : null
    const bounds = win?.getContentBounds()
    const promptWindow = new BrowserWindow({
        x: bounds?.x,
        y: bounds?.y,
        width: bounds?.width,
        height: bounds?.height,
        show: false,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        hasShadow: false,
        ...(win ? { parent: win } : {}),
        webPreferences: { preload: preloadPath },
    })
    permissionModal = promptWindow
    promptWindow.on("closed", () => {
        if (permissionModal === promptWindow) {
            permissionModal = null
            activeAnswer = null
        }
        // Closing the dialog without answering is a refusal.
        // Idempotent: a prior settle via `respondPermissionPrompt` wins.
        void Effect.runSync(Deferred.succeed(job.answer, false))
    })
    // The renderer registers its request listener during load; replay afterwards.
    promptWindow.webContents.on("did-finish-load", () => {
        promptWindow.webContents.send("arbor:permission:request", job.request)
    })
    void loadRenderer(promptWindow, "permission")
    promptWindow.show()
}

const runPrompt = (job: PromptJob): Effect.Effect<void> =>
    Effect.suspend(() => {
        showPrompt(job)
        return Deferred.await(job.answer)
    }).pipe(
        Effect.asVoid,
        // Never leave a waiter hanging if window creation fails.
        Effect.ensuring(Deferred.succeed(job.answer, false)),
    )

// One prompt at a time: the consumer drains the queue serially.
Effect.runFork(
    Effect.forever(
        Effect.gen(function* () {
            const job = yield* Queue.take(promptQueue)
            yield* runPrompt(job).pipe(
                Effect.catchAllCause((cause) => Effect.logError("Permission prompt failed", cause)),
            )
        }),
    ),
)

/** Resolves `true` on Allow, `false` on Deny or when the dialog is closed. One at a time. */
export const openPermissionPrompt = (
    win: ParentWindow | null,
    request: PermissionPromptRequest,
): Effect.Effect<boolean> =>
    Effect.gen(function* () {
        const answer = yield* Deferred.make<boolean>()
        yield* Queue.offer(promptQueue, {
            request,
            parent: win && !win.isDestroyed() ? win : null,
            answer,
        })
        return yield* Deferred.await(answer)
    })

/** Answer for the visible prompt (`arbor:permission:respond`). */
export const respondPermissionPrompt = (allowed: boolean): void => {
    const answer = activeAnswer
    if (!answer) return
    activeAnswer = null
    const promptWindow = permissionModal
    permissionModal = null
    void Effect.runSync(Deferred.succeed(answer, allowed))
    if (promptWindow && !promptWindow.isDestroyed()) promptWindow.destroy()
}
