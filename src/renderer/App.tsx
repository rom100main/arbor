import { INTERNAL_SCHEME } from "../shared/settings"
import { ExtensionsPopup } from "./extensions/ExtensionsPopup"
import { OmniboxPopup } from "./omnibox/OmniboxPopup"
import { PermissionApp } from "./permissions/PermissionApp"
import { RenameApp } from "./rename/RenameApp"
import { SettingsApp } from "./settings/SettingsApp"
import { MainShell } from "./shell/MainShell"
import { initSettings } from "./shell/settings"

import "./base.css"

export default function App() {
    // Every mode shares one bootstrap: settings hydration also applies the theme.
    void initSettings()
    const appMode = getAppMode()
    if (appMode === "omnibox") return <OmniboxPopup />
    if (appMode === "rename") return <RenameApp />
    if (appMode === "extensions") return <ExtensionsPopup />
    if (appMode === "permission") return <PermissionApp />
    if (appMode === "settings") return <SettingsApp />
    return <MainShell />
}

type AppMode = "main" | "omnibox" | "rename" | "extensions" | "permission" | "settings"

const getAppMode = (): AppMode => {
    // Internal pages carry their route in the path, not a query param: arbor://settings/search.
    if (window.location.protocol === `${INTERNAL_SCHEME}:`) return "settings"
    const searchParams = new URLSearchParams(window.location.search)
    if (searchParams.has("omnibox")) return "omnibox"
    if (searchParams.has("rename")) return "rename"
    if (searchParams.has("extensions")) return "extensions"
    if (searchParams.has("permission")) return "permission"
    return "main"
}
