import { For, createEffect, createMemo, createSignal } from "solid-js"

import { PopupCard } from "../../common/PopupCard/PopupCard"
import { initHistory, useHistory } from "../../common/store/history"
import { useSettings } from "../../common/store/settings"
import { initState, useSnapshot } from "../../common/store/snapshot"
import { SuggestionRow } from "./SuggestionRow"
import { computeSuggestions, moveSuggestionSelection } from "./suggestions"

import "./OmniboxPopup.css"

/** Rendered inside the frameless omnibox popup window (?omnibox query param). */
export const OmniboxPopup = () => {
    void initState()
    void initHistory()
    const snapshot = useSnapshot()
    const settings = useSettings()
    const history = useHistory()
    const [query, setQuery] = createSignal("")
    const [selected, setSelected] = createSignal(0)

    window.arbor.onOmniboxQuery(setQuery)

    const suggestions = createMemo(() =>
        computeSuggestions(snapshot(), query(), settings().searchTemplate, history().entries),
    )
    const suggestionCount = createMemo(() => suggestions().length)

    const activateCurrent = (): void => {
        const suggestion = suggestions()[selected()]
        if (!suggestion) return
        window.arbor.omniboxActivate(
            suggestion.kind === "go"
                ? { kind: "go", query: suggestion.query }
                : suggestion.kind === "history"
                  ? { kind: "history", entryId: suggestion.entry.id }
                  : { kind: "tab", tabId: suggestion.tab.id },
        )
    }

    // Keyboard never leaves the omnibox input; the main window forwards it here.
    window.arbor.onOmniboxMoveSelection((delta) => {
        const count = suggestions().length
        if (count === 0) return
        setSelected((current) => moveSuggestionSelection(current, delta, count))
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
            <PopupCard class="omnibox-suggestions" ref={(el) => (card = el)}>
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
                                        : suggestion.kind === "history"
                                          ? { kind: "history", entryId: suggestion.entry.id }
                                          : { kind: "tab", tabId: suggestion.tab.id },
                                )
                            }
                        />
                    )}
                </For>
            </PopupCard>
        </div>
    )
}
