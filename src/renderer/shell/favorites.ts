import { createSignal } from "solid-js"

import type { FavoritesSnapshot } from "../../shared/protocol"
import { createInit } from "./init-store"

const EMPTY: FavoritesSnapshot = { nodes: [] }

const [favorites, setFavorites] = createSignal<FavoritesSnapshot>(EMPTY)

export const useFavorites = () => favorites

/**
 * Hydrate the favorites tree for this window:
 * subscribe to pushes first, then fetch the current list.
 */
export const initFavorites = createInit<FavoritesSnapshot>({
    subscribe: (callback) => window.arbor.onFavorites(callback),
    fetch: async () => (await window.arbor.favoritesList()).value,
    apply: (value) => setFavorites(value),
})
