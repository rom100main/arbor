const URL_PATTERN = /^[a-z][a-z0-9+.-]*:/i
const LIKE_URL_PATTERN = /^([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/.*)?$/i

/** Resolve omnibox input to a navigable URL: URL, host, or DuckDuckGo search. */
export const omniboxTarget = (input: string): string => {
    const trimmed = input.trim()
    if (trimmed.length === 0) return "about:blank"
    if (LIKE_URL_PATTERN.test(trimmed)) return `https://${trimmed}`
    if (URL_PATTERN.test(trimmed)) return trimmed
    return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`
}
