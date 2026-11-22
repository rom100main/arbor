import { createSignal } from "solid-js"

import { displayTabLabel } from "../../../../shared/url"
import { Button } from "../../../common/Button/Button"
import { initFavorites, useFavorites } from "../../../common/store/favorites"
import { useSnapshot } from "../../../common/store/snapshot"

import "./FavoriteStar.css"

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
        <Button
            icon="star"
            class="favorite-star"
            ariaLabel={label()}
            pressed={existing() !== null}
            title={label()}
            disabled={disabled() || busy()}
            active={existing() !== null}
            ref={(el) => (button = el)}
            onClick={() => void toggle()}
        />
    )
}
