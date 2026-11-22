import { For, Match, Show, Switch, createEffect, createMemo, createSignal, untrack } from "solid-js"

import {
    HISTORY_RETENTIONS,
    HISTORY_URL,
    NEW_TAB_BACKGROUND_KINDS,
    SETTINGS_URL,
    SIDEBAR_VISIBILITIES,
    THEMES,
    URL_BAR_VISIBILITIES,
    type HistoryRetention,
    type NewTabBackgroundKind,
    type SidebarVisibility,
    type Theme,
    type UrlBarVisibility,
} from "../../../shared/settings"
import { Button } from "../../common/Button/Button"
import { Icon, type IconName } from "../../common/Icon/Icon"
import { useSettings } from "../../common/store/settings"
import { settingsRoute, type SettingsRoute } from "./routes"
import { SEARCH_ENGINES } from "./search-engines"

import "./SettingsApp.css"

const NAV: { route: SettingsRoute; label: string; icon: IconName }[] = [
    { route: "general", label: "General", icon: "device-desktop" },
    { route: "search", label: "Search", icon: "search" },
    { route: "newtab", label: "New Tab", icon: "home" },
    { route: "downloads", label: "Downloads", icon: "download" },
    { route: "history", label: "History", icon: "history" },
    { route: "adblocking", label: "Ad blocking", icon: "shield" },
    { route: "extensions", label: "Extensions", icon: "puzzle" },
    { route: "appearance", label: "Appearance", icon: "settings" },
]

/** The store Arbor's extensions install from (kept in sync with the main process's WEBSTORE_ORIGIN). */
const WEB_STORE_URL = "https://chromewebstore.google.com/"

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

type AdblockMode = "on" | "off"

const ADBLOCK_MODES = ["on", "off"] as const

const ADBLOCK_MODE_LABELS: Record<AdblockMode, string> = {
    on: "Block ads and tracking",
    off: "Don't block",
}

const ADBLOCK_MODE_ICONS: Record<AdblockMode, IconName> = {
    on: "shield",
    off: "shield-off",
}

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
                        <Button
                            icon={item.icon}
                            iconSize={15}
                            variant="stealth"
                            type="button"
                            class={{
                                "settings-nav-item": true,
                                active: route() === item.route,
                            }}
                            aria-current={route() === item.route ? "page" : undefined}
                            onClick={() => navigate(item.route)}
                        >
                            {item.label}
                        </Button>
                    )}
                </For>
            </nav>
            <main class="settings-content">
                <Switch>
                    <Match when={route() === "general"}>
                        <GeneralSection />
                    </Match>
                    <Match when={route() === "newtab"}>
                        <NewTabSection />
                    </Match>
                    <Match when={route() === "search"}>
                        <SearchSection />
                    </Match>
                    <Match when={route() === "downloads"}>
                        <DownloadsSection />
                    </Match>
                    <Match when={route() === "history"}>
                        <HistorySection />
                    </Match>
                    <Match when={route() === "adblocking"}>
                        <AdblockingSection />
                    </Match>
                    <Match when={route() === "extensions"}>
                        <ExtensionsSection />
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
            <div class="settings-group">
                <h2>Search engine URL</h2>
                <input
                    class={{ "settings-input": true, invalid: error() !== null }}
                    aria-label="Search engine URL"
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
            </div>
            <div class="settings-suggestions">
                <For each={shown()}>
                    {(engine) => (
                        <Button
                            type="button"
                            class={{
                                "settings-suggestion": true,
                                active: draft() === engine.template,
                            }}
                            disabled={draft() === engine.template}
                            onClick={() => choose(engine.template)}
                        >
                            {engine.name}
                        </Button>
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
                    <Button
                        icon="folder"
                        iconSize={14}
                        type="button"
                        class="settings-button"
                        onClick={() => void window.arbor.downloadsOpenFolder()}
                    >
                        Open folder
                    </Button>
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
                <Button
                    icon="history"
                    iconSize={14}
                    type="button"
                    class="settings-button"
                    onClick={() => void window.arbor.createTab({ url: HISTORY_URL })}
                >
                    Open history
                </Button>
            </div>
        </section>
    )
}

