export type ContainerId = string
export type TabId = string

export interface ContainerMeta {
    id: ContainerId
    name: string
    color: string
    icon: ContainerIcon
    activeTabId: TabId | null
}

export interface TabNode {
    id: TabId
    containerId: ContainerId
    parentId: TabId | null
    order: number
    url: string
    title: string
    collapsed: boolean
    userLabel: string | null
    favicon: string | null
    /** Epoch ms of the last time this tab was active; ranks omnibox suggestions. */
    lastActiveAt: number
}

export interface ClosedSubtree {
    /** Removed tab followed by its descendants, parents before children. */
    nodes: TabNode[]
    containerId: ContainerId
    parentIdBefore: TabId | null
    indexBefore: number
    /** Present when the container auto-deleted after this close. */
    containerMetaBefore: ContainerMeta | null
}

/** A permission scope the user has consented to for one extension. */
export interface ExtensionGrant {
    permissions: string[]
    origins: string[]
}

export type PermissionPromptKind = "install" | "request"

/** Payload for the Allow / Deny permission modal (`?permission` window). */
export interface PermissionPromptRequest {
    kind: PermissionPromptKind
    id: string
    name: string
    permissions: string[]
    origins: string[]
    /** `NativeImage.toDataURL()` for install prompts; request prompts use crx:// icons. */
    icon?: string | null
}

/** Right-click on an extension icon: open its native menu at the cursor. */
export interface ExtensionMenuRequest {
    extensionId: string
    /** Screen coords (not viewport): what `Menu.popup` expects. */
    screenX: number
    screenY: number
}

export interface BrowserSnapshot {
    containers: ContainerMeta[]
    tabs: TabNode[]
    activeContainerId: ContainerId | null
    activeTabId: TabId | null
    pinnedExtensionIds: string[]
}

export interface DisplayTab extends TabNode {
    depth: number
}

export type OmniboxActivation = { kind: "go"; query: string } | { kind: "tab"; tabId: TabId }

export type RenameTarget =
    | { kind: "container"; container: ContainerMeta }
    | { kind: "tab"; tab: TabNode }

export const CONTAINER_COLORS = [
    "#ef4444",
    "#f97316",
    "#eab308",
    "#22c55e",
    "#06b6d4",
    "#3b82f6",
    "#8b5cf6",
    "#ec4899",
] as const

export const CONTAINER_ICONS = [
    "world",
    "briefcase",
    "home",
    "shopping-cart",
    "code",
    "book",
    "news",
    "music",
    "movie",
    "mail",
    "puzzle",
    "star",
] as const

export type ContainerIcon = (typeof CONTAINER_ICONS)[number]
