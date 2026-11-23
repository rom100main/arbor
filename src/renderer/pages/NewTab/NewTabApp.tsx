import { For, Show, createSignal, onCleanup } from "solid-js"

import { NEW_TAB_FAVORITES_FOLDER_ID } from "../../../shared/constants"
import type { FavoriteNode } from "../../../shared/protocol"
import { chromeInsets, SETTINGS_URL } from "../../../shared/settings"
import { Favicon } from "../../common/Favicon/Favicon"
import { Icon } from "../../common/Icon/Icon"
import { initFavorites, useFavorites } from "../../common/store/favorites"
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
    void initFavorites()
    const settings = useSettings()
    const snapshot = useSnapshot()
    const favorites = useFavorites()
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

    // The protected "New Tab" favorites folder, flattened depth-first:
    // subfolders contribute their bookmarks but are not shown themselves.
    const newTabFavorites = (): FavoriteNode[] => {
        const nodes = favorites().nodes
        const childrenByParent = new Map<string | null, FavoriteNode[]>()
        for (const node of nodes) {
            const bucket = childrenByParent.get(node.parentId) ?? []
            bucket.push(node)
            childrenByParent.set(node.parentId, bucket)
        }
        for (const siblings of childrenByParent.values()) {
            siblings.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
        }
        const out: FavoriteNode[] = []
        const walk = (parentId: string | null): void => {
            for (const node of childrenByParent.get(parentId) ?? []) {
                if (node.url !== null) out.push(node)
                else walk(node.id)
            }
        }
        walk(NEW_TAB_FAVORITES_FOLDER_ID)
        return out
    }

    const openFavorite = (favorite: FavoriteNode, event: MouseEvent): void => {
        if (favorite.url === null) return
        void window.arbor.favoritesOpen({
            url: favorite.url,
            newTab: event.metaKey || event.ctrlKey,
        })
    }

    // A bookmark starred before its favicon arrived has none stored:
    // ask the site for its conventional icon instead of showing a placeholder.
    const faviconUrl = (favorite: FavoriteNode): string | null => {
        if (favorite.favicon) return favorite.favicon
        if (favorite.url === null) return null
        try {
            const parsed = new URL(favorite.url)
            return parsed.protocol === "http:" || parsed.protocol === "https:"
                ? `${parsed.origin}/favicon.ico`
                : null
        } catch {
            return null
        }
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
            <Show when={newTabFavorites().length > 0}>
                <div class="newtab-favorites">
                    <For each={newTabFavorites()}>
                        {(favorite) => (
                            <button
                                type="button"
                                class="newtab-favorite"
                                title={favorite.url ?? favorite.name}
                                onClick={(event) => openFavorite(favorite, event)}
                            >
                                <Favicon url={faviconUrl(favorite)} size={14} />
                                <span>{favorite.name}</span>
                            </button>
                        )}
                    </For>
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
