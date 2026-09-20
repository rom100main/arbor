import type { TabId } from "../../../shared/protocol"
import { Icon } from "../../ui/Icon"

export const NavButtons = (props: { tabId: TabId | null }) => (
    <div class="nav-buttons">
        <button
            type="button"
            aria-label="Back"
            disabled={props.tabId === null}
            onClick={() => props.tabId !== null && void window.arbor.goBack(props.tabId)}
        >
            <Icon name="arrow-left" />
        </button>
        <button
            type="button"
            aria-label="Forward"
            disabled={props.tabId === null}
            onClick={() => props.tabId !== null && void window.arbor.goForward(props.tabId)}
        >
            <Icon name="arrow-right" />
        </button>
        <button
            type="button"
            aria-label="Reload"
            disabled={props.tabId === null}
            onClick={() => props.tabId !== null && void window.arbor.reload(props.tabId)}
        >
            <Icon name="reload" />
        </button>
    </div>
)
