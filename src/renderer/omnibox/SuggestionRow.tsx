import type { Component } from "solid-js"

import { useSnapshot } from "../shell/snapshot"
import { Favicon } from "../ui/Favicon"
import { Icon } from "../ui/Icon"
import type { Suggestion } from "./suggestions"

import "./SuggestionRow.css"

const URL_PATTERN = /^[a-z][a-z0-9+.-]*:/i
const LIKE_URL_PATTERN = /^([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/.*)?$/i

/** True when the raw omnibox input looks like a URL (scheme or bare host). */
export const isUrlLike = (input: string): boolean => {
    const trimmed = input.trim()
    if (trimmed.length === 0) return false
    return URL_PATTERN.test(trimmed) || LIKE_URL_PATTERN.test(trimmed)
}

export const SuggestionRow: Component<{
    suggestion: Suggestion
    highlighted: boolean
    onHover: () => void
    onActivate: () => void
}> = (props) => {
    const snapshot = useSnapshot()
    return (
        <div
            class={{ "suggestion-row": true, highlighted: props.highlighted }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={props.onActivate}
            onMouseEnter={props.onHover}
        >
            {(() => {
                if (props.suggestion.kind === "go") {
                    const text =
                        props.suggestion.target.length > 0
                            ? props.suggestion.target
                            : props.suggestion.query
                    const isUrl = isUrlLike(props.suggestion.query)
                    return (
                        <>
                            <span class="suggestion-icon">
                                <Icon name={isUrl ? "link" : "search"} size={13} />
                            </span>
                            <span class="suggestion-title">{text}</span>
                        </>
                    )
                }
                if (props.suggestion.kind === "history") {
                    const entry = props.suggestion.entry
                    const color =
                        snapshot()?.containers.find((c) => c.id === entry.containerId)?.color ??
                        "#999999"
                    return (
                        <>
                            <Favicon url={entry.favicon} />
                            <span class="suggestion-title">{entry.title || entry.url}</span>
                            <span class="suggestion-dot" style={{ "background-color": color }} />
                        </>
                    )
                }
                const tab = props.suggestion.tab
                const color =
                    snapshot()?.containers.find((c) => c.id === tab.containerId)?.color ?? "#999999"
                return (
                    <>
                        <Favicon url={tab.favicon} />
                        <span class="suggestion-title">
                            {tab.userLabel || tab.title || tab.url}
                        </span>
                        <span class="suggestion-dot" style={{ "background-color": color }} />
                    </>
                )
            })()}
        </div>
    )
}
