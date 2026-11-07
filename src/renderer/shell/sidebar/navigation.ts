import type { DisplayTab, TabId } from "../../../shared/protocol"

/** The visible row `delta` places away from `tabId`, or `null` at either end of the tree. */
export const neighborRow = (
    rows: readonly DisplayTab[],
    tabId: TabId,
    delta: 1 | -1,
): TabId | null => {
    const index = rows.findIndex((row) => row.id === tabId)
    if (index === -1) return null
    return rows[index + delta]?.id ?? null
}

/** The first row nested directly under `tabId`, when it is expanded. */
export const childRow = (rows: readonly DisplayTab[], tabId: TabId): TabId | null => {
    const index = rows.findIndex((row) => row.id === tabId)
    if (index === -1) return null
    const row = rows[index]
    const next = rows[index + 1]
    return next && next.depth === row.depth + 1 ? next.id : null
}

/** The parent row of `tabId`, when it is visible. */
export const parentRow = (rows: readonly DisplayTab[], tabId: TabId): TabId | null => {
    const row = rows.find((candidate) => candidate.id === tabId)
    if (!row?.parentId) return null
    return rows.some((candidate) => candidate.id === row.parentId) ? row.parentId : null
}
