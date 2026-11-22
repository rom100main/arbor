import { createEffect, createSignal } from "solid-js"

import type { TabId } from "../../../../shared/protocol"
import { urlDisplayParts } from "../../../../shared/url"
import { requestOmniboxFocus, useOmniboxFocus } from "../../../common/store/focus"
import { FavoriteStar } from "../FavoriteStar/FavoriteStar"

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
    // A tab switch always shows the new tab's URL,
    // even if the input happens to be focused
    // (at startup nothing is being edited yet).
    createEffect(
        () => [props.tabId, props.url] as const,
        ([tabId, url], prev) => {
            const tabChanged = prev !== undefined && prev[0] !== tabId
            if (tabChanged || document.activeElement?.classList.contains("omnibox") !== true) {
                setValue(url)
            }
        },
    )

    let input: HTMLInputElement | undefined
    let overlay: HTMLDivElement | undefined

    const syncScroll = (): void => {
        if (input && overlay) overlay.scrollLeft = input.scrollLeft
    }
    createEffect(
        () => value(),
        () => {
            requestAnimationFrame(syncScroll)
        },
    )

    const focusInput = (): void => {
        input?.focus({ preventScroll: true })
        input?.select()
    }

    // New tabs (and menu shortcuts like Cmd+L) request focus through this counter.
    // The counter starts at 0: without this guard the effect would focus the input on mount,
    // stealing focus at startup and blocking the URL sync above
    // (the input counts as "being edited" while focused).
    let handledFocusRequest = 0
    createEffect(
        () => useOmniboxFocus()(),
        (request) => {
            if (request === handledFocusRequest) return
            handledFocusRequest = request
            focusInput()
        },
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

    const parts = () => urlDisplayParts(value())

    return (
        <div class="omnibox-wrap">
            <div class="omnibox-overlay" ref={(el) => (overlay = el)} aria-hidden="true">
                <span class={parts().host ? "omnibox-muted" : ""}>{parts().prefix}</span>
                <span>{parts().host}</span>
                <span class={parts().host ? "omnibox-muted" : ""}>{parts().suffix}</span>
            </div>
            <input
                ref={(el) => (input = el)}
                class={{ omnibox: true }}
                type="text"
                spellcheck={false}
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
                onScroll={syncScroll}
            />
            <FavoriteStar />
        </div>
    )
}
