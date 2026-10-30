import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"
import { injectBrowserAction } from "electron-chrome-extensions/browser-action"

import type {
    Anchor,
    BrowserSnapshot,
    ContainerIcon,
    ContainerId,
    ExtensionMenuRequest,
    OmniboxActivation,
    PermissionPromptRequest,
    PinnedActionInfo,
    Rect,
    RenameTarget,
    RevealEdge,
    TabId,
} from "../shared/protocol"
import type { Settings } from "../shared/settings"

// <browser-action-list> element + window.browserAction API (main world injection).
injectBrowserAction()

const api = {
    getSnapshot: (): Promise<BrowserSnapshot> => ipcRenderer.invoke("arbor:get-snapshot"),
    onState: (callback: (snapshot: BrowserSnapshot) => void): (() => void) => {
        const listener = (_event: IpcRendererEvent, snapshot: BrowserSnapshot): void =>
            callback(snapshot)
        ipcRenderer.on("arbor:state", listener)
        return () => {
            ipcRenderer.removeListener("arbor:state", listener)
        }
    },

    createContainer: (name?: string, color?: string): Promise<ContainerId> =>
        ipcRenderer.invoke("arbor:container:create", name, color),
    switchContainer: (containerId: ContainerId): Promise<void> =>
        ipcRenderer.invoke("arbor:container:switch", containerId),
    renameContainer: (containerId: ContainerId, name: string): Promise<void> =>
        ipcRenderer.invoke("arbor:container:rename", containerId, name),
    setContainerColor: (containerId: ContainerId, color: string): Promise<void> =>
        ipcRenderer.invoke("arbor:container:set-color", containerId, color),
    setContainerIcon: (containerId: ContainerId, icon: ContainerIcon): Promise<void> =>
        ipcRenderer.invoke("arbor:container:set-icon", containerId, icon),
    reorderContainer: (containerId: ContainerId, toIndex: number): Promise<void> =>
        ipcRenderer.invoke("arbor:container:reorder", containerId, toIndex),

    createTab: (url?: string): Promise<TabId> => ipcRenderer.invoke("arbor:tab:create", url),
    selectTab: (tabId: TabId): Promise<void> => ipcRenderer.invoke("arbor:tab:select", tabId),
    setCollapsed: (tabId: TabId, collapsed: boolean): Promise<void> =>
        ipcRenderer.invoke("arbor:tab:set-collapsed", tabId, collapsed),
    closeTab: (tabId: TabId): Promise<void> => ipcRenderer.invoke("arbor:tab:close", tabId),
    renameTab: (tabId: TabId, label: string | null): Promise<void> =>
        ipcRenderer.invoke("arbor:tab:rename", tabId, label),
    moveTab: (options: { tabId: TabId; parentId: TabId | null; index: number }): Promise<void> =>
        ipcRenderer.invoke("arbor:tab:move", options),
    moveToContainer: (tabId: TabId, containerId: ContainerId): Promise<void> =>
        ipcRenderer.invoke("arbor:tab:move-to-container", tabId, containerId),

    goBack: (tabId: TabId): Promise<void> => ipcRenderer.invoke("arbor:tab:back", tabId),
    goForward: (tabId: TabId): Promise<void> => ipcRenderer.invoke("arbor:tab:forward", tabId),
    reload: (tabId: TabId): Promise<void> => ipcRenderer.invoke("arbor:tab:reload", tabId),
    omniboxUpdate: (payload: { query: string; rect: Rect | null }): void =>
        ipcRenderer.send("arbor:omnibox:update", payload),
    omniboxSetPopupHeight: (height: number): void =>
        ipcRenderer.send("arbor:omnibox:popup-height", height),
    omniboxActivate: (payload: OmniboxActivation): void =>
        ipcRenderer.send("arbor:omnibox:activate", payload),
    omniboxMoveSelection: (delta: number): void =>
        ipcRenderer.send("arbor:omnibox:move-selection", delta),
    omniboxActivateSelected: (): void => ipcRenderer.send("arbor:omnibox:activate-selected"),
    onOmniboxQuery: (callback: (query: string) => void): (() => void) => {
        const listener = (_event: IpcRendererEvent, query: string): void => callback(query)
        ipcRenderer.on("arbor:omnibox:query", listener)
        return () => {
            ipcRenderer.removeListener("arbor:omnibox:query", listener)
        }
    },
    onOmniboxMoveSelection: (callback: (delta: number) => void): (() => void) => {
        const listener = (_event: IpcRendererEvent, delta: number): void => callback(delta)
        ipcRenderer.on("arbor:omnibox:move-selection", listener)
        return () => {
            ipcRenderer.removeListener("arbor:omnibox:move-selection", listener)
        }
    },
    onOmniboxActivateSelected: (callback: () => void): (() => void) => {
        const listener = (): void => callback()
        ipcRenderer.on("arbor:omnibox:activate-selected", listener)
        return () => {
            ipcRenderer.removeListener("arbor:omnibox:activate-selected", listener)
        }
    },
    onOmniboxActivated: (callback: () => void): (() => void) => {
        const listener = (): void => callback()
        ipcRenderer.on("arbor:omnibox:activated", listener)
        return () => {
            ipcRenderer.removeListener("arbor:omnibox:activated", listener)
        }
    },
    onFocusOmnibox: (callback: () => void): (() => void) => {
        const listener = (): void => callback()
        ipcRenderer.on("arbor:focus-omnibox", listener)
        return () => {
            ipcRenderer.removeListener("arbor:focus-omnibox", listener)
        }
    },
    openRenameModal: (target: RenameTarget): void =>
        ipcRenderer.send("arbor:rename-modal:open", target),
    closeRenameModal: (): void => ipcRenderer.send("arbor:rename-modal:close"),
    extensionsToggle: (rect: Anchor): void => ipcRenderer.send("arbor:extensions:toggle", rect),
    extensionsClose: (): void => ipcRenderer.send("arbor:extensions:close"),
    extensionsSetPopupHeight: (height: number): void =>
        ipcRenderer.send("arbor:extensions:popup-height", height),
    extensionsMenu: (payload: ExtensionMenuRequest): void =>
        ipcRenderer.send("arbor:extensions:menu", payload),
    onPermissionRequest: (
        callback: (request: PermissionPromptRequest | null) => void,
    ): (() => void) => {
        const listener = (
            _event: IpcRendererEvent,
            request: PermissionPromptRequest | null,
        ): void => callback(request)
        ipcRenderer.on("arbor:permission:request", listener)
        return () => {
            ipcRenderer.removeListener("arbor:permission:request", listener)
        }
    },
    permissionRespond: (allowed: boolean): void =>
        ipcRenderer.send("arbor:permission:respond", allowed),
    onRenameTarget: (callback: (target: RenameTarget) => void): (() => void) => {
        const listener = (_event: IpcRendererEvent, target: RenameTarget): void => callback(target)
        ipcRenderer.on("arbor:rename:target", listener)
        return () => {
            ipcRenderer.removeListener("arbor:rename:target", listener)
        }
    },
    /** Title, icon and popup for a pinned extension, read from its manifest. */
    extensionActionInfo: (extensionId: string): Promise<PinnedActionInfo> =>
        ipcRenderer.invoke("arbor:extensions:action-info", extensionId),
    openExtensionActionPopup: (extensionId: string, anchor: Rect | null): Promise<void> =>
        ipcRenderer.invoke("arbor:extensions:action-popup", extensionId, anchor),

    shellRaise: (raised: boolean): void => ipcRenderer.send("arbor:shell:raise", raised),
    onShellEdge: (callback: (edge: RevealEdge) => void): (() => void) => {
        const listener = (_event: IpcRendererEvent, edge: RevealEdge): void => callback(edge)
        ipcRenderer.on("arbor:shell:edge", listener)
        return () => {
            ipcRenderer.removeListener("arbor:shell:edge", listener)
        }
    },

    getSettings: (): Promise<Settings> => ipcRenderer.invoke("arbor:settings:get"),
    setSettings: (patch: Partial<Settings>): Promise<Settings> =>
        ipcRenderer.invoke("arbor:settings:set", patch),
    onSettings: (callback: (settings: Settings) => void): (() => void) => {
        const listener = (_event: IpcRendererEvent, settings: Settings): void => callback(settings)
        ipcRenderer.on("arbor:settings:changed", listener)
        return () => {
            ipcRenderer.removeListener("arbor:settings:changed", listener)
        }
    },
}
contextBridge.exposeInMainWorld("arbor", api)

export type ArborApi = typeof api
