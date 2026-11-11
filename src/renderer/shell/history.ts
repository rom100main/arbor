import { createSignal } from "solid-js"

import type { HistorySnapshot } from "../../shared/protocol"
import { createInit } from "./init-store"

const EMPTY: HistorySnapshot = { entries: [], totalCount: 0 }

const [history, setHistory] = createSignal<HistorySnapshot>(EMPTY)

export const useHistory = () => history

/**
 * Hydrate the history list for this window:
 * subscribe to pushes first, then fetch the current list.
 */
export const initHistory = createInit<HistorySnapshot>({
    subscribe: (callback) => window.arbor.onHistory(callback),
    fetch: async () => (await window.arbor.historyList({})).value,
    apply: (value) => setHistory(value),
})
