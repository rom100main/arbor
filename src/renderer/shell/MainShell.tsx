import { Icon } from "../ui/Icon"
import { Sidebar } from "./sidebar/Sidebar"
import { initState, useSnapshot } from "./snapshot"
import { NavButtons } from "./toolbar/NavButtons"
import { OmniboxInput } from "./toolbar/OmniboxInput"

import "./MainShell.css"

export const MainShell = () => {
    void initState()
    const snapshot = useSnapshot()
    const activeTabId = () => snapshot()?.activeTabId ?? null
    const activeTabUrl = () => {
        const snap = snapshot()
        return snap?.tabs.find((t) => t.id === snap.activeTabId)?.url ?? ""
    }

    return (
        <div class="shell">
            <Sidebar />
            <main class="webview-area" />
            <footer class="toolbar">
                <NavButtons tabId={activeTabId()} />
                <OmniboxInput tabId={activeTabId()} url={activeTabUrl()} />
                <div class="extensions">
                    <button type="button" aria-label="Extensions">
                        <Icon name="puzzle" />
                    </button>
                </div>
            </footer>
        </div>
    )
}
