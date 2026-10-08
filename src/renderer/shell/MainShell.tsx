import { SETTINGS_URL } from "../../shared/settings"
import { Icon } from "../ui/Icon"
import { Sidebar } from "./sidebar/Sidebar"
import { initState, useSnapshot } from "./snapshot"
import { NavButtons } from "./toolbar/NavButtons"
import { OmniboxInput } from "./toolbar/OmniboxInput"
import { PinnedActions } from "./toolbar/PinnedActions"

import "./MainShell.css"

export const MainShell = () => {
    void initState()
    const snapshot = useSnapshot()
    const activeTabId = () => snapshot()?.activeTabId ?? null
    const activeTabUrl = () => {
        const snap = snapshot()
        return snap?.tabs.find((t) => t.id === snap.activeTabId)?.url ?? ""
    }

    let button: HTMLButtonElement | undefined

    const toggleExtensions = (): void => {
        if (!button) return
        const rect = button.getBoundingClientRect()
        window.arbor.extensionsToggle({ x: rect.x, y: rect.y, width: rect.width })
    }

    // There is one settings page, so opening it again selects the tab already showing it.
    const openSettings = (): void => {
        const snap = snapshot()
        const existing = snap?.tabs.find((tab) => tab.url.startsWith(SETTINGS_URL))
        if (existing) {
            void window.arbor.selectTab(existing.id)
            return
        }
        void window.arbor.createTab(SETTINGS_URL)
    }

    return (
        <div class="shell">
            <Sidebar />
            <main class="webview-area" />
            <footer class="toolbar">
                <NavButtons tabId={activeTabId()} />
                <OmniboxInput tabId={activeTabId()} url={activeTabUrl()} />
                <PinnedActions />
                <div class="extensions">
                    <button
                        type="button"
                        aria-label="Extensions"
                        ref={(el) => (button = el)}
                        onClick={toggleExtensions}
                    >
                        <Icon name="puzzle" />
                    </button>
                    <button type="button" aria-label="Settings" onClick={openSettings}>
                        <Icon name="settings" />
                    </button>
                </div>
            </footer>
        </div>
    )
}
