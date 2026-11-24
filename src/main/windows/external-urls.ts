/**
 * Links the OS hands to Arbor because it is the default http(s) browser.
 *
 * Each platform delivers them differently:
 * - macOS fires `open-url`, which can fire before `app.whenReady()`,
 *   so the listener is registered at once,
 *   and events arriving before anyone subscribes wait in `pending`.
 * - Windows and Linux pass the URL as a command-line argument:
 *   `process.argv` on the first launch,
 *   `second-instance`'s command line on later ones.
 */

import { app } from "electron"

/** True for an `http://` / `https://` URL with a host. Only those become tabs. */
export const isBrowserUrl = (value: string): boolean => {
    if (value.length === 0) return false
    try {
        const url = new URL(value)
        return (url.protocol === "http:" || url.protocol === "https:") && url.host.length > 0
    } catch {
        return false
    }
}

/**
 * The browser URLs in a launch argument list, in order, without duplicates.
 * The executable path, the app path and flags are simply not URLs.
 */
export const urlsFromCommandLine = (args: readonly string[]): string[] => {
    const urls: string[] = []
    const seen = new Set<string>()
    for (const arg of args) {
        if (isBrowserUrl(arg) && !seen.has(arg)) {
            seen.add(arg)
            urls.push(arg)
        }
    }
    return urls
}

/** What the OS asked this launch to open (`process.argv` on Windows/Linux). */
export const initialLaunchUrls = (): string[] => urlsFromCommandLine(process.argv.slice(1))

/** URLs received so far that no subscriber has been handed yet. */
const pending: string[] = []
const listeners = new Set<(batch: string[]) => void>()
let captured = false

const flush = (): void => {
    if (listeners.size === 0 || pending.length === 0) return
    const batch = pending.splice(0)
    for (const listener of listeners) listener(batch)
}

/**
 * Register the macOS `open-url` listener.
 * Must run before `app.whenReady()`:
 * a link that starts Arbor can fire before the app is ready.
 */
export const captureOpenUrlsEarly = (): void => {
    if (captured) return
    captured = true
    app.on("open-url", (event, url) => {
        event.preventDefault()
        if (!isBrowserUrl(url)) return
        pending.push(url)
        flush()
    })
}

/**
 * Hand every captured URL to `listener`, once each, including the ones captured before subscribing.
 * Returns an unsubscribe function.
 */
export const subscribeOpenUrls = (listener: (batch: string[]) => void): (() => void) => {
    listeners.add(listener)
    flush()
    return () => {
        listeners.delete(listener)
    }
}
