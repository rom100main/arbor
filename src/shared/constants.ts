// Should be Effect free

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
    "photo",
    "folder",
    "link",
    "device-desktop",
    "clock",
    "sun",
] as const

/** The session partition of a container: one per container, so containers share nothing. */
export const containerPartition = (id: `container-${string}`): string => `persist:container-${id}`

export const NEW_TAB_FAVORITES_FOLDER_ID = "favorite-newtab" as const
export const NEW_TAB_FAVORITES_FOLDER_NAME = "New Tab"

/** The protected favorites folders: they always exist and cannot be deleted, moved or renamed. */
export const PROTECTED_FAVORITES_FOLDERS = [
    { id: NEW_TAB_FAVORITES_FOLDER_ID, name: NEW_TAB_FAVORITES_FOLDER_NAME },
] as const

const PROTECTED_FAVORITES_FOLDER_IDS: ReadonlySet<string> = new Set(
    PROTECTED_FAVORITES_FOLDERS.map((folder) => folder.id),
)

export const isProtectedFavoritesFolderId = (id: string): boolean =>
    PROTECTED_FAVORITES_FOLDER_IDS.has(id)
