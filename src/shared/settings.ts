export const THEMES = ["light", "dark", "system"] as const

export type Theme = (typeof THEMES)[number]

export const DEFAULT_SEARCH_TEMPLATE = "https://duckduckgo.com/?q=%s"

/**
 * A search engine as a URL template holding one `%s`,
 * which the omnibox replaces with the encoded query.
 * One string rather than a name plus a URL keeps the Setting round-trippable through JSON
 * and makes every engine expressible without a code change.
 */
export interface SearchEngine {
    readonly name: string
    readonly template: string
}

/** Offered as suggestions. Anything else the user types is still accepted. */
export const SEARCH_ENGINES: readonly SearchEngine[] = [
    { name: "DuckDuckGo", template: DEFAULT_SEARCH_TEMPLATE },
    { name: "Google", template: "https://www.google.com/search?q=%s" },
    { name: "Brave", template: "https://search.brave.com/search?q=%s" },
    { name: "Kagi", template: "https://kagi.com/search?q=%s" },
    { name: "Startpage", template: "https://www.startpage.com/sp/search?query=%s" },
    { name: "Wikipedia", template: "https://en.wikipedia.org/w/index.php?search=%s" },
    { name: "Bing", template: "https://www.bing.com/search?q=%s" },
    { name: "Ecosia", template: "https://www.ecosia.org/search?q=%s" },
]

/** Bare templates, for callers that only need the URL. */
export const SUGGESTED_SEARCH_TEMPLATES = SEARCH_ENGINES.map((engine) => engine.template)

/**
 * Where Arbor's own pages live. Belongs to no Container.
 *
 * The host is required, not decorative:
 * `arbor:/settings` parses as a scheme with an empty authority,
 * so `hostname` comes back empty and nothing recognises the page as internal.
 */
export const INTERNAL_SCHEME = "arbor"
export const INTERNAL_HOST = "settings"
export const SETTINGS_PATH = `/${INTERNAL_HOST}`
export const SETTINGS_URL = `${INTERNAL_SCHEME}://${INTERNAL_HOST}`

export interface Settings {
    searchTemplate: string
    theme: Theme
    /** Extensions whose toolbar button sits between the URL input and the puzzle button. */
    pinnedExtensionIds: string[]
}

export const DEFAULT_SETTINGS: Settings = {
    searchTemplate: DEFAULT_SEARCH_TEMPLATE,
    theme: "system",
    pinnedExtensionIds: [],
}

const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i
const HOST_PATTERN = /^([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/.*)?$/i

export const SEARCH_TOKEN = "%s"

/**
 * A template the omnibox can substitute into:
 * it carries one `%s`, and a probe query substituted for it parses as an `http(s)` URL.
 *
 * A bare host is normalised to `https://`.
 * Returns `null` when the input could not be used, which callers treat as "keep the value we already have".
 */
export const normalizeSearchTemplate = (input: string): string | null => {
    const trimmed = input.trim()
    if (trimmed.length === 0 || !trimmed.includes(SEARCH_TOKEN)) return null

    const withScheme = SCHEME_PATTERN.test(trimmed)
        ? trimmed
        : HOST_PATTERN.test(trimmed)
          ? `https://${trimmed}`
          : null
    if (withScheme === null) return null

    // Probe with a real substitution: a template can carry `%s` and still not be a usable URL.
    const probe = searchUrl(withScheme, "arbor")
    if (probe === null) return null
    const { protocol } = new URL(probe)
    return protocol === "http:" || protocol === "https:" ? withScheme : null
}

/** Substitute the query into a template, or `null` when the template is unusable. */
export const searchUrl = (template: string, query: string): string | null => {
    if (!template.includes(SEARCH_TOKEN)) return null
    try {
        return template.replaceAll(SEARCH_TOKEN, encodeURIComponent(query))
    } catch {
        return null
    }
}
