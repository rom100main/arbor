import { INTERNAL_SCHEME } from "../../shared/settings"

/**
 * URL helpers for the pages Arbor serves itself over `arbor://`.
 * The route names match `renderer/settings/routes.ts`, which parses the same URLs.
 */
const SETTINGS_DOCUMENT_PATHS = new Set(["/", "/search", "/downloads", "/history", "/appearance"])

export const isInternalUrl = (url: string): boolean => url.startsWith(`${INTERNAL_SCHEME}://`)

export const isSettingsUrl = (url: string): boolean => {
    if (!isInternalUrl(url)) return false
    try {
        return new URL(url).hostname === "settings"
    } catch {
        return false
    }
}

export const isHistoryUrl = (url: string): boolean => {
    if (!isInternalUrl(url)) return false
    try {
        return new URL(url).hostname === "history"
    } catch {
        return false
    }
}

/** Any `arbor://` page Arbor serves itself (settings or history). */
export const isInternalPageUrl = (url: string): boolean => isSettingsUrl(url) || isHistoryUrl(url)

const isSettingsDocument = (pathname: string): boolean => SETTINGS_DOCUMENT_PATHS.has(pathname)

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
