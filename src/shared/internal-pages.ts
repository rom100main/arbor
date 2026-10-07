import { INTERNAL_SCHEME, SETTINGS_PATH } from "./settings"

/**
 * Pages Arbor serves itself over `arbor://`.
 * Pure URL shapes only, the session and protocol wiring lives in `main/windows/internal-pages.ts`.
 */
export type SettingsRoute = "search" | "appearance"

const SETTINGS_ROUTES: Record<string, SettingsRoute> = {
    "/search": "search",
    "/appearance": "appearance",
}

export const SETTINGS_ROUTE_NAMES = Object.values(SETTINGS_ROUTES)

export const isInternalUrl = (url: string): boolean => url.startsWith(`${INTERNAL_SCHEME}://`)

export const isSettingsUrl = (url: string): boolean => {
    if (!isInternalUrl(url)) return false
    try {
        return new URL(url).hostname === "settings"
    } catch {
        return false
    }
}

export const settingsRoute = (url: string): SettingsRoute => {
    try {
        return SETTINGS_ROUTES[new URL(url).pathname] ?? "search"
    } catch {
        return "search"
    }
}

export const isSettingsDocument = (pathname: string): boolean =>
    pathname === "/" || pathname in SETTINGS_ROUTES

export const isAssetRequest = (pathname: string): boolean => !isSettingsDocument(pathname)

export const assetRelativePath = (pathname: string): string | null => {
    const relative = pathname.replace(/^\/+/, "")
    if (relative.length === 0) return null
    if (relative.split("/").some((part) => part === ".." || part === "")) return null
    return relative
}

/**
 * Inject head material into a served document.
 *
 * So we can have correct `<base href>`.
 * For custom `<title>` and favicon.
 */
export const injectDocumentHead = (html: string, extras: string): string => {
    if (html.includes("<head>")) return html.replace("<head>", `<head>${extras}`)
    if (html.includes("<body>")) return html.replace("<body>", `${extras}<body>`)
    return extras + html
}

/**
 * URL of a build or dev-server asset.
 *
 * Remove trailing slash but keep parameters.
 * Because `VITE_DEV_SERVER_URL` arrives with a trailing slash.
 */
export const devAssetUrl = (devServer: string, assetPath: string, search = ""): string =>
    `${devServer.replace(/\/+$/, "")}/${assetPath}${search}`

export { SETTINGS_PATH }
