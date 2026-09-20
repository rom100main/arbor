import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"

import type {
    BrowserSnapshot,
    ContainerIcon,
    ContainerId,
    OmniboxActivation,
    RenameTarget,
    TabId,
} from "../shared/protocol"

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
    createChildTab: (parentTabId: TabId, url?: string): Promise<TabId> =>
        ipcRenderer.invoke("arbor:tab:create-child", parentTabId, url),
    selectTab: (tabId: TabId): Promise<void> => ipcRenderer.invoke("arbor:tab:select", tabId),
    setCollapsed: (tabId: TabId, collapsed: boolean): Promise<void> =>
        ipcRenderer.invoke("arbor:tab:set-collapsed", tabId, collapsed),
    closeTab: (tabId: TabId): Promise<void> => ipcRenderer.invoke("arbor:tab:close", tabId),
    renameTab: (tabId: TabId, label: string | null): Promise<void> =>
        ipcRenderer.invoke("arbor:tab:rename", tabId, label),
    reopenTab: (): Promise<void> => ipcRenderer.invoke("arbor:tab:reopen"),
    moveTab: (options: { tabId: TabId; parentId: TabId | null; index: number }): Promise<void> =>
        ipcRenderer.invoke("arbor:tab:move", options),
    moveToContainer: (tabId: TabId, containerId: ContainerId): Promise<void> =>
        ipcRenderer.invoke("arbor:tab:move-to-container", tabId, containerId),

    navigate: (tabId: TabId, input: string): Promise<void> =>
        ipcRenderer.invoke("arbor:tab:navigate", tabId, input),
    goBack: (tabId: TabId): Promise<void> => ipcRenderer.invoke("arbor:tab:back", tabId),
    goForward: (tabId: TabId): Promise<void> => ipcRenderer.invoke("arbor:tab:forward", tabId),
    reload: (tabId: TabId): Promise<void> => ipcRenderer.invoke("arbor:tab:reload", tabId),
    omniboxUpdate: (payload: {
        query: string
        rect: { x: number; y: number; width: number; height: number } | null
    }): void => ipcRenderer.send("arbor:omnibox:update", payload),
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
    onRenameTarget: (callback: (target: RenameTarget) => void): (() => void) => {
        const listener = (_event: IpcRendererEvent, target: RenameTarget): void => callback(target)
        ipcRenderer.on("arbor:rename:target", listener)
        return () => {
            ipcRenderer.removeListener("arbor:rename:target", listener)
        }
    },
}
contextBridge.exposeInMainWorld("arbor", api)

export type ArborApi = typeof api
