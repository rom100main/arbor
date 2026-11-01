import { Context, Deferred, Effect, Layer } from "effect"
import type { BrowserWindow, WebContents } from "electron"

import type { UnknownTab } from "../../shared/errors"
import type { TabId } from "../../shared/protocol"
import type { ViewHandle } from "./host"
import type { Overlays } from "./overlays"

/** What the WindowManager hands over once the window is open. */
export interface WindowParts {
    readonly native: BrowserWindow
    readonly overlays: Overlays
    readonly ensureTabView: (tabId: TabId) => Effect.Effect<ViewHandle, UnknownTab>
    readonly tabIdFor: (webContents: WebContents) => TabId | null
}

/**
 * The main window, for code outside the WindowManager.
 * There is one window per run, open from just after startup until quit,
 * so every operation waits for it at startup and never meets "no window" after.
 */
export interface CurrentWindowService {
    /** The Electron window: the permission modal's parent, native menus, `chrome.tabs.create`. */
    readonly native: Effect.Effect<BrowserWindow>
    readonly overlays: Effect.Effect<Overlays>
    /** The tab's view, created now if needed: `chrome.tabs.create` needs it before the next render. */
    readonly ensureTabView: (tabId: TabId) => Effect.Effect<ViewHandle, UnknownTab>
    /** Which tab shows `webContents`, if any. */
    readonly tabIdFor: (webContents: WebContents) => Effect.Effect<TabId | null>
    /** Called once by the WindowManager, when the window has opened. */
    readonly opened: (parts: WindowParts) => Effect.Effect<void>
}

/**
 * Its own service, not part of the WindowManager:
 * the Extensions module and the permission modal need the window, and the WindowManager needs them.
 */
export class CurrentWindow extends Context.Service<CurrentWindow, CurrentWindowService>()(
    "arbor.CurrentWindow",
) {
    static readonly layer = Layer.effect(
        CurrentWindow,
        Effect.gen(function* () {
            const parts = yield* Deferred.make<WindowParts>()
            const window = Deferred.await(parts)
            return {
                native: Effect.map(window, (w) => w.native),
                overlays: Effect.map(window, (w) => w.overlays),
                ensureTabView: (tabId) => Effect.flatMap(window, (w) => w.ensureTabView(tabId)),
                tabIdFor: (webContents) => Effect.map(window, (w) => w.tabIdFor(webContents)),
                opened: (next) => Effect.asVoid(Deferred.succeed(parts, next)),
            }
        }),
    )
}
