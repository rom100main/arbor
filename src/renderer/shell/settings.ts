import { createSignal } from "solid-js"

import { DEFAULT_SETTINGS, type Settings } from "../../shared/settings"
import { createInit } from "./init-store"

const [settings, setSettings] = createSignal<Settings>(DEFAULT_SETTINGS)

export const initSettings = createInit<Settings>({
    subscribe: (callback) => window.arbor.onSettings(callback),
    fetch: () => window.arbor.getSettings(),
    apply: (value) => setSettings(value),
})

export const useSettings = () => settings

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)")

export const applyTheme = (theme: Settings["theme"]): void => {
    document.documentElement.dataset.theme =
        theme === "system" ? (darkQuery.matches ? "dark" : "light") : theme
}

export const watchSystemTheme = (theme: () => Settings["theme"]): void => {
    darkQuery.addEventListener("change", () => {
        if (theme() === "system") applyTheme("system")
    })
}
