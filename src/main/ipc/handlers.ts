import { Effect } from "effect"

import { NoActionPopup, NoWindow } from "../../shared/errors"
import type { TabId } from "../../shared/protocol"
import { runBackground } from "../exec"
import { pinnedActionInfo } from "../extension/action"
import { sessionForExtension } from "../extension/loader"
import type { DomainState } from "../state/state"
import { openExtensionActionPopup, setExtensionAnchor } from "../windows/overlays"
import { existingSessionForContainer, viewForTab } from "../windows/tab-views"
import type { HostRuntime } from "./events"
import type { RequestHandlers } from "./router"

const actionPopupSession = (state: DomainState, extensionId: string): Electron.Session =>
    sessionForExtension(
        extensionId,
        state.activeContainerId ? existingSessionForContainer(state.activeContainerId) : undefined,
    )

/** Back, forward and reload do nothing for a tab with no live view. */
const withView = (tabId: TabId, f: (wc: Electron.WebContents) => void): Effect.Effect<void> =>
    Effect.sync(() => {
        const view = viewForTab(tabId)
        if (view) f(view.webContents)
    })

export const requestHandlers = (rt: HostRuntime): RequestHandlers<never> => {
    const { store, settings } = rt
    return {
        getSnapshot: () => store.snapshot,
        getSettings: () => settings.get,
        setSettings: (patch) => settings.set(patch),

        extensionActionInfo: ({ extensionId }) => Effect.sync(() => pinnedActionInfo(extensionId)),
        openExtensionActionPopup: ({ extensionId, anchor }) =>
            Effect.gen(function* () {
                const { popupUrl } = pinnedActionInfo(extensionId)
                if (!popupUrl) return yield* new NoActionPopup({ extensionId })
                const win = rt.win
                if (!win) return yield* new NoWindow()
                if (anchor) setExtensionAnchor(extensionId, anchor)
                const state = yield* store.state
                return openExtensionActionPopup(
                    win,
                    extensionId,
                    popupUrl,
                    actionPopupSession(state, extensionId),
                    (url) => {
                        void runBackground(store.createTab(url))
                    },
                )
            }),

        createContainer: ({ name, color }) => store.createContainer(name, color),
        switchContainer: ({ containerId }) => store.switchContainer(containerId),
        renameContainer: ({ containerId, name }) => store.renameContainer(containerId, name),
        setContainerColor: ({ containerId, color }) => store.setContainerColor(containerId, color),
        setContainerIcon: ({ containerId, icon }) => store.setContainerIcon(containerId, icon),
        reorderContainer: ({ containerId, toIndex }) =>
            store.reorderContainer(containerId, toIndex),

        createTab: ({ url }) => store.createTab(url),
        selectTab: ({ tabId }) => store.selectTab(tabId),
        setCollapsed: ({ tabId, collapsed }) => store.setCollapsed(tabId, collapsed),
        closeTab: ({ tabId }) => store.closeTab(tabId),
        renameTab: ({ tabId, label }) => store.renameTab(tabId, label),
        moveTab: (move) => store.moveTab(move),
        moveToContainer: ({ tabId, containerId }) => store.moveToContainer(tabId, containerId),

        goBack: ({ tabId }) => withView(tabId, (wc) => wc.navigationHistory.goBack()),
        goForward: ({ tabId }) => withView(tabId, (wc) => wc.navigationHistory.goForward()),
        reload: ({ tabId }) => withView(tabId, (wc) => wc.reload()),
    }
}
