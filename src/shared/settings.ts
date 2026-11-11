// Should be Effect free

import type { Settings } from "./settings-schema"

export const THEMES = ["light", "dark", "system"] as const
export type Theme = (typeof THEMES)[number]

export const SIDEBAR_VISIBILITIES = ["displayed", "compact", "hidden"] as const
export type SidebarVisibility = (typeof SIDEBAR_VISIBILITIES)[number]

export const URL_BAR_VISIBILITIES = ["displayed", "hidden"] as const
export type UrlBarVisibility = (typeof URL_BAR_VISIBILITIES)[number]

export const HISTORY_RETENTIONS = ["never", "30d", "90d", "1y", "forever"] as const
export type HistoryRetention = (typeof HISTORY_RETENTIONS)[number]

export const SIDEBAR_WIDTH = 240
export const SIDEBAR_COMPACT_WIDTH = 48
export const TOOLBAR_HEIGHT = 44

export const REVEAL_EDGE = 16

export interface ChromeInsets {
    readonly left: number
    readonly bottom: number
}

/**
 * Space the shell keeps for itself along the window's left and bottom edge.
 * A revealed bar slides over the page rather than resizing it, so only the resting state counts here.
 */
export const chromeInsets = (
    settings: Pick<Settings, "sidebarVisibility" | "urlBarVisibility">,
): ChromeInsets => ({
    left:
        settings.sidebarVisibility === "displayed"
            ? SIDEBAR_WIDTH
            : settings.sidebarVisibility === "compact"
              ? SIDEBAR_COMPACT_WIDTH
              : 0,
    bottom: settings.urlBarVisibility === "displayed" ? TOOLBAR_HEIGHT : 0,
})

export const DEFAULT_SEARCH_TEMPLATE = "https://duckduckgo.com/?q=%s"

export const INTERNAL_SCHEME = "arbor"
const INTERNAL_HOST = "settings"
export const SETTINGS_URL = `${INTERNAL_SCHEME}://${INTERNAL_HOST}`
const HISTORY_HOST = "history"
export const HISTORY_URL = `${INTERNAL_SCHEME}://${HISTORY_HOST}`

export type { Settings } from "./settings-schema"

export const DEFAULT_SETTINGS: Settings = {
    searchTemplate: DEFAULT_SEARCH_TEMPLATE,
    theme: "system",
    pinnedExtensionIds: [],
    sidebarVisibility: "compact",
    urlBarVisibility: "displayed",
    downloadAskWhereToSave: true,
    historyEnabled: true,
    historyRetention: "forever",
}

const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i
const HOST_PATTERN = /^([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/.*)?$/i

const SEARCH_TOKEN = "%s"

/**
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
    try {
        const { protocol } = new URL(probe)
        return protocol === "http:" || protocol === "https:" ? withScheme : null
    } catch {
        return null
    }
}

export const searchUrl = (template: string, query: string): string | null => {
    if (!template.includes(SEARCH_TOKEN)) return null
    try {
        return template.replaceAll(SEARCH_TOKEN, encodeURIComponent(query))
    } catch {
        return null
    }
}
