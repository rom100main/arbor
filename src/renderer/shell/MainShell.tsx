import { onCleanup } from "solid-js"

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
    // Clicking anywhere outside the button dismisses the extensions popup.
    const onDocClick = (event: MouseEvent): void => {
        const target = event.target
        if (target instanceof Node && button && !button.contains(target)) {
            window.arbor.extensionsClose()
        }
    }
    document.addEventListener("click", onDocClick)
    onCleanup(() => document.removeEventListener("click", onDocClick))

    const toggleExtensions = (): void => {
        if (!button) return
        const rect = button.getBoundingClientRect()
        window.arbor.extensionsToggle({ x: rect.x, y: rect.y, width: rect.width })
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
                </div>
            </footer>
        </div>
    )
}
