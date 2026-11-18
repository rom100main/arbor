import { createEffect, createSignal, onCleanup } from "solid-js"

import type { FindStatus } from "../../shared/protocol"
import { initState, useSnapshot } from "../shell/snapshot"
import { Icon } from "../ui/Icon"

import "./FindBar.css"

const EMPTY_STATUS: FindStatus = { total: 0, activeIndex: -1, error: null }

/** Rendered inside the find-in-page bar window (?find query param). */
export const FindBar = () => {
    void initState()
    const snapshot = useSnapshot()
    const [query, setQuery] = createSignal("")
    const [caseSensitive, setCaseSensitive] = createSignal(false)
    const [wholeWord, setWholeWord] = createSignal(false)
    const [regex, setRegexMode] = createSignal(false)
    const [status, setStatus] = createSignal<FindStatus>(EMPTY_STATUS)

    let input: HTMLInputElement | undefined
    // Monotonic request id: only the latest search may update the status.
    let requestId = 0

    const search = async (): Promise<void> => {
        const id = ++requestId
        const reply = await window.arbor.findSearch({
            query: query(),
            caseSensitive: caseSensitive(),
            wholeWord: wholeWord(),
            regex: regex(),
        })
        if (id !== requestId) return
        setStatus(reply.value)
    }

    const step = async (forward: boolean): Promise<void> => {
        const id = ++requestId
        const reply = await window.arbor.findStep({ forward })
        if (id !== requestId) return
        setStatus(reply.value)
    }

    createEffect(
        () => [query(), caseSensitive(), wholeWord(), regex()] as const,
        () => {
            void search()
        },
    )

    // A navigation in the same tab drops the page's highlights: search again.
    // A tab switch is left alone: the bar closes, and reopening searches the new page.
    createEffect(
        () => {
            const snap = snapshot()
            const active = snap?.tabs.find((tab) => tab.id === snap.activeTabId)
            return [snap?.activeTabId ?? null, active?.url ?? ""] as const
        },
        ([tabId, url], prev) => {
            if (prev === undefined || prev[0] !== tabId) return
            if (prev[1] === url) return
            if (query().length > 0) void search()
        },
    )

    const close = (): void => window.arbor.findClose()

    onCleanup(
        window.arbor.onOpenFind(() => {
            input?.focus({ preventScroll: true })
            input?.select()
            void search()
        }),
    )

    const onKeyDown = (event: KeyboardEvent): void => {
        const mod = event.metaKey || event.ctrlKey
        if (mod && event.key.toLowerCase() === "f") {
            event.preventDefault()
            input?.focus({ preventScroll: true })
            input?.select()
            return
        }
        if (event.key === "Escape") {
            event.preventDefault()
            close()
            return
        }
        if (event.key === "Enter") {
            // Shift jumps backwards, like Chrome.
            event.preventDefault()
            void step(!event.shiftKey)
            return
        }
        if (mod && event.key.toLowerCase() === "g") {
            event.preventDefault()
            void step(!event.shiftKey)
        }
    }

    const countLabel = (): string => {
        const current = status()
        if (current.error !== null) return "Invalid regex"
        if (query().length === 0) return ""
        if (current.total === 0) return "0/0"
        return `${current.activeIndex + 1}/${current.total}`
    }

    const toggle = (kind: "caseSensitive" | "wholeWord" | "regex", next: boolean): void => {
        if (kind === "caseSensitive") setCaseSensitive(next)
        else if (kind === "wholeWord") setWholeWord(next)
        else setRegexMode(next)
    }

    return (
        <div class="find-bar" role="search">
            <input
                ref={(el) => (input = el)}
                class="find-input"
                type="text"
                aria-label="Find in page"
                placeholder="Find in page"
                spellcheck={false}
                value={query()}
                onInput={(event) => setQuery(event.currentTarget.value)}
                onKeyDown={onKeyDown}
            />
            <span
                class={{ "find-count": true, "find-count-error": status().error !== null }}
                title={status().error ?? ""}
                aria-live="polite"
            >
                {countLabel()}
            </span>
            <button
                type="button"
                class="find-button"
                aria-label="Previous match"
                title="Previous match (Shift+Enter)"
                disabled={status().total === 0}
                onClick={() => void step(false)}
            >
                <Icon name="chevron-up" size={16} />
            </button>
            <button
                type="button"
                class="find-button"
                aria-label="Next match"
                title="Next match (Enter)"
                disabled={status().total === 0}
                onClick={() => void step(true)}
            >
                <Icon name="chevron-down" size={16} />
            </button>
            <button
                type="button"
                class={{ "find-button": true, "find-button-toggle": true, active: caseSensitive() }}
                aria-label="Match case"
                title="Match case"
                onClick={() => toggle("caseSensitive", !caseSensitive())}
            >
                <Icon name="letter-case" size={16} />
            </button>
            <button
                type="button"
                class={{ "find-button": true, "find-button-toggle": true, active: wholeWord() }}
                aria-label="Match whole word"
                title="Match whole word"
                onClick={() => toggle("wholeWord", !wholeWord())}
            >
                <Icon name="abc" size={16} />
            </button>
            <button
                type="button"
                class={{ "find-button": true, "find-button-toggle": true, active: regex() }}
                aria-label="Use regular expression"
                title="Regular expression"
                onClick={() => toggle("regex", !regex())}
            >
                <Icon name="regex" size={16} />
            </button>
            <button
                type="button"
                class="find-button"
                aria-label="Close find bar"
                title="Close (Esc)"
                onClick={close}
            >
                <Icon name="x" size={16} />
            </button>
        </div>
    )
}
