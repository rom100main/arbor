import { HISTORY_URL, INTERNAL_SCHEME, NEW_TAB_URL } from "../shared/settings"
import { initSettings } from "./common/store/settings"
import { HistoryApp } from "./pages/History/HistoryApp"
import { NewTabApp } from "./pages/NewTab/NewTabApp"
import { SettingsApp } from "./pages/Settings/SettingsApp"
import { DownloadsPopup } from "./popups/Downloads/DownloadsPopup"
import { ExtensionsPopup } from "./popups/Extensions/ExtensionsPopup"
import { FavoritesPopup } from "./popups/Favorites/FavoritesPopup"
import { FindBar } from "./popups/Find/FindBar"
import { OmniboxPopup } from "./popups/Omnibox/OmniboxPopup"
import { PermissionApp } from "./popups/Permissions/PermissionApp"
import { RenameApp } from "./popups/Rename/RenameApp"
import { MainShell } from "./shell/MainShell"

import "./base.css"

export default function App() {
    // Every mode shares one bootstrap: settings hydration also applies the theme.
    void initSettings()
    const appMode = getAppMode()
    if (appMode === "omnibox") return <OmniboxPopup />
    if (appMode === "rename") return <RenameApp />
    if (appMode === "extensions") return <ExtensionsPopup />
    if (appMode === "downloads") return <DownloadsPopup />
    if (appMode === "favorites") return <FavoritesPopup />
    if (appMode === "permission") return <PermissionApp />
    if (appMode === "history") return <HistoryApp />
    if (appMode === "newtab") return <NewTabApp />
    if (appMode === "settings") return <SettingsApp />
    if (appMode === "find") return <FindBar />
    return <MainShell />
}

type AppMode =
    | "main"
    | "omnibox"
    | "rename"
    | "extensions"
    | "downloads"
    | "favorites"
    | "permission"
    | "settings"
    | "history"
    | "newtab"
    | "find"

const getAppMode = (): AppMode => {
    // Internal pages carry their route in the path, not a query param: arbor://settings/search.
    if (window.location.href.startsWith(HISTORY_URL)) return "history"
    if (window.location.href.startsWith(NEW_TAB_URL)) return "newtab"
    if (window.location.protocol === `${INTERNAL_SCHEME}:`) return "settings"
    const searchParams = new URLSearchParams(window.location.search)
    if (searchParams.has("omnibox")) return "omnibox"
    if (searchParams.has("rename")) return "rename"
    if (searchParams.has("extensions")) return "extensions"
    if (searchParams.has("downloads")) return "downloads"
    if (searchParams.has("favorites")) return "favorites"
    if (searchParams.has("permission")) return "permission"
    if (searchParams.has("find")) return "find"
    return "main"
}
