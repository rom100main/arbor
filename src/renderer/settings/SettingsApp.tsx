import { For, Match, Show, Switch, createEffect, createMemo, createSignal, untrack } from "solid-js"

import {
    HISTORY_RETENTIONS,
    HISTORY_URL,
    SETTINGS_URL,
    SIDEBAR_VISIBILITIES,
    THEMES,
    URL_BAR_VISIBILITIES,
    type HistoryRetention,
    type SidebarVisibility,
    type Theme,
    type UrlBarVisibility,
} from "../../shared/settings"
import { useSettings } from "../shell/settings"
import { Icon, type IconName } from "../ui/Icon"
import { settingsRoute, type SettingsRoute } from "./routes"
import { SEARCH_ENGINES } from "./search-engines"

import "./SettingsApp.css"

const NAV: { route: SettingsRoute; label: string; icon: IconName }[] = [
    { route: "search", label: "Search", icon: "search" },
    { route: "downloads", label: "Downloads", icon: "download" },
    { route: "history", label: "History", icon: "history" },
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

const SIDEBAR_LABELS: Record<SidebarVisibility, string> = {
    displayed: "Displayed",
    compact: "Compact",
    hidden: "Hidden",
}

const SIDEBAR_ICONS: Record<SidebarVisibility, IconName> = {
    displayed: "layout-sidebar",
    compact: "layout-sidebar-left-collapse",
    hidden: "layout-sidebar-inactive",
}

const URL_BAR_LABELS: Record<UrlBarVisibility, string> = {
    displayed: "Displayed",
    hidden: "Hidden",
}

const URL_BAR_ICONS: Record<UrlBarVisibility, IconName> = {
    displayed: "layout-bottombar",
    hidden: "layout-bottombar-inactive",
}

/** The UI's view of `historyEnabled`, not a second stored field. */
type HistoryMode = "save" | "off"

const HISTORY_MODES = ["save", "off"] as const

const HISTORY_MODE_LABELS: Record<HistoryMode, string> = {
    save: "Save history",
    off: "Don't save",
}

const HISTORY_MODE_ICONS: Record<HistoryMode, IconName> = {
    save: "history",
    off: "history-off",
}

const HISTORY_RETENTION_LABELS: Record<HistoryRetention, string> = {
    never: "Never",
    "30d": "After 30 days",
    "90d": "After 90 days",
    "1y": "After 1 year",
    forever: "Forever",
}

const HISTORY_RETENTION_ICONS: Record<HistoryRetention, IconName> = {
    never: "clock",
    "30d": "clock",
    "90d": "clock",
    "1y": "clock",
    forever: "clock",
}

/** The UI's view of `downloadAskWhereToSave`, not a second stored field. */
type SaveMode = "ask" | "automatic"

const SAVE_MODES = ["ask", "automatic"] as const

const SAVE_MODE_LABELS: Record<SaveMode, string> = {
    ask: "Ask where to save",
    automatic: "Save to Downloads",
}

const SAVE_MODE_ICONS: Record<SaveMode, IconName> = {
    ask: "folder",
    automatic: "download",
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
                    <Match when={route() === "downloads"}>
                        <DownloadsSection />
                    </Match>
                    <Match when={route() === "history"}>
                        <HistorySection />
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
        const reply = await window.arbor.setSettings({ searchTemplate: draft() })
        if (reply.ok) {
            setError(null)
            return
        }
        // The store refused it, so nothing was written: keep showing what is stored.
        setDraft(settings().searchTemplate)
        setError(reply.error.message)
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

/** `wide` keeps long labels on one line, the plain variant is the compact card row. */
const OptionCards = <T extends string>(props: {
    name: string
    label: string
    options: readonly T[]
    labels: Record<T, string>
    icons: Record<T, IconName>
    value: T
    onChange: (value: T) => void
    variant?: "card" | "wide"
}) => (
    <div
        class={props.variant === "wide" ? "settings-wide-options" : "settings-options"}
        role="radiogroup"
        aria-label={props.label}
    >
        <For each={props.options}>
            {(option) => (
                <label
                    class={{
                        "settings-option": props.variant !== "wide",
                        "settings-wide-option": props.variant === "wide",
                        active: props.value === option,
                    }}
                >
                    <input
                        type="radio"
                        name={props.name}
                        value={option}
                        checked={props.value === option}
                        onChange={() => props.onChange(option)}
                    />
                    <Icon name={props.icons[option]} size={16} />
                    <span>{props.labels[option]}</span>
                </label>
            )}
        </For>
    </div>
)

const DownloadsSection = () => {
    const settings = useSettings()
    const [folder, setFolder] = createSignal("")

    // The folder comes with the list; it is the OS Downloads folder the service writes to.
    void (async () => {
        const reply = await window.arbor.downloadsList()
        setFolder(reply.value.folder)
    })()

    const mode = (): SaveMode => (settings().downloadAskWhereToSave ? "ask" : "automatic")

    const choose = (next: SaveMode): void => {
        void window.arbor.setSettings({ downloadAskWhereToSave: next === "ask" })
    }

    return (
        <section>
            <h1>Downloads</h1>
            <div class="settings-group">
                <h2>When a download starts</h2>
                <OptionCards
                    name="download-save-mode"
                    label="When a download starts"
                    options={SAVE_MODES}
                    labels={SAVE_MODE_LABELS}
                    icons={SAVE_MODE_ICONS}
                    value={mode()}
                    onChange={choose}
                    variant="wide"
                />
            </div>
            <div class="settings-group">
                <h2>Folder</h2>
                <div class="settings-folder">
                    <span class="settings-folder-path" title={folder()}>
                        {folder()}
                    </span>
                    <button
                        type="button"
                        class="settings-button"
                        onClick={() => void window.arbor.downloadsOpenFolder()}
                    >
                        <Icon name="folder" size={14} />
                        Open folder
                    </button>
                </div>
            </div>
        </section>
    )
}

const HistorySection = () => {
    const settings = useSettings()

    const mode = (): HistoryMode => (settings().historyEnabled ? "save" : "off")

    const chooseMode = (next: HistoryMode): void => {
        void window.arbor.setSettings({ historyEnabled: next === "save" })
    }

    return (
        <section>
            <h1>History</h1>
            <div class="settings-group">
                <h2>Saving history</h2>
                <OptionCards
                    name="history-mode"
                    label="Saving history"
                    options={HISTORY_MODES}
                    labels={HISTORY_MODE_LABELS}
                    icons={HISTORY_MODE_ICONS}
                    value={mode()}
                    onChange={chooseMode}
                    variant="wide"
                />
                <p class="settings-hint">
                    When off, no new visits are recorded. Existing entries are kept until you delete
                    them or the retention rule below removes them.
                </p>
            </div>
            <div class="settings-group">
                <h2>Delete automatically</h2>
                <OptionCards
                    name="history-retention"
                    label="Delete automatically"
                    options={HISTORY_RETENTIONS}
                    labels={HISTORY_RETENTION_LABELS}
                    icons={HISTORY_RETENTION_ICONS}
                    value={settings().historyRetention}
                    onChange={(historyRetention) =>
                        void window.arbor.setSettings({ historyRetention })
                    }
                />
            </div>
            <div class="settings-group">
                <h2>Manage</h2>
                <button
                    type="button"
                    class="settings-button"
                    onClick={() => void window.arbor.createTab({ url: HISTORY_URL })}
                >
                    <Icon name="history" size={14} />
                    Open history
                </button>
            </div>
        </section>
    )
}

const AppearanceSection = () => {
    const settings = useSettings()
    return (
        <section>
            <h1>Appearance</h1>
            <div class="settings-group">
                <h2>Theme</h2>
                <OptionCards
                    name="theme"
                    label="Theme"
                    options={THEMES}
                    labels={THEME_LABELS}
                    icons={THEME_ICONS}
                    value={settings().theme}
                    onChange={(theme) => void window.arbor.setSettings({ theme })}
                />
                <p class="settings-hint">
                    Arbor's own interface follows this choice but websites keep following the
                    system.
                </p>
            </div>
            <div class="settings-group">
                <h2>Tab sidebar</h2>
                <OptionCards
                    name="sidebar-visibility"
                    label="Tab sidebar"
                    options={SIDEBAR_VISIBILITIES}
                    labels={SIDEBAR_LABELS}
                    icons={SIDEBAR_ICONS}
                    value={settings().sidebarVisibility}
                    onChange={(sidebarVisibility) =>
                        void window.arbor.setSettings({ sidebarVisibility })
                    }
                />
            </div>
            <div class="settings-group">
                <h2>URL bar</h2>
                <OptionCards
                    name="url-bar-visibility"
                    label="URL bar"
                    options={URL_BAR_VISIBILITIES}
                    labels={URL_BAR_LABELS}
                    icons={URL_BAR_ICONS}
                    value={settings().urlBarVisibility}
                    onChange={(urlBarVisibility) =>
                        void window.arbor.setSettings({ urlBarVisibility })
                    }
                />
            </div>
        </section>
    )
}
