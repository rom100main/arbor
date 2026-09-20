import { createEffect, createSignal, Show } from "solid-js"

import type { TabId } from "../../../shared/protocol"
import { isUrlLike } from "../../../shared/url"
import { Icon } from "../../ui/Icon"
import { requestOmniboxFocus, useOmniboxFocus } from "../focus"

import "./OmniboxInput.css"

export const OmniboxInput = (props: { tabId: TabId | null; url: string }) => {
    const [value, setValue] = createSignal(props.url)
    // Follow the page URL unless the user is editing.
    createEffect(
        () => props.url,
        (url) => {
            if (document.activeElement?.classList.contains("omnibox") !== true) setValue(url)
        },
    )

    let input: HTMLInputElement | undefined
    const focusInput = (): void => {
        input?.focus()
        input?.select()
    }

    // New tabs (and menu shortcuts like Cmd+L) request focus through this counter.
    createEffect(
        () => useOmniboxFocus()(),
        () => focusInput(),
    )
    window.arbor.onFocusOmnibox(requestOmniboxFocus)

    const sendQuery = (query: string): void => {
        if (!input) return
        const rect = input.getBoundingClientRect()
        window.arbor.omniboxUpdate({
            query,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        })
    }
    const hidePopup = (): void => {
        window.arbor.omniboxUpdate({ query: "", rect: null })
    }

    // Clicking the native web view steals focus without an input blur event.
    window.addEventListener("blur", hidePopup)
    window.arbor.onOmniboxActivated(() => {
        setValue(props.url)
        input?.blur()
    })

    const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === "Enter") {
            event.preventDefault()
            window.arbor.omniboxActivateSelected()
            return
        }
        if (event.key === "Escape") {
            event.preventDefault()
            setValue(props.url)
            hidePopup()
            input?.blur()
            return
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault()
            window.arbor.omniboxMoveSelection(event.key === "ArrowDown" ? 1 : -1)
        }
    }

    return (
        <div class="omnibox-wrap">
            <Show when={isUrlLike(value())}>
                <span class="omnibox-icon">
                    <Icon name="link" size={14} />
                </span>
            </Show>
            <input
                ref={(el) => (input = el)}
                class={{ omnibox: true, "has-icon": isUrlLike(value()) }}
                type="text"
                placeholder="Search DuckDuckGo or type a URL"
                value={value()}
                onInput={(event) => {
                    const next = event.currentTarget.value
                    setValue(next)
                    sendQuery(next)
                }}
                onFocus={(event) => {
                    event.currentTarget.select()
                    sendQuery(value())
                }}
                onBlur={hidePopup}
                onKeyDown={onKeyDown}
            />
        </div>
    )
}
