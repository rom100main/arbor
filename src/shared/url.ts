// Should be Effect free

import { DEFAULT_SEARCH_TEMPLATE, searchUrl } from "./settings"

const URL_PATTERN = /^[a-z][a-z0-9+.-]*:/i
const LIKE_URL_PATTERN = /^([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/.*)?$/i

/** True when the raw omnibox input looks like a URL (scheme or bare host). */
export const isUrlLike = (input: string): boolean => {
    const trimmed = input.trim()
    if (trimmed.length === 0) return false
    return URL_PATTERN.test(trimmed) || LIKE_URL_PATTERN.test(trimmed)
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
