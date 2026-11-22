import type { NavigationState, TabId } from "../../../../shared/protocol"
import { Button } from "../../../common/Button/Button"

import "./NavButtons.css"

export const NavButtons = (props: { tabId: TabId | null; navigation: NavigationState }) => {
    // Middle click, and Cmd/Ctrl+click, open the destination in a background tab.
    const step =
        (direction: "goBack" | "goForward") =>
        (event: MouseEvent): void => {
            if (props.tabId === null) return
            if (event.metaKey || event.ctrlKey) {
                event.preventDefault()
                void window.arbor[direction]({ tabId: props.tabId, background: true })
                return
            }
            void window.arbor[direction]({ tabId: props.tabId })
        }
    const openInBackground =
        (direction: "goBack" | "goForward") =>
        (event: MouseEvent): void => {
            if (event.button !== 1 || props.tabId === null) return
            event.preventDefault()
            void window.arbor[direction]({ tabId: props.tabId, background: true })
        }

    return (
        <div class="nav-buttons">
            <Button
                icon="arrow-left"
                ariaLabel="Back"
                disabled={props.tabId === null || !props.navigation.canGoBack}
                onClick={step("goBack")}
                onAuxClick={openInBackground("goBack")}
            />
            <Button
                icon="arrow-right"
                ariaLabel="Forward"
                disabled={props.tabId === null || !props.navigation.canGoForward}
                onClick={step("goForward")}
                onAuxClick={openInBackground("goForward")}
            />
            <Button
                icon="reload"
                ariaLabel="Reload"
                disabled={props.tabId === null}
                onClick={() =>
                    props.tabId !== null && void window.arbor.reload({ tabId: props.tabId })
                }
            />
        </div>
    )
}
