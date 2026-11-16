export type SettingsRoute =
    | "search"
    | "downloads"
    | "history"
    | "adblocking"
    | "extensions"
    | "appearance"

const SETTINGS_ROUTES: Record<string, SettingsRoute> = {
    "/search": "search",
    "/downloads": "downloads",
    "/history": "history",
    "/adblocking": "adblocking",
    "/extensions": "extensions",
    "/appearance": "appearance",
}

export const settingsRoute = (url: string): SettingsRoute => {
    try {
        return SETTINGS_ROUTES[new URL(url).pathname] ?? "search"
    } catch {
        return "search"
    }
}
