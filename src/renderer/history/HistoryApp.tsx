import { For, Show, createMemo, createSignal } from "solid-js"

import { matchesHistoryQuery } from "../../shared/history"
import type { HistoryEntry, HistoryEntryId } from "../../shared/protocol"
import { initHistory, useHistory } from "../shell/history"
import { initState, useSnapshot } from "../shell/snapshot"
import { Favicon } from "../ui/Favicon"
import { Icon } from "../ui/Icon"

import "./HistoryApp.css"

const SPANS = [
    { key: "hour", label: "Last hour", ms: 60 * 60 * 1000 },
    { key: "day", label: "Last 24 hours", ms: 24 * 60 * 60 * 1000 },
    { key: "week", label: "Last 7 days", ms: 7 * 24 * 60 * 60 * 1000 },
] as const

type SpanKey = (typeof SPANS)[number]["key"] | "all"

const relative = (at: number, now: number): string => {
    const diff = Math.max(0, now - at)
    const minutes = Math.floor(diff / 60_000)
    if (minutes < 1) return "Just now"
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
}

const absolute = (at: number): string => new Date(at).toLocaleString()

/** Rendered inside the internal tab (`arbor://history`). */
export const HistoryApp = () => {
    void initState()
    void initHistory()

    const history = useHistory()
    const snapshot = useSnapshot()
    const [query, setQuery] = createSignal("")
    const [containerId, setContainerId] = createSignal<string>("all")
    const [selected, setSelected] = createSignal<ReadonlySet<HistoryEntryId>>(new Set())
    const [armed, setArmed] = createSignal<SpanKey | null>(null)
    const [cutoff, setCutoff] = createSignal("")

    const now = createMemo(() => Date.now())

    const containers = () => snapshot()?.containers ?? []
    const containerOf = (id: string) => containers().find((c) => c.id === id)

    const shown = createMemo(() => {
        const needle = query()
        const only = containerId()
        return history().entries.filter((entry) => {
            if (only !== "all" && entry.containerId !== only) return false
            return matchesHistoryQuery(entry, needle, containerOf(entry.containerId)?.name)
        })
    })

    const allSelected = createMemo(() => {
        const ids = shown()
        return ids.length > 0 && ids.every((entry) => selected().has(entry.id))
    })

    const toggle = (id: HistoryEntryId, checked: boolean): void => {
        const next = new Set(selected())
        if (checked) next.add(id)
        else next.delete(id)
        setSelected(next)
    }

    const toggleAll = (checked: boolean): void => {
        if (checked) setSelected(new Set(shown().map((entry) => entry.id)))
        else setSelected(new Set<HistoryEntryId>())
    }

    const clearSpan = (key: SpanKey): void => {
        if (armed() !== key) {
            setArmed(key)
            return
        }
        setArmed(null)
        if (key === "all") void window.arbor.historyClearAll()
        else {
            const span = SPANS.find((s) => s.key === key)
            if (span) void window.arbor.historyClearBefore({ cutoff: Date.now() - span.ms })
        }
    }

    const clearBeforeDate = (): void => {
        const time = new Date(cutoff()).getTime()
        if (!Number.isFinite(time)) return
        void window.arbor.historyClearBefore({ cutoff: time })
    }

    const removeOne = (id: HistoryEntryId): void => {
        void window.arbor.historyRemove({ ids: [id] })
        toggle(id, false)
    }

    const removeSelected = (): void => {
        const ids = [...selected()]
        if (ids.length === 0) return
        setSelected(new Set<HistoryEntryId>())
        void window.arbor.historyRemove({ ids })
    }

    return (
        <div class="history-page">
            <header class="history-header">
                <h1>History</h1>
                <div class="history-tools">
                    <label class="history-search">
                        <Icon name="search" size={16} />
                        <input
                            type="text"
                            placeholder="Search by title, URL, or container…"
                            spellcheck={false}
                            autocomplete="off"
                            autofocus
                            value={query()}
                            onInput={(event) => setQuery(event.currentTarget.value)}
                        />
                        <Show when={query().length > 0}>
                            <button
                                type="button"
                                class="history-clear-input"
                                aria-label="Clear search"
                                onClick={() => setQuery("")}
                            >
                                <Icon name="x" size={14} />
                            </button>
                        </Show>
                    </label>
                    <label class="history-container-filter">
                        <span class="history-filter-label">Container</span>
                        <select
                            value={containerId()}
                            onChange={(event) => setContainerId(event.currentTarget.value)}
                        >
                            <option value="all">All containers</option>
                            <For each={containers()}>
                                {(container) => (
                                    <option value={container.id}>{container.name}</option>
                                )}
                            </For>
                        </select>
                    </label>
                </div>
                <p class="history-count">
                    {shown().length} of {history().totalCount} visits
                </p>
            </header>

            <div class="history-bar">
                <div class="history-bar-group">
                    <span class="history-filter-label">Delete</span>
                    <For each={SPANS}>
                        {(span) => (
                            <button
                                type="button"
                                class={{ "history-button": true, armed: armed() === span.key }}
                                onClick={() => clearSpan(span.key)}
                            >
                                {armed() === span.key
                                    ? `Confirm ${span.label.toLowerCase()}?`
                                    : span.label}
                            </button>
                        )}
                    </For>
                    <button
                        type="button"
                        class={{ "history-button": true, armed: armed() === "all" }}
                        onClick={() => clearSpan("all")}
                    >
                        {armed() === "all" ? "Confirm delete all?" : "All"}
                    </button>
                </div>
                <div class="history-bar-group">
                    <label class="history-date">
                        <span class="history-filter-label">Before</span>
                        <input
                            type="datetime-local"
                            value={cutoff()}
                            onInput={(event) => setCutoff(event.currentTarget.value)}
                        />
                    </label>
                    <button
                        type="button"
                        class="history-button"
                        disabled={cutoff().length === 0}
                        onClick={clearBeforeDate}
                    >
                        Delete before date
                    </button>
                </div>
                <div class="history-bar-group">
                    <button
                        type="button"
                        class="history-button danger"
                        disabled={selected().size === 0}
                        onClick={removeSelected}
                    >
                        <Icon name="trash" size={13} />
                        Delete selected ({selected().size})
                    </button>
                </div>
            </div>

            <Show
                when={history().totalCount > 0}
                fallback={
                    <div class="history-empty">No history yet. Pages you visit appear here.</div>
                }
            >
                <Show
                    when={shown().length > 0}
                    fallback={<div class="history-empty">No visits match your search.</div>}
                >
                    <table class="history-table">
                        <thead>
                            <tr>
                                <th class="history-col-select">
                                    <input
                                        type="checkbox"
                                        aria-label="Select all shown"
                                        checked={allSelected()}
                                        onChange={(event) => toggleAll(event.currentTarget.checked)}
                                    />
                                </th>
                                <th>Name</th>
                                <th>URL</th>
                                <th>Date</th>
                                <th>Container</th>
                                <th class="history-col-delete">
                                    <span class="history-filter-label">Delete</span>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            <For each={shown()}>
                                {(entry) => (
                                    <HistoryRow
                                        entry={entry}
                                        now={now()}
                                        checked={selected().has(entry.id)}
                                        containerName={
                                            containerOf(entry.containerId)?.name ??
                                            "Deleted container"
                                        }
                                        containerColor={
                                            containerOf(entry.containerId)?.color ?? "#999999"
                                        }
                                        onToggle={(checked) => toggle(entry.id, checked)}
                                        onOpen={() =>
                                            void window.arbor.createTab({ url: entry.url })
                                        }
                                        onRemove={() => removeOne(entry.id)}
                                    />
                                )}
                            </For>
                        </tbody>
                    </table>
                </Show>
            </Show>
        </div>
    )
}

