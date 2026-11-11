export type SettingsRoute = "search" | "downloads" | "history" | "appearance"

const SETTINGS_ROUTES: Record<string, SettingsRoute> = {
    "/search": "search",
    "/downloads": "downloads",
    "/history": "history",
    "/appearance": "appearance",
}

export const settingsRoute = (url: string): SettingsRoute => {
    try {
        return SETTINGS_ROUTES[new URL(url).pathname] ?? "search"
    } catch {
        return "search"
    }
}
