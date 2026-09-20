import type { Component } from "solid-js"

import { useSnapshot } from "../shell/snapshot"
import { Favicon } from "../ui/Favicon"
import { Icon } from "../ui/Icon"
import type { Suggestion } from "./suggestions"

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
                    return (
                        <>
                            <span class="suggestion-icon">
                                <Icon name="search" size={13} />
                            </span>
                            <span class="suggestion-title">{text}</span>
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
