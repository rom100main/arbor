import { createEffect, createSignal, onCleanup } from "solid-js"

import type { FindStatus } from "../../../shared/protocol"
import { Button } from "../../common/Button/Button"
import { Field } from "../../common/Field/Field"
import { PopupCard } from "../../common/PopupCard/PopupCard"
import { initState, useSnapshot } from "../../common/store/snapshot"

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
        <PopupCard class="find-bar">
            <Field
                ref={(el) => (input = el)}
                value={query()}
                ariaLabel="Find in page"
                placeholder="Find in page"
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
            <Button
                icon="chevron-up"
                ariaLabel="Previous match"
                title="Previous match (Shift+Enter)"
                disabled={status().total === 0}
                onClick={() => void step(false)}
            />
            <Button
                icon="chevron-down"
                ariaLabel="Next match"
                title="Next match (Enter)"
                disabled={status().total === 0}
                onClick={() => void step(true)}
            />
            <Button
                icon="letter-case"
                ariaLabel="Match case"
                title="Match case"
                active={caseSensitive()}
                pressed={caseSensitive()}
                onClick={() => toggle("caseSensitive", !caseSensitive())}
            />
            <Button
                icon="abc"
                ariaLabel="Match whole word"
                title="Match whole word"
                active={wholeWord()}
                pressed={wholeWord()}
                onClick={() => toggle("wholeWord", !wholeWord())}
            />
            <Button
                icon="regex"
                ariaLabel="Use regular expression"
                title="Regular expression"
                active={regex()}
                pressed={regex()}
                onClick={() => toggle("regex", !regex())}
            />
            <Button icon="x" ariaLabel="Close find bar" title="Close (Esc)" onClick={close} />
        </PopupCard>
    )
}
