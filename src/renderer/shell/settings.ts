import { createSignal } from "solid-js"

import { DEFAULT_SETTINGS, type Settings } from "../../shared/settings"

const [settings, setSettings] = createSignal<Settings>(DEFAULT_SETTINGS)

let initialized = false

export const initSettings = async (): Promise<void> => {
    if (initialized) return
    initialized = true
    setSettings(await window.arbor.getSettings())
    window.arbor.onSettings(setSettings)
}

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
