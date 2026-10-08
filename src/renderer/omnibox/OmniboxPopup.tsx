import { For, createEffect, createMemo, createSignal } from "solid-js"

import { useSettings } from "../shell/settings"
import { initState, useSnapshot } from "../shell/snapshot"
import { SuggestionRow } from "./SuggestionRow"
import { computeSuggestions } from "./suggestions"

import "./OmniboxPopup.css"

/** Rendered inside the frameless omnibox popup window (?omnibox query param). */
export const OmniboxPopup = () => {
    void initState()
    const snapshot = useSnapshot()
    const settings = useSettings()
    const [query, setQuery] = createSignal("")
    const [selected, setSelected] = createSignal(0)

    window.arbor.onOmniboxQuery(setQuery)

    const suggestions = createMemo(() =>
        computeSuggestions(snapshot(), query(), settings().searchTemplate),
    )
    const suggestionCount = createMemo(() => suggestions().length)

    const activateCurrent = (): void => {
        const suggestion = suggestions()[selected()]
        if (!suggestion) return
        window.arbor.omniboxActivate(
            suggestion.kind === "go"
                ? { kind: "go", query: suggestion.query }
                : { kind: "tab", tabId: suggestion.tab.id },
        )
    }

    // Keyboard never leaves the omnibox input; the main window forwards it here.
    window.arbor.onOmniboxMoveSelection((delta) => {
        const count = suggestions().length
        if (count === 0) return
        setSelected((current) => Math.min(count - 1, Math.max(0, current + delta)))
    })
    window.arbor.onOmniboxActivateSelected(activateCurrent)

    createEffect(
        () => suggestionCount(),
        () => {
            setSelected(0)
        },
    )

    let card: HTMLDivElement | undefined
    createEffect(
        () => suggestionCount(),
        (count) => {
            const height = card && count > 0 ? card.offsetHeight : 0
            window.arbor.omniboxSetPopupHeight(height + 12)
        },
    )

    return (
        <div class="omnibox-popup-root">
            <div class="omnibox-suggestions" ref={(el) => (card = el)}>
                <For each={suggestions()}>
                    {(suggestion, index) => (
                        <SuggestionRow
                            suggestion={suggestion}
                            highlighted={index() === selected()}
                            onHover={() => setSelected(index())}
                            onActivate={() =>
                                window.arbor.omniboxActivate(
                                    suggestion.kind === "go"
                                        ? { kind: "go", query: suggestion.query }
                                        : { kind: "tab", tabId: suggestion.tab.id },
                                )
                            }
                        />
                    )}
                </For>
            </div>
        </div>
    )
}
