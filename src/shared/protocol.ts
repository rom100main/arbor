/**
 * Every shape that crosses between processes or onto disk, as a Schema and types derive from them.
 * The renderer and preload import from here with `import type` only: runtime values live in `constants.ts`.
 */
import { Schema } from "effect"

import { CONTAINER_ICONS } from "./constants"

export const TabId = Schema.TemplateLiteral(["tab-", Schema.String])
export type TabId = typeof TabId.Type

export const ContainerId = Schema.TemplateLiteral(["container-", Schema.String])
export type ContainerId = typeof ContainerId.Type

export const ContainerIcon = Schema.Literals(CONTAINER_ICONS)
export type ContainerIcon = typeof ContainerIcon.Type

export const ContainerMeta = Schema.Struct({
    id: ContainerId,
    name: Schema.String,
    color: Schema.String,
    icon: ContainerIcon,
    activeTabId: Schema.NullOr(TabId),
})
export type ContainerMeta = typeof ContainerMeta.Type

export const TabNode = Schema.Struct({
    id: TabId,
    containerId: ContainerId,
    parentId: Schema.NullOr(TabId),
    order: Schema.Finite,
    url: Schema.String,
    title: Schema.String,
    collapsed: Schema.Boolean,
    userLabel: Schema.NullOr(Schema.String),
    favicon: Schema.NullOr(Schema.String),
    /** Epoch ms of the last time this tab was active to ranks omnibox suggestions. */
    lastActiveAt: Schema.Finite,
})
export type TabNode = typeof TabNode.Type

export const ClosedSubtree = Schema.Struct({
    /** Removed tab followed by its descendants, parents before children. */
    nodes: Schema.Array(TabNode),
    containerId: ContainerId,
    parentIdBefore: Schema.NullOr(TabId),
    indexBefore: Schema.Finite,
    /** Present when the container auto-deleted after this close. */
    containerMetaBefore: Schema.NullOr(ContainerMeta),
})
export type ClosedSubtree = typeof ClosedSubtree.Type

export const ExtensionGrant = Schema.Struct({
    permissions: Schema.Array(Schema.String),
    origins: Schema.Array(Schema.String),
})
export type ExtensionGrant = typeof ExtensionGrant.Type

export const PermissionPromptKind = Schema.Literals(["install", "request"])
export type PermissionPromptKind = typeof PermissionPromptKind.Type

export const PermissionPromptRequest = Schema.Struct({
    kind: PermissionPromptKind,
    id: Schema.String,
    name: Schema.String,
    permissions: Schema.Array(Schema.String),
    origins: Schema.Array(Schema.String),
    /** `NativeImage.toDataURL()` for install prompts; request prompts use crx:// icons. */
    icon: Schema.optionalKey(Schema.NullOr(Schema.String)),
})
export type PermissionPromptRequest = typeof PermissionPromptRequest.Type

/**
 * A pinned extension's toolbar button, built from its manifest.
 *
 * Arbor assembles this itself rather than asking electron-chrome-extensions:
 * the library keeps extensions and tabs in one session,
 * and Arbor keeps them apart by design.
 */
export const PinnedActionInfo = Schema.Struct({
    extensionId: Schema.String,
    /** `action.default_title`, else the extension name. */
    title: Schema.String,
    /** Data URL for the action icon, or `null` when no icon file can be resolved. */
    iconDataUrl: Schema.NullOr(Schema.String),
    /** Absolute `chrome-extension://` popup URL, or `null` when the action has no popup. */
    popupUrl: Schema.NullOr(Schema.String),
})
export type PinnedActionInfo = typeof PinnedActionInfo.Type

/** Right-click on an extension icon: open its native menu at the cursor. */
export const ExtensionMenuRequest = Schema.Struct({
    extensionId: Schema.String,
    /** Screen coords (not viewport): what `Menu.popup` expects. */
    screenX: Schema.Finite,
    screenY: Schema.Finite,
})
export type ExtensionMenuRequest = typeof ExtensionMenuRequest.Type

export const BrowserSnapshot = Schema.Struct({
    containers: Schema.Array(ContainerMeta),
    tabs: Schema.Array(TabNode),
    activeContainerId: Schema.NullOr(ContainerId),
    activeTabId: Schema.NullOr(TabId),
})
export type BrowserSnapshot = typeof BrowserSnapshot.Type

export interface DisplayTab extends TabNode {
    readonly depth: number
}

