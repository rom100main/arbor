import { createEffect, createSignal } from "solid-js"

import type { TabId } from "../../../shared/protocol"
import { requestOmniboxFocus, useOmniboxFocus } from "../focus"

import "./OmniboxInput.css"

const restingRect = (el: HTMLElement): DOMRect => {
    const rect = el.getBoundingClientRect()
    const bar = el.closest<HTMLElement>(".toolbar")
    if (!bar) return rect
    const { transform } = getComputedStyle(bar)
    const offset = transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42
    return new DOMRect(rect.x, rect.y - offset, rect.width, rect.height)
}

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
        input?.focus({ preventScroll: true })
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
        const rect = restingRect(input)
        window.arbor.omniboxUpdate({
            query,
            rect: { x: rect.x, y: rect.y, width: rect.width },
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
            <input
                ref={(el) => (input = el)}
                class={{ omnibox: true }}
                type="text"
                placeholder="Search or type a URL"
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
