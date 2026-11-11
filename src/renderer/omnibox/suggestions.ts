import type { BrowserSnapshot, HistoryEntry, TabNode } from "../../shared/protocol"
import { DEFAULT_SEARCH_TEMPLATE } from "../../shared/settings"
import { omniboxTarget } from "../../shared/url"
import { scoreHistoryEntry } from "./scoring"

const MAX_TAB_SUGGESTIONS = 3
const MAX_HISTORY_SUGGESTIONS = 5

export type Suggestion =
    | { kind: "go"; target: string; query: string }
    | { kind: "tab"; tab: TabNode }
    | { kind: "history"; entry: HistoryEntry; score: number }

export const computeSuggestions = (
    snap: BrowserSnapshot | null,
    raw: string,
    searchTemplate: string = DEFAULT_SEARCH_TEMPLATE,
    historyEntries: ReadonlyArray<HistoryEntry> = [],
    now: number = Date.now(),
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
    const tabUrls = new Set<string>()
    if (snap) {
        const matches = snap.tabs
            .filter(
                (tab) =>
                    tab.title.toLowerCase().includes(needle) ||
                    tab.url.toLowerCase().includes(needle),
            )
            .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
            .slice(0, MAX_TAB_SUGGESTIONS)
        for (const tab of matches) {
            list.push({ kind: "tab", tab })
            tabUrls.add(tab.url)
        }
    }
    const maxVisitCount = historyEntries.reduce((max, entry) => Math.max(max, entry.visitCount), 1)
    const scored = historyEntries
        .filter((entry) => !tabUrls.has(entry.url))
        .map((entry) => ({ entry, score: scoreHistoryEntry(entry, query, now, maxVisitCount) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_HISTORY_SUGGESTIONS)
    for (const { entry, score } of scored) list.push({ kind: "history", entry, score })
    return list
}
