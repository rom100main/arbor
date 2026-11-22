import { createSignal } from "solid-js"

import { displayTabLabel } from "../../../shared/url"
import { Icon } from "../../ui/Icon"
import { initFavorites, useFavorites } from "../favorites"
import { useSnapshot } from "../snapshot"

import "./FavoritesButtons.css"

const isStarrable = (url: string): boolean => url.length > 0 && url !== "about:blank"

export const FavoriteStar = () => {
    void initFavorites()
    const favorites = useFavorites()
    const snapshot = useSnapshot()
    const [busy, setBusy] = createSignal(false)

    const activeTab = () => {
        const snap = snapshot()
        if (!snap || !snap.activeTabId) return null
        return snap.tabs.find((t) => t.id === snap.activeTabId) ?? null
    }
    const existing = () => {
        const tab = activeTab()
        if (!tab || !isStarrable(tab.url)) return null
        return favorites().nodes.find((n) => n.url === tab.url) ?? null
    }

    let button: HTMLButtonElement | undefined
    const anchor = () => {
        if (!button) return null
        const rect = button.getBoundingClientRect()
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }

    const toggle = async (): Promise<void> => {
        const tab = activeTab()
        if (!tab || !isStarrable(tab.url)) return
        const current = existing()
        const rect = anchor()
        if (!rect) return
        if (current) {
            window.arbor.favoritesToggle({ anchor: rect, mode: "add", favoriteId: current.id })
            return
        }
        if (busy()) return
        setBusy(true)
        try {
            const reply = await window.arbor.favoritesAdd({
                name: displayTabLabel(tab),
                url: tab.url,
                favicon: tab.favicon,
                parentId: null,
            })
            window.arbor.favoritesToggle({ anchor: rect, mode: "add", favoriteId: reply.value })
        } finally {
            setBusy(false)
        }
    }

    const disabled = () => !isStarrable(activeTab()?.url ?? "")
    const label = () => (existing() ? "Edit favorite" : "Add favorite")

    return (
        <button
            type="button"
            class={{ "favorite-star": true, active: existing() !== null }}
            ref={(el) => (button = el)}
            aria-label={label()}
            aria-pressed={existing() !== null ? "true" : "false"}
            title={label()}
            disabled={disabled() || busy()}
            onClick={() => void toggle()}
        >
            <Icon name="star" />
        </button>
    )
}

export const FavoritesListButton = () => {
    let button: HTMLButtonElement | undefined
    const toggle = (): void => {
        if (!button) return
        const rect = button.getBoundingClientRect()
        window.arbor.favoritesToggle({
            anchor: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            mode: "list",
            favoriteId: null,
        })
    }
    return (
        <button
            type="button"
            ref={(el) => (button = el)}
            aria-label="Favorites"
            title="Favorites"
            onClick={toggle}
        >
            <Icon name="bookmark" />
        </button>
    )
}
