import path from "node:path"
import { pathToFileURL } from "node:url"

import { Effect } from "effect"
import { net, protocol, session, type Session } from "electron"

import { HISTORY_URL, INTERNAL_SCHEME, SETTINGS_URL } from "../../shared/settings"
import { AppRuntime } from "../runtime"
import {
    assetRelativePath,
    injectDocumentHead,
    devAssetUrl,
    internalFavicon,
    isAssetRequest,
    isHistoryUrl,
    isInternalPageUrl,
    isInternalUrl,
} from "./internal-page-urls"
import { preloadPath, rendererPath } from "./paths"

const INTERNAL_PARTITION = "arbor:internal"

/** The session `arbor://` resolves on. Never a Container's partition. Electron returns the same one each time. */
export const internalSession = (): Session => session.fromPartition(INTERNAL_PARTITION)

/**
 * Must run before `app.whenReady()`.
 * `standard` gives the scheme a real origin so the bundle's `type="module"` script loads;
 * without it the page is opaque-origin and the module fetch is blocked.
 */
export const registerInternalScheme = (): void => {
    protocol.registerSchemesAsPrivileged([
        {
            scheme: INTERNAL_SCHEME,
            privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
        },
    ])
}

const devServerOrigin = (): string | null => process.env.VITE_DEV_SERVER_URL ?? null

const clientDir = (): string => path.dirname(rendererPath)

/**
 * Head material the built document does not carry.
 *
 * The `<base href>` keeps relative assets resolving to `/assets/...` however deep the route is,
 * so adding a nested section cannot quietly turn the page into a blank one.
 * The `<title>` is what `trackPageMeta` reads to label the tab,
 * and the icon keeps the sidebar row from falling back to the grey globe placeholder.
 */
const headExtras = (url: string): string => {
    const favicon = internalFavicon(url) ?? ""
    return isHistoryUrl(url)
        ? `<base href="${HISTORY_URL}/">` +
              `<title>History</title>` +
              `<link rel="icon" href="${favicon}">`
        : `<base href="${SETTINGS_URL}/">` +
              `<title>Settings</title>` +
              `<link rel="icon" href="${favicon}">`
}

const serveDocument = async (requestUrl: string): Promise<Response> => {
    const devServer = devServerOrigin()
    try {
        const response = await net.fetch(devServer ?? pathToFileURL(rendererPath).href, {
            headers: { Accept: "text/html" },
        })
        if (!response.ok) return new Response("Not found", { status: 404 })
        return new Response(injectDocumentHead(await response.text(), headExtras(requestUrl)), {
            headers: { "content-type": "text/html; charset=utf-8" },
        })
    } catch (error) {
        AppRuntime.runSync(Effect.logError(`Failed to serve ${INTERNAL_SCHEME} document`, error))
        return new Response("Not found", { status: 404 })
    }
}

/**
 * The base href already made asset paths bundle-relative,
 *  so the pathname minus its leading slash is the file path.
 * Guarded so nothing can climb out of the bundle root.
 */
const serveAsset = async (pathname: string, search: string): Promise<Response> => {
    const safe = assetRelativePath(pathname)
    if (safe === null) return new Response("Not found", { status: 404 })

    const devServer = devServerOrigin()
    const source =
        (devServer ? devAssetUrl(devServer, safe, search) : null) ??
        pathToFileURL(path.join(clientDir(), safe)).href
    try {
        return await net.fetch(source)
    } catch (error) {
        AppRuntime.runSync(
            Effect.logError(`Failed to serve ${INTERNAL_SCHEME} asset ${safe}`, error),
        )
        return new Response("Not found", { status: 404 })
    }
}

/**
 * Register the `arbor://` handler and the internal session's preload. Must run after `app.whenReady()`.
 *
 * Unknown paths below an internal host fall through to the SPA so deep links resolve;
 * anything outside is a 404 rather than a silent blank page.
 */
export const registerInternalPages = (): void => {
    const ses = internalSession()
    // Session-scoped, so a web page in a Container session never gets this bridge.
    ses.registerPreloadScript({
        id: "arbor-internal-preload",
        type: "frame",
        filePath: preloadPath,
    })
    // Internal pages are local-only: no container session can reach them, and they cannot reach the network.
    ses.webRequest.onBeforeRequest((details, callback) => {
        callback({ cancel: !isInternalUrl(details.url) })
    })

    if (ses.protocol.isProtocolHandled(INTERNAL_SCHEME)) return
    // Registered on the internal session, not the module-level `protocol`:
    // a global `protocol.handle` only covers the default session,
    // so a partitioned view fails to load with ERR_FAILED.
    ses.protocol.handle(INTERNAL_SCHEME, async (request) => {
        const { pathname, search } = new URL(request.url)
        if (!isInternalPageUrl(request.url)) return new Response("Not found", { status: 404 })
        return isAssetRequest(pathname) ? serveAsset(pathname, search) : serveDocument(request.url)
    })
}
