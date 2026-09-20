import { OmniboxPopup } from "./omnibox/OmniboxPopup"
import { RenameApp } from "./rename/RenameApp"
import { MainShell } from "./shell/MainShell"

import "./app.css"

export default function App() {
    const appMode = getAppMode()
    if (appMode === "omnibox") return <OmniboxPopup />
    if (appMode === "rename") return <RenameApp />
    return <MainShell />
}

type AppMode = "main" | "omnibox" | "rename"

const getAppMode = (): AppMode => {
    const searchParams = new URLSearchParams(window.location.search)
    if (searchParams.has("omnibox")) return "omnibox"
    if (searchParams.has("rename")) return "rename"
    return "main"
}
