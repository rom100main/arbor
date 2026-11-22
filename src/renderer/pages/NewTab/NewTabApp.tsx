import { Show, createSignal, onCleanup } from "solid-js"

import { chromeInsets, SETTINGS_URL } from "../../../shared/settings"
import { Icon } from "../../common/Icon/Icon"
import { useSettings } from "../../common/store/settings"
import { initState, useSnapshot } from "../../common/store/snapshot"

import "./NewTabApp.css"

/**
 * Rendered inside the new-tab page.
 * Its search bar drives the same omnibox popup as the URL bar:
 * typing shows suggestions, Enter navigates this tab to the chosen target.
 */
export const NewTabApp = () => {
    void initState()
    const settings = useSettings()
    const snapshot = useSnapshot()
    const [value, setValue] = createSignal("")
    const [fullscreen, setFullscreen] = createSignal(false)
    onCleanup(window.arbor.onFullscreen(setFullscreen))

    let input: HTMLInputElement | undefined

    const background = (): string =>
        settings().newTabBackgroundKind === "image" && settings().newTabBackgroundImage
            ? `url("${settings().newTabBackgroundImage}") center / cover no-repeat`
            : settings().newTabBackgroundKind === "theme"
              ? "var(--color-bg)"
              : settings().newTabBackgroundColor

    const rectFor = (
        el: HTMLElement,
    ): { x: number; y: number; width: number; height: number; below: boolean } => {
        const rect = el.getBoundingClientRect()
        const left = chromeInsets(settings(), fullscreen()).left
        return { x: rect.x + left, y: rect.y, width: rect.width, height: rect.height, below: true }
    }

    const sendQuery = (query: string): void => {
        if (!input) return
        window.arbor.omniboxUpdate({ query, rect: rectFor(input) })
    }

    const hidePopup = (): void => {
        window.arbor.omniboxUpdate({ query: "", rect: null })
    }

    // A new-tab page left open while its tab navigates away must not leave a stale popup.
    onCleanup(() => hidePopup())

    const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === "Enter") {
            event.preventDefault()
            window.arbor.omniboxActivateSelected()
            return
        }
        if (event.key === "Escape") {
            event.preventDefault()
            setValue("")
            hidePopup()
            return
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault()
            window.arbor.omniboxMoveSelection(event.key === "ArrowDown" ? 1 : -1)
        }
    }

    const openNewTabSettings = (): void => {
        hidePopup()
        const route = `${SETTINGS_URL}/newtab`
        const existing = snapshot()?.tabs.find((tab) => tab.url.startsWith(route))
        if (existing) {
            void window.arbor.selectTab({ tabId: existing.id })
            return
        }
        void window.arbor.createTab({ url: route })
    }

    return (
        <div class="newtab-page" style={{ background: background() }}>
            <Show when={settings().newTabShowSearchBar}>
                <div class="newtab-center">
                    <label class="newtab-search" aria-label="Search">
                        <Icon name="search" size={18} />
                        <input
                            ref={(el) => (input = el)}
                            class="newtab-input"
                            type="text"
                            spellcheck={false}
                            autocomplete="off"
                            placeholder="Search or type a URL"
                            autofocus
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
                    </label>
                </div>
            </Show>
            <button
                type="button"
                class="newtab-edit"
                aria-label="Customize new tab page"
                title="Customize new tab page"
                onClick={openNewTabSettings}
            >
                <Icon name="pencil" size={16} />
                <span>Customize</span>
            </button>
        </div>
    )
}
