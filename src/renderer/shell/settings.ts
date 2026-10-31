import { createSignal } from "solid-js"

import { DEFAULT_SETTINGS, type Settings } from "../../shared/settings"
import { createInit } from "./init-store"

const [settings, setSettings] = createSignal<Settings>(DEFAULT_SETTINGS)

export const useSettings = () => settings

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)")

const applyTheme = (theme: Settings["theme"]): void => {
    document.documentElement.dataset.theme =
        theme === "system" ? (darkQuery.matches ? "dark" : "light") : theme
}

// Paint before settings arrive, so a dark system never flashes light.
applyTheme(DEFAULT_SETTINGS.theme)

darkQuery.addEventListener("change", () => {
    if (settings().theme === "system") applyTheme("system")
})

/**
 * Hydrate settings for this window and apply them to it.
 * Theme is part of settings, so every window (popups included) is themed by this alone.
 */
export const initSettings = createInit<Settings>({
    subscribe: (callback) => window.arbor.onSettings(callback),
    fetch: async () => (await window.arbor.getSettings()).value,
    apply: (value) => {
        setSettings(value)
        applyTheme(value.theme)
    },
})
