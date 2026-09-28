import { ExtensionsPopup } from "./extensions/ExtensionsPopup"
import { OmniboxPopup } from "./omnibox/OmniboxPopup"
import { PermissionApp } from "./permissions/PermissionApp"
import { RenameApp } from "./rename/RenameApp"
import { MainShell } from "./shell/MainShell"

import "./base.css"

export default function App() {
    const appMode = getAppMode()
    if (appMode === "omnibox") return <OmniboxPopup />
    if (appMode === "rename") return <RenameApp />
    if (appMode === "extensions") return <ExtensionsPopup />
    if (appMode === "permission") return <PermissionApp />
    return <MainShell />
}

type AppMode = "main" | "omnibox" | "rename" | "extensions" | "permission"

const getAppMode = (): AppMode => {
    const searchParams = new URLSearchParams(window.location.search)
    if (searchParams.has("omnibox")) return "omnibox"
    if (searchParams.has("rename")) return "rename"
    if (searchParams.has("extensions")) return "extensions"
    if (searchParams.has("permission")) return "permission"
    return "main"
}