const AdblockingSection = () => {
    const settings = useSettings()
    const [draft, setDraft] = createSignal("")

    const mode = (): AdblockMode => (settings().adblockEnabled ? "on" : "off")

    const chooseMode = (next: AdblockMode): void => {
        void window.arbor.setSettings({ adblockEnabled: next === "on" })
    }

    const addSite = (): void => {
        const pattern = draft().trim()
        if (pattern.length === 0 || settings().adblockDisabledSites.includes(pattern)) {
            setDraft("")
            return
        }
        setDraft("")
        void window.arbor.setSettings({
            adblockDisabledSites: [...settings().adblockDisabledSites, pattern],
        })
    }

    const removeSite = (pattern: string): void => {
        void window.arbor.setSettings({
            adblockDisabledSites: settings().adblockDisabledSites.filter(
                (site) => site !== pattern,
            ),
        })
    }

    return (
        <section>
            <h1>Ad blocking</h1>
            <div class="settings-group">
                <h2>Protection</h2>
                <OptionCards
                    name="adblock-mode"
                    label="Protection"
                    options={ADBLOCK_MODES}
                    labels={ADBLOCK_MODE_LABELS}
                    icons={ADBLOCK_MODE_ICONS}
                    value={mode()}
                    onChange={chooseMode}
                    variant="wide"
                />
                <p class="settings-hint">
                    Powered by <a href="https://www.ghostery.com/">Ghostery</a>.
                </p>
            </div>
            <div class="settings-group">
                <h2>Sites without blocking</h2>
                <div class="settings-disabled-row">
                    <input
                        class="settings-input settings-disabled-input"
                        aria-label="Website to disable ad blocking for"
                        type="text"
                        spellcheck={false}
                        autocomplete="off"
                        placeholder="example.com or *.example.com"
                        value={draft()}
                        onInput={(event) => setDraft(event.currentTarget.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                event.preventDefault()
                                addSite()
                            }
                        }}
                    />
                    <Button
                        icon="plus"
                        iconSize={14}
                        type="button"
                        class="settings-button"
                        disabled={draft().trim().length === 0}
                        onClick={addSite}
                    >
                        Add
                    </Button>
                </div>
                <Show when={settings().adblockDisabledSites.length > 0}>
                    <ul class="settings-disabled-list">
                        <For each={settings().adblockDisabledSites}>
                            {(site) => (
                                <li class="settings-disabled-item">
                                    <code>{site}</code>
                                    <Button
                                        icon="x"
                                        iconSize={13}
                                        size="sm"
                                        type="button"
                                        class="settings-disabled-remove"
                                        aria-label={`Remove ${site}`}
                                        onClick={() => removeSite(site)}
                                    />
                                </li>
                            )}
                        </For>
                    </ul>
                </Show>
                <p class="settings-hint">
                    Use <code>*</code> to match anything:
                    <code>*.example.com</code> covers every subdomain, or
                    <code>https://example.com/*</code> matches a path.
                </p>
            </div>
        </section>
    )
}

const ExtensionsSection = () => (
    <section>
        <h1>Extensions</h1>
        <div class="settings-group">
            <h2>Install</h2>
            <Button
                icon="puzzle"
                iconSize={14}
                type="button"
                class="settings-button"
                onClick={() => void window.arbor.createTab({ url: WEB_STORE_URL })}
            >
                Open Chrome Web Store
            </Button>
            <p class="settings-hint">You can install extensions from the Chrome Web Store.</p>
        </div>
        <div class="settings-group">
            <h2>Dev extensions</h2>
            <Button
                icon="folder"
                iconSize={14}
                type="button"
                class="settings-button"
                onClick={() => void window.arbor.extensionsOpenDevFolder()}
            >
                Open dev-extensions folder
            </Button>
            <p class="settings-hint">
                Drop unpacked extensions in this folder for development. They will load on startup
                after you approve them.
            </p>
        </div>
    </section>
)

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

