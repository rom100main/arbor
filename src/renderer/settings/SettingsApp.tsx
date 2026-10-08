import { For, Match, Show, Switch, createEffect, createMemo, createSignal, untrack } from "solid-js"

import { settingsRoute, type SettingsRoute } from "../../shared/internal-pages"
import { SEARCH_ENGINES, SETTINGS_URL, THEMES, type Theme } from "../../shared/settings"
import { useSettings } from "../shell/settings"
import { Icon, type IconName } from "../ui/Icon"

import "./SettingsApp.css"

const NAV: { route: SettingsRoute; label: string; icon: IconName }[] = [
    { route: "search", label: "Search", icon: "search" },
    { route: "appearance", label: "Appearance", icon: "settings" },
]

const THEME_LABELS: Record<Theme, string> = {
    light: "Light",
    dark: "Dark",
    system: "System",
}

/** Each option shows the appearance it names, so the choice needs no reading. */
const THEME_ICONS: Record<Theme, IconName> = {
    light: "sun",
    dark: "moon",
    system: "device-desktop",
}

const routeUrl = (route: SettingsRoute): string => `${SETTINGS_URL}/${route}`

/**
 * Rendered inside the settings tab (`arbor://settings`, main/windows/internal-pages.ts).
 * Its route is the path, so the page has real URLs and a working back button.
 */
export const SettingsApp = () => {
    const [route, setRoute] = createSignal<SettingsRoute>(settingsRoute(window.location.href))

    window.addEventListener("popstate", () => setRoute(settingsRoute(window.location.href)))
    const navigate = (next: SettingsRoute): void => {
        history.pushState(null, "", routeUrl(next))
        setRoute(next)
    }

    return (
        <div class="settings-page">
            <nav class="settings-nav" aria-label="Settings sections">
                <For each={NAV}>
                    {(item) => (
                        <button
                            type="button"
                            class={{
                                "settings-nav-item": true,
                                active: route() === item.route,
                            }}
                            aria-current={route() === item.route ? "page" : undefined}
                            onClick={() => navigate(item.route)}
                        >
                            <Icon name={item.icon} size={15} />
                            <span>{item.label}</span>
                        </button>
                    )}
                </For>
            </nav>
            <main class="settings-content">
                <Switch>
                    <Match when={route() === "search"}>
                        <SearchSection />
                    </Match>
                    <Match when={route() === "appearance"}>
                        <AppearanceSection />
                    </Match>
                </Switch>
            </main>
        </div>
    )
}

const SearchSection = () => {
    const settings = useSettings()

    const [draft, setDraft] = createSignal(untrack(() => settings().searchTemplate))
    const [error, setError] = createSignal<string | null>(null)
    const [filter, setFilter] = createSignal("")

    // Another window (or a restored file) can change this underneath us.
    createEffect(
        () => settings().searchTemplate,
        (template) => {
            setDraft(template)
            setError(null)
        },
    )

    const apply = async (): Promise<void> => {
        const next = draft()
        try {
            await window.arbor.setSettings({ searchTemplate: next })
            setError(null)
        } catch {
            // The store refused it, so nothing was written: keep showing what is stored.
            setDraft(settings().searchTemplate)
            setError("Must contain %s and be a valid http(s) URL.")
        }
    }

    // Matching on the name is what makes typing narrow the list rather than hide the input's own value
    const shown = createMemo(() => {
        const needle = filter().trim().toLowerCase()
        if (needle.length === 0) return SEARCH_ENGINES
        return SEARCH_ENGINES.filter((engine) => engine.name.toLowerCase().includes(needle))
    })

    const choose = (template: string): void => {
        setDraft(template)
        setFilter("")
        setError(null)
        void window.arbor.setSettings({ searchTemplate: template })
    }

    return (
        <section>
            <h1>Search</h1>
            <label class="settings-field">
                <span class="settings-label">Search engine URL</span>
                <input
                    class={{ "settings-input": true, invalid: error() !== null }}
                    type="text"
                    spellcheck={false}
                    autocomplete="off"
                    value={draft()}
                    onInput={(event) => {
                        setDraft(event.currentTarget.value)
                        setFilter(event.currentTarget.value)
                        setError(null)
                    }}
                    onChange={() => void apply()}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") {
                            event.preventDefault()
                            void apply()
                        }
                    }}
                />
                <Show when={error()}>
                    <p class="settings-error">{error()}</p>
                </Show>
                <p class="settings-hint">
                    <code>%s</code> is replaced with what your search query.
                </p>
            </label>
            <div class="settings-suggestions">
                <For each={shown()}>
                    {(engine) => (
                        <button
                            type="button"
                            class={{
                                "settings-suggestion": true,
                                active: draft() === engine.template,
                            }}
                            disabled={draft() === engine.template}
                            onClick={() => choose(engine.template)}
                        >
                            {engine.name}
                        </button>
                    )}
                </For>
            </div>
            <p class="settings-hint">
                Anything else works: put <code>%s</code> anywhere in a search URL. Type a name to
                narrow the suggestions, or paste a template straight in.
            </p>
        </section>
    )
}

const AppearanceSection = () => {
    const settings = useSettings()
    return (
        <section>
            <h1>Appearance</h1>
            <div class="settings-theme">
                <For each={THEMES}>
                    {(theme) => (
                        <label
                            class={{
                                "settings-theme-option": true,
                                active: settings().theme === theme,
                            }}
                        >
                            <input
                                type="radio"
                                name="theme"
                                value={theme}
                                checked={settings().theme === theme}
                                onChange={() => void window.arbor.setSettings({ theme })}
                            />
                            <Icon name={THEME_ICONS[theme]} size={16} />
                            <span>{THEME_LABELS[theme]}</span>
                        </label>
                    )}
                </For>
            </div>
            <p class="settings-hint">
                System follows your operating system. Arbor's own interface follows this choice but
                websites keep following the system.
            </p>
        </section>
    )
}