export const HistoryEntryId = Schema.TemplateLiteral(["history-", Schema.String])
export type HistoryEntryId = typeof HistoryEntryId.Type

/** One deduplicated visited page, across containers.
 * `containerId` is display metadata only:
 * it may dangle after the container is deleted, and the entry stays valid. */
export const HistoryEntry = Schema.Struct({
    id: HistoryEntryId,
    url: Schema.String,
    title: Schema.String,
    favicon: Schema.NullOr(Schema.String),
    containerId: ContainerId,
    /** Epoch ms. */
    firstVisitedAt: Schema.Finite,
    /** Epoch ms. */
    lastVisitedAt: Schema.Finite,
    visitCount: Schema.Finite,
})
export type HistoryEntry = typeof HistoryEntry.Type

export const HistorySnapshot = Schema.Struct({
    /** Newest `lastVisitedAt` first. */
    entries: Schema.Array(HistoryEntry),
    /** Count before any query filter, for empty states. */
    totalCount: Schema.Finite,
})
export type HistorySnapshot = typeof HistorySnapshot.Type

export const HistoryQuery = Schema.Struct({
    query: Schema.optionalKey(Schema.String),
    containerId: Schema.optionalKey(ContainerId),
})
export type HistoryQuery = typeof HistoryQuery.Type

export const OmniboxActivation = Schema.Union([
    Schema.Struct({ kind: Schema.Literal("go"), query: Schema.String }),
    Schema.Struct({ kind: Schema.Literal("tab"), tabId: TabId }),
    Schema.Struct({ kind: Schema.Literal("history"), entryId: HistoryEntryId }),
])
export type OmniboxActivation = typeof OmniboxActivation.Type

export const RevealEdge = Schema.Literals(["left", "bottom", "top"])
export type RevealEdge = typeof RevealEdge.Type

/** Where the app update stands. The toolbar shows a button for `ready` and `manual`. */
export const UpdateStatus = Schema.Union([
    Schema.Struct({ kind: Schema.Literal("idle") }),
    Schema.Struct({ kind: Schema.Literal("downloading"), percent: Schema.Finite }),
    // Downloaded: one click quits, installs and relaunches.
    Schema.Struct({ kind: Schema.Literal("ready"), version: Schema.String }),
    // This build cannot install in place (unsigned macOS): the click opens the release page.
    Schema.Struct({ kind: Schema.Literal("manual"), version: Schema.String, url: Schema.String }),
])
export type UpdateStatus = typeof UpdateStatus.Type

export const DownloadId = Schema.TemplateLiteral(["download-", Schema.String])
export type DownloadId = typeof DownloadId.Type

export const DownloadState = Schema.Literals([
    "pending", // waiting for the user to pick a location
    "progressing",
    "completed",
    "cancelled",
    "interrupted",
])
export type DownloadState = typeof DownloadState.Type

export const DownloadInfo = Schema.Struct({
    id: DownloadId,
    /** Suggested name from the server, also used before a path is known. */
    filename: Schema.String,
    /** Absolute path on disk, once chosen. Null while pending. */
    savePath: Schema.NullOr(Schema.String),
    url: Schema.String,
    state: DownloadState,
    receivedBytes: Schema.Finite,
    /** 0 when the server sends no Content-Length. */
    totalBytes: Schema.Finite,
    /** Epoch ms. */
    startedAt: Schema.Finite,
    finishedAt: Schema.NullOr(Schema.Finite),
})
export type DownloadInfo = typeof DownloadInfo.Type

export const DownloadsSnapshot = Schema.Struct({
    items: Schema.Array(DownloadInfo),
    /** The folder automatic mode writes to, so the UI can show and open it. */
    folder: Schema.String,
})
export type DownloadsSnapshot = typeof DownloadsSnapshot.Type

export const RenameTarget = Schema.Union([
    Schema.Struct({ kind: Schema.Literal("container"), container: ContainerMeta }),
    Schema.Struct({ kind: Schema.Literal("tab"), tab: TabNode }),
])
export type RenameTarget = typeof RenameTarget.Type

/** Where a popup hangs from, in window coordinates: its left edge, top and width. */
export const Anchor = Schema.Struct({
    x: Schema.Finite,
    y: Schema.Finite,
    width: Schema.Finite,
})
export type Anchor = typeof Anchor.Type

/** A box in window coordinates. */
export const Rect = Schema.Struct({
    ...Anchor.fields,
    height: Schema.Finite,
})
export type Rect = typeof Rect.Type
