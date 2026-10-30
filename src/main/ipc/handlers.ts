import { Effect, Schema } from "effect"
import { BrowserWindow, ipcMain } from "electron"

import { decodeOr } from "../../shared/decode"
import type { ContainerIcon, ContainerId, TabId } from "../../shared/protocol"
import type { Settings } from "../../shared/settings"
import { runBackground, runRequest } from "../exec"
import { pinnedActionInfo } from "../extension/action"
import { sessionForExtension } from "../extension/loader"
import type { SettingsStore } from "../settings"
import type { DomainState } from "../state/state"
import type { StoreService } from "../state/store"
import { openExtensionActionPopup, setExtensionAnchor } from "../windows/overlays"
import { existingSessionForContainer, viewForTab } from "../windows/tab-views"

const parseAnchor = decodeOr(
    Schema.Struct({
        x: Schema.Finite,
        y: Schema.Finite,
        width: Schema.Finite,
        height: Schema.Finite,
    }),
)

type Handler = (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown

const handle = (channel: string, handler: Handler): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (event, ...args) => handler(event, ...args))
}

const actionPopupSession = (state: DomainState, extensionId: string): Electron.Session =>
    sessionForExtension(
        extensionId,
        state.activeContainerId ? existingSessionForContainer(state.activeContainerId) : undefined,
    )

export const registerIpc = (
    store: StoreService,
    settings: SettingsStore,
    getState: () => DomainState,
): void => {
    handle("arbor:get-snapshot", () => Effect.runPromise(store.snapshot))
    handle("arbor:settings:get", () => settings.get())
    handle("arbor:settings:set", (_event, patch: Partial<Settings>) => settings.set(patch))

    // The toolbar reads action metadata straight from the extension's manifest:
    // electron-chrome-extensions cannot serve it,
    // because it keeps extensions and tabs in one session and Arbor does not.
    handle("arbor:extensions:action-info", (_event, extensionId: string) =>
        pinnedActionInfo(extensionId),
    )
    handle("arbor:extensions:action-popup", (event, extensionId: unknown, anchor: unknown) => {
        if (typeof extensionId !== "string") throw new Error("Invalid extension id")
        const popupUrl = pinnedActionInfo(extensionId).popupUrl
        if (!popupUrl) throw new Error(`Extension ${extensionId} has no action popup`)
        const rect = parseAnchor(anchor)
        if (rect) setExtensionAnchor(extensionId, rect)
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) throw new Error("No window to anchor the action popup to")
        openExtensionActionPopup(
            win,
            extensionId,
            popupUrl,
            actionPopupSession(getState(), extensionId),
            (url) => {
                void runBackground(store.createTab(url))
            },
        )
    })

    handle("arbor:container:create", (_event, name?: string, color?: string) =>
        runRequest(store.createContainer(name, color)),
    )
    handle("arbor:container:switch", (_event, containerId: ContainerId) =>
        runRequest(store.switchContainer(containerId)),
    )
    handle("arbor:container:rename", (_event, containerId: ContainerId, name: string) =>
        runRequest(store.renameContainer(containerId, name)),
    )
    handle("arbor:container:set-color", (_event, containerId: ContainerId, color: string) =>
        runRequest(store.setContainerColor(containerId, color)),
    )
    handle("arbor:container:set-icon", (_event, containerId: ContainerId, icon: ContainerIcon) =>
        runRequest(store.setContainerIcon(containerId, icon)),
    )
    handle("arbor:container:reorder", (_event, containerId: ContainerId, toIndex: number) =>
        runRequest(store.reorderContainer(containerId, toIndex)),
    )

    handle("arbor:tab:create", (_event, url?: string) => runRequest(store.createTab(url)))
    handle("arbor:tab:select", (_event, tabId: TabId) => runRequest(store.selectTab(tabId)))
    handle("arbor:tab:set-collapsed", (_event, tabId: TabId, collapsed: boolean) =>
        runRequest(store.setCollapsed(tabId, collapsed)),
    )
    handle("arbor:tab:close", (_event, tabId: TabId) => runRequest(store.closeTab(tabId)))
    handle("arbor:tab:rename", (_event, tabId: TabId, label: string | null) =>
        runRequest(store.renameTab(tabId, label)),
    )
    handle(
        "arbor:tab:move",
        (_event, options: { tabId: TabId; parentId: TabId | null; index: number }) =>
            runRequest(store.moveTab(options)),
    )
    handle("arbor:tab:move-to-container", (_event, tabId: TabId, containerId: ContainerId) =>
        runRequest(store.moveToContainer(tabId, containerId)),
    )

    handle("arbor:tab:back", (_event, tabId: TabId) =>
        viewForTab(tabId)?.webContents.navigationHistory.goBack(),
    )
    handle("arbor:tab:forward", (_event, tabId: TabId) =>
        viewForTab(tabId)?.webContents.navigationHistory.goForward(),
    )
    handle("arbor:tab:reload", (_event, tabId: TabId) => viewForTab(tabId)?.webContents.reload())
}
