/** The types the WindowManager and the Electron window code (`electron-host.ts`) share. */

import { Schema, type Effect, type Scope, type Stream } from "effect"
import type { BrowserWindow, WebContents } from "electron"

import { isInternalUrl } from "../../shared/internal-pages"
import type { ContainerId, TabId } from "../../shared/protocol"
import type { Overlays } from "./overlays"

/** Which session a tab loads in: Arbor's own for `arbor://`, its Container's otherwise. */
export type SessionKey =
    | { readonly kind: "container"; readonly containerId: ContainerId }
    | { readonly kind: "internal" }

export const sessionKeyFor = (tab: {
    readonly containerId: ContainerId
    readonly url: string
}): SessionKey =>
    isInternalUrl(tab.url)
        ? { kind: "internal" }
        : { kind: "container", containerId: tab.containerId }

export const sameSessionKey = (a: SessionKey, b: SessionKey): boolean =>
    a.kind === "internal"
        ? b.kind === "internal"
        : b.kind === "container" && a.containerId === b.containerId

/** A failed page load. `errno` is Chromium's net error (e.g. -105 ERR_NAME_NOT_RESOLVED), 0 when unknown. */
export class LoadFailed extends Schema.TaggedError<LoadFailed>()("LoadFailed", {
    url: Schema.String,
    errno: Schema.Number,
}) {}

/** A tab's page view. Its session never changes: another key needs another view. */
export interface ViewHandle {
    readonly tabId: TabId
    readonly sessionKey: SessionKey
    readonly webContents: WebContents
}

/** What a page tells Arbor about itself. */
export type ViewEvent =
    | { readonly kind: "title"; readonly tabId: TabId; readonly title: string }
    | { readonly kind: "navigated"; readonly tabId: TabId; readonly url: string }
    | { readonly kind: "navigatedInPage"; readonly tabId: TabId; readonly url: string }
    | { readonly kind: "favicon"; readonly tabId: TabId; readonly favicon: string | null }
    | {
          readonly kind: "openChild"
          readonly tabId: TabId
          readonly url: string
          readonly background: boolean
      }

export type HistoryStep = "back" | "forward" | "reload"

export interface WindowHandle {
    readonly native: BrowserWindow
    /** The popups and the rename modal over this window. They close with it. */
    readonly overlays: Overlays
    /** Completes when the user closes the window. */
    readonly closed: Effect.Effect<void>
    readonly loadShell: Effect.Effect<void>
    readonly focus: Effect.Effect<void>
    readonly createView: (tabId: TabId, sessionKey: SessionKey) => Effect.Effect<ViewHandle>
    /** Put tab view above the other, below the shell. */
    readonly show: (view: ViewHandle) => Effect.Effect<void>
    readonly close: (view: ViewHandle) => Effect.Effect<void>
    /** Resolves when the page has loaded. A load replaced by another navigation is not a failure. */
    readonly load: (view: ViewHandle, url: string) => Effect.Effect<void, LoadFailed>
    readonly history: (view: ViewHandle, step: HistoryStep) => Effect.Effect<void>
    /** Every view's events, for the life of the window. */
    readonly viewEvents: Stream.Stream<ViewEvent>
    /** A revealed bar floats over the page, so the shell rises above it while one is out. */
    readonly raiseShell: (raised: boolean) => Effect.Effect<void>
    /** Give the shell keyboard focus (before focusing the address bar). */
    readonly focusShell: Effect.Effect<void>
}

/** What the application menu shows. Compared by value, so an unchanged menu is not rebuilt. */
export interface MenuModel {
    readonly containerNames: ReadonlyArray<string>
    readonly canCloseTab: boolean
    readonly canReopenTab: boolean
}

export type MenuAction =
    | { readonly kind: "newTab" }
    | { readonly kind: "newContainer" }
    | { readonly kind: "focusAddressBar" }
    | { readonly kind: "focusTabTree" }
    | { readonly kind: "closeTab" }
    | { readonly kind: "reopenTab" }
    | { readonly kind: "stepTab"; readonly delta: 1 | -1 }
    | { readonly kind: "switchContainer"; readonly index: number }
    | { readonly kind: "history"; readonly step: HistoryStep }

export interface WindowHostService {
    readonly open: Effect.Effect<WindowHandle, never, Scope.Scope>
    /** Arbor was launched again: the second instance quit at once, and this one should come forward. */
    readonly relaunches: Stream.Stream<void>
    /** Replace the application menu. `run` is called with the item the user picked. */
    readonly setMenu: (model: MenuModel, run: (action: MenuAction) => void) => Effect.Effect<void>
}
