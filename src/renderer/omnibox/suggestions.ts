import type { BrowserSnapshot, TabNode } from "../../shared/protocol"
import { DEFAULT_SEARCH_TEMPLATE } from "../../shared/settings"
import { omniboxTarget } from "../../shared/url"

const MAX_TAB_SUGGESTIONS = 3

export type Suggestion =
    | { kind: "go"; target: string; query: string }
    | { kind: "tab"; tab: TabNode }

export const computeSuggestions = (
    snap: BrowserSnapshot | null,
    raw: string,
    searchTemplate: string = DEFAULT_SEARCH_TEMPLATE,
): Suggestion[] => {
    const query = raw.trim()
    const list: Suggestion[] = [
        {
            kind: "go",
            target: query.length > 0 ? omniboxTarget(query, searchTemplate) : "",
            query,
        },
    ]
    if (query.length === 0) return list
    const needle = query.toLowerCase()
    if (!snap) return list
    const matches = snap.tabs
        .filter(
            (tab) =>
                tab.title.toLowerCase().includes(needle) || tab.url.toLowerCase().includes(needle),
        )
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
        .slice(0, MAX_TAB_SUGGESTIONS)
    for (const tab of matches) list.push({ kind: "tab", tab })
    return list
}
