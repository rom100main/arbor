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
] as const

export type ContainerIcon = (typeof CONTAINER_ICONS)[number]

/** The session partition of a container: one per container, so containers share nothing. */
export const containerPartition = (id: `container-${string}`): string => `persist:container-${id}`