const HistoryRow = (props: {
    entry: HistoryEntry
    now: number
    checked: boolean
    containerName: string
    containerColor: string
    onToggle: (checked: boolean) => void
    onOpen: () => void
    onRemove: () => void
}) => {
    const entry = () => props.entry
    const name = () =>
        entry().title.length > 0 ? entry().title : (hostOf(entry().url) ?? entry().url)
    return (
        <tr class="history-row">
            <td class="history-col-select">
                <input
                    type="checkbox"
                    aria-label="Select row"
                    checked={props.checked}
                    onChange={(event) => props.onToggle(event.currentTarget.checked)}
                />
            </td>
            <td class="history-name">
                <Favicon url={entry().favicon} />
                <span class="history-name-label" title={name()}>
                    {name()}
                </span>
                <Show when={entry().visitCount > 1}>
                    <span class="history-visits">×{entry().visitCount}</span>
                </Show>
            </td>
            <td class="history-url" title={entry().url}>
                <button type="button" class="history-url-link" onClick={props.onOpen}>
                    {entry().url}
                </button>
            </td>
            <td class="history-date-cell" title={absolute(entry().lastVisitedAt)}>
                {relative(entry().lastVisitedAt, props.now)}
            </td>
            <td class="history-container">
                <span class="history-dot" style={{ "background-color": props.containerColor }} />
                <span>{props.containerName}</span>
            </td>
            <td class="history-col-delete">
                <button
                    type="button"
                    class="history-row-delete"
                    aria-label="Delete this visit"
                    onClick={props.onRemove}
                >
                    <Icon name="trash" size={14} />
                </button>
            </td>
        </tr>
    )
}

const hostOf = (url: string): string | null => {
    try {
        return new URL(url).hostname || null
    } catch {
        return null
    }
}