interface DefaultBrowserStatus {
    readonly isDefault: boolean
    readonly platform: string
}

const GeneralSection = () => {
    const [status, setStatus] = createSignal<DefaultBrowserStatus | null>(null)
    const [error, setError] = createSignal<string | null>(null)
    const [working, setWorking] = createSignal(false)

    const refresh = async (): Promise<void> => {
        const reply = await window.arbor.getDefaultBrowserStatus()
        if (reply.ok) setStatus(reply.value)
    }
    void refresh()

    const makeDefault = async (): Promise<void> => {
        setWorking(true)
        setError(null)
        const reply = await window.arbor.setDefaultBrowser()
        setWorking(false)
        if (reply.ok) {
            setStatus(reply.value)
            return
        }
        setError(reply.error.message)
        void refresh()
    }

    const platformHint = (): string => {
        const platform = status()?.platform
        if (platform === "darwin") {
            return "On macOS, clicking the button may open System Settings to confirm Arbor as the default browser."
        }
        if (platform === "linux") {
            return "On Linux, Arbor must be installed with its .desktop file (the packaged AppImage) for the OS to offer it as a browser."
        }
        return "On Windows, clicking the button registers Arbor for http and https links."
    }

    return (
        <section>
            <h1>General</h1>
            <div class="settings-group">
                <h2>Default browser</h2>
                <p class="settings-hint">
                    {status() === null
                        ? "Checking…"
                        : status()?.isDefault
                          ? "Arbor is the default browser for http and https links."
                          : "Arbor is not the default browser yet."}
                </p>
                <Button
                    icon="device-desktop"
                    iconSize={14}
                    type="button"
                    class="settings-button"
                    disabled={working() || status()?.isDefault === true}
                    onClick={() => void makeDefault()}
                >
                    {working() ? "Setting…" : "Make Arbor the default browser"}
                </Button>
                <Show when={error()}>
                    <p class="settings-error">{error()}</p>
                </Show>
                <p class="settings-hint">{platformHint()}</p>
            </div>
        </section>
    )
}

const NEW_TAB_KIND_LABELS: Record<NewTabBackgroundKind, string> = {
    theme: "Theme",
    color: "Color",
    image: "Image",
}

const NEW_TAB_KIND_ICONS: Record<NewTabBackgroundKind, IconName> = {
    theme: "device-desktop",
    color: "sun",
    image: "photo",
}

type SearchBarMode = "show" | "hide"

const SEARCH_BAR_MODES = ["show", "hide"] as const

const SEARCH_BAR_LABELS: Record<SearchBarMode, string> = {
    show: "Show search bar",
    hide: "Hide search bar",
}

const SEARCH_BAR_ICONS: Record<SearchBarMode, IconName> = {
    show: "search",
    hide: "x",
}

/** Read an image file as a resized AVIF data URL (4K max, quality 60), so settings.json stays small. */
const fileToBackgroundImage = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file)
        const image = new Image()
        image.onload = () => {
            const maxSide = 3840
            const scale = Math.min(1, maxSide / Math.max(image.width, image.height))
            const canvas = document.createElement("canvas")
            canvas.width = Math.max(1, Math.round(image.width * scale))
            canvas.height = Math.max(1, Math.round(image.height * scale))
            const ctx = canvas.getContext("2d")
            if (!ctx) {
                URL.revokeObjectURL(url)
                reject(new Error("Could not read the image."))
                return
            }
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
            URL.revokeObjectURL(url)
            resolve(canvas.toDataURL("image/avif", 0.6))
        }
        image.onerror = () => {
            URL.revokeObjectURL(url)
            reject(new Error("Could not read the image."))
        }
        image.src = url
    })

