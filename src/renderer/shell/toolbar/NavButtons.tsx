import type { TabId } from "../../../shared/protocol"
import { Icon } from "../../ui/Icon"

import "./NavButtons.css"

export const NavButtons = (props: { tabId: TabId | null }) => {
    // Middle click, and Cmd/Ctrl+click, open the destination in a background tab.
    const step = (direction: "goBack" | "goForward") => (event: MouseEvent): void => {
        if (props.tabId === null) return
        if (event.metaKey || event.ctrlKey) {
            event.preventDefault()
            void window.arbor[direction]({ tabId: props.tabId, background: true })
            return
        }
        void window.arbor[direction]({ tabId: props.tabId })
    }
    const openInBackground = (direction: "goBack" | "goForward") => (event: MouseEvent): void => {
        if (event.button !== 1 || props.tabId === null) return
        event.preventDefault()
        void window.arbor[direction]({ tabId: props.tabId, background: true })
    }

    return (
        <div class="nav-buttons">
            <button
                type="button"
                aria-label="Back"
                disabled={props.tabId === null}
                onClick={step("goBack")}
                onAuxClick={openInBackground("goBack")}
            >
                <Icon name="arrow-left" />
            </button>
            <button
                type="button"
                aria-label="Forward"
                disabled={props.tabId === null}
                onClick={step("goForward")}
                onAuxClick={openInBackground("goForward")}
            >
                <Icon name="arrow-right" />
            </button>
            <button
                type="button"
                aria-label="Reload"
                disabled={props.tabId === null}
                onClick={() =>
                    props.tabId !== null && void window.arbor.reload({ tabId: props.tabId })
                }
            >
                <Icon name="reload" />
            </button>
        </div>
    )
}
