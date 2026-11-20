// Should be Effect free

import { DEFAULT_SEARCH_TEMPLATE, isNewTabUrl, NEW_TAB_TITLE, searchUrl } from "./settings"

export type UrlDisplayParts = {
    /** Everything before the host: scheme, userinfo. Greyed. */
    prefix: string
    /** The host itself, kept full-strength. Empty when `value` has no host. */
    host: string
    /** Everything after the host: port, path, query, fragment. Greyed. */
    suffix: string
}

const URL_PATTERN = /^[a-z][a-z0-9+.-]*:/i
const LIKE_URL_PATTERN = /^([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/.*)?$/i

/**
 * Split a displayed URL into the part to keep full-strength (its host)
 * and the parts to grey out (scheme, port, path, query, fragment).
 */
export const urlDisplayParts = (value: string): UrlDisplayParts => {
    const plain = { prefix: value, host: "", suffix: "" }
    if (value.length === 0 || /\s/.test(value)) return plain

    let authorityStart = 0
    let hasAuthority = false
    if (value.startsWith("//")) {
        authorityStart = 2
        hasAuthority = true
    } else {
        const schemeEnd = value.indexOf("://")
        if (schemeEnd !== -1) {
            authorityStart = schemeEnd + 3
            hasAuthority = true
        } else if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
            // Opaque scheme without an authority (about:, mailto:, data:),
            // unless the colon introduces a numeric port (example.com:8080).
            const afterColon = value.slice(value.indexOf(":") + 1)
            if (!/^\d+([/?#]|$)/.test(afterColon)) return plain
        }
    }

    let authorityEnd = value.length
    for (const delimiter of ["/", "?", "#"]) {
        const at = value.indexOf(delimiter, authorityStart)
        if (at !== -1 && at < authorityEnd) authorityEnd = at
    }

    const authority = value.slice(authorityStart, authorityEnd)
    if (authority.length === 0) return plain

    // Strip userinfo, then the port, leaving just the host.
    const hostPort = authority.slice(authority.lastIndexOf("@") + 1)
    let hostEnd: number
    if (hostPort.startsWith("[")) {
        const closing = hostPort.indexOf("]")
        if (closing === -1) return plain
        hostEnd = closing + 1
    } else {
        const colon = hostPort.indexOf(":")
        hostEnd = colon === -1 ? hostPort.length : colon
    }
    const hostStart = authorityStart + (authority.length - hostPort.length)
    const host = hostPort.slice(0, hostEnd)
    if (host.length === 0) return plain

    if (!hasAuthority && !host.includes(".") && host !== "localhost" && !host.startsWith("[")) {
        return plain
    }

    return {
        prefix: value.slice(0, hostStart),
        host,
        suffix: value.slice(hostStart + host.length),
    }
}

/** What the URL bar shows for a page: the new-tab page (and legacy blank pages) show nothing. */
export const displayUrl = (url: string): string =>
    isNewTabUrl(url) || url === "about:blank" ? "" : url

/** What the sidebar shows for a tab: the new-tab page always reads `New tab` until renamed. */
export const displayTabLabel = (
    tab: Pick<
        { url: string; title: string; userLabel: string | null },
        "url" | "title" | "userLabel"
    >,
): string => {
    if (tab.userLabel) return tab.userLabel
    if (isNewTabUrl(tab.url) || tab.url === "about:blank") return NEW_TAB_TITLE
    return tab.title || tab.url
}

/**
 * Resolve omnibox input to a navigable URL:
 * URL, host, or a search on the user's engine.
 * An unusable template falls back to the default engine rather than navigating nowhere,
 * a bad template must never turn a typed query into a blank page.
 */
export const omniboxTarget = (input: string, template?: string): string => {
    const trimmed = input.trim()
    if (trimmed.length === 0) return "about:blank"
    if (LIKE_URL_PATTERN.test(trimmed)) return `https://${trimmed}`
    if (URL_PATTERN.test(trimmed)) return trimmed
    return (
        searchUrl(template ?? DEFAULT_SEARCH_TEMPLATE, trimmed) ??
        searchUrl(DEFAULT_SEARCH_TEMPLATE, trimmed) ??
        "about:blank"
    )
}