const NewTabSection = () => {
    const settings = useSettings()
    const [error, setError] = createSignal<string | null>(null)
    let fileInput: HTMLInputElement | undefined

    const chooseImage = (event: Event & { currentTarget: HTMLInputElement }): void => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ""
        if (!file) return
        void (async () => {
            try {
                const dataUrl = await fileToBackgroundImage(file)
                const reply = await window.arbor.setSettings({
                    newTabBackgroundImage: dataUrl,
                    newTabBackgroundKind: "image",
                })
                setError(reply.ok ? null : reply.error.message)
            } catch {
                setError("Could not read the image.")
            }
        })()
    }

    const chooseColor = (event: Event & { currentTarget: HTMLInputElement }): void => {
        void (async () => {
            const reply = await window.arbor.setSettings({
                newTabBackgroundColor: event.currentTarget.value,
            })
            setError(reply.ok ? null : reply.error.message)
        })()
    }

    return (
        <section>
            <h1>New Tab</h1>
            <div class="settings-group">
                <h2>Background</h2>
                <OptionCards
                    name="newtab-background"
                    label="Background"
                    options={NEW_TAB_BACKGROUND_KINDS}
                    labels={NEW_TAB_KIND_LABELS}
                    icons={NEW_TAB_KIND_ICONS}
                    value={settings().newTabBackgroundKind}
                    onChange={(newTabBackgroundKind) =>
                        void window.arbor.setSettings({ newTabBackgroundKind })
                    }
                />
                <Show when={settings().newTabBackgroundKind === "theme"}>
                    <p class="settings-hint">
                        Follows your Appearance theme (Light, Dark or System).
                    </p>
                </Show>
                <Show when={settings().newTabBackgroundKind === "color"}>
                    <div class="settings-color-row">
                        <input
                            type="color"
                            aria-label="Background color"
                            value={settings().newTabBackgroundColor}
                            onChange={chooseColor}
                        />
                        <span class="settings-hint">{settings().newTabBackgroundColor}</span>
                    </div>
                </Show>
                <Show when={settings().newTabBackgroundKind === "image"}>
                    <Show
                        when={settings().newTabBackgroundImage}
                        fallback={<p class="settings-hint">No image yet. Choose one below.</p>}
                    >
                        <img
                            class="settings-image-preview"
                            src={settings().newTabBackgroundImage ?? ""}
                            alt="New tab background preview"
                        />
                    </Show>
                    <div class="settings-color-row">
                        <input
                            ref={(el) => (fileInput = el)}
                            type="file"
                            accept="image/*"
                            aria-label="Background image file"
                            hidden
                            onChange={chooseImage}
                        />
                        <Button
                            icon="photo"
                            iconSize={14}
                            type="button"
                            class="settings-button"
                            onClick={() => fileInput?.click()}
                        >
                            Choose image…
                        </Button>
                        <Show when={settings().newTabBackgroundImage}>
                            <Button
                                icon="x"
                                iconSize={14}
                                variant="danger"
                                type="button"
                                class="settings-button"
                                onClick={() =>
                                    void window.arbor.setSettings({
                                        newTabBackgroundImage: null,
                                        newTabBackgroundKind: "color",
                                    })
                                }
                            >
                                Remove image
                            </Button>
                        </Show>
                    </div>
                </Show>
                <Show when={error()}>
                    <p class="settings-error">{error()}</p>
                </Show>
            </div>
            <div class="settings-group">
                <h2>Search bar</h2>
                <OptionCards
                    name="newtab-search-bar"
                    label="Search bar"
                    options={SEARCH_BAR_MODES}
                    labels={SEARCH_BAR_LABELS}
                    icons={SEARCH_BAR_ICONS}
                    value={settings().newTabShowSearchBar ? "show" : "hide"}
                    onChange={(mode) =>
                        void window.arbor.setSettings({
                            newTabShowSearchBar: mode === "show",
                        })
                    }
                    variant="wide"
                />
            </div>
        </section>
    )
}
