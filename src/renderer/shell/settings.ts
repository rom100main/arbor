import { createSignal } from "solid-js"

import { DEFAULT_SETTINGS, type Settings } from "../../shared/settings"

const [settings, setSettings] = createSignal<Settings>(DEFAULT_SETTINGS)

let initPromise: Promise<void> | null = null

/**
 * Subscribe before fetching so a push during the initial read is not lost.
 * A late initial response never overwrites a newer push.
 * Failed initialization resets so retry is possible.
 */
export const initSettings = (): Promise<void> => {
    if (!initPromise) initPromise = doInit()
    return initPromise
}

const doInit = async (): Promise<void> => {
    let pushed = false
    window.arbor.onSettings((next) => {
        pushed = true
        setSettings(next)
    })
    try {
        const initial = await window.arbor.getSettings()
        if (!pushed) setSettings(initial)
    } catch (error) {
        initPromise = null
        throw error
    }
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
