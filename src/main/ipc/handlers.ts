import { Cause, Effect, Exit, Option } from "effect"
import { BrowserWindow, ipcMain } from "electron"

import type { ContainerIcon, ContainerId, TabId } from "../../shared/protocol"
import type { Settings } from "../../shared/settings"
import { omniboxTarget } from "../../shared/url"
import { pinnedActionInfo } from "../extension/action"
import type { SettingsStore } from "../settings"
import type { DomainState } from "../state/state"
import type { DomainError, StoreService } from "../state/store"
import { openExtensionActionPopup, setExtensionAnchor } from "../windows/overlays"
import { navigateTab, viewForTab } from "../windows/tab-views"

const toPromise = async <A>(effect: Effect.Effect<A, DomainError>): Promise<A> => {
    const exit = await Effect.runPromiseExit(effect)
    if (Exit.isSuccess(exit)) return exit.value
    const failure = Cause.failureOption(exit.cause)
    if (Option.isSome(failure)) throw new Error(failure.value.message)
    throw new Error(Cause.pretty(exit.cause))
}

type Handler = (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown

const handle = (channel: string, handler: Handler): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (event, ...args) => handler(event, ...args))
}

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
    handle("arbor:extensions:action-popup", (event, extensionId: string, popupUrl: string) => {
        // The sender is the window that owns the toolbar,
        // which is not necessarily the focused one:
        // once a popup is open, focus belongs to the popup.
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) throw new Error("No window to anchor the action popup to")
        openExtensionActionPopup(win, extensionId, popupUrl, (url) => {
            void toPromise(store.createTab(url))
        })
    })

    handle("arbor:container:create", (_event, name?: string, color?: string) =>
        toPromise(store.createContainer(name, color)),
    )
    handle("arbor:container:switch", (_event, containerId: ContainerId) =>
        toPromise(store.switchContainer(containerId)),
    )
    handle("arbor:container:rename", (_event, containerId: ContainerId, name: string) =>
        toPromise(store.renameContainer(containerId, name)),
    )
    handle("arbor:container:set-color", (_event, containerId: ContainerId, color: string) =>
        toPromise(store.setContainerColor(containerId, color)),
    )
    handle("arbor:container:set-icon", (_event, containerId: ContainerId, icon: ContainerIcon) =>
        toPromise(store.setContainerIcon(containerId, icon)),
    )
    handle("arbor:container:reorder", (_event, containerId: ContainerId, toIndex: number) =>
        toPromise(store.reorderContainer(containerId, toIndex)),
    )

    handle("arbor:tab:create", (_event, url?: string) => toPromise(store.createTab(url)))
    handle("arbor:tab:create-child", (_event, parentTabId: TabId, url?: string) =>
        toPromise(store.createChildTab(parentTabId, url)),
    )
    handle("arbor:tab:select", (_event, tabId: TabId) => toPromise(store.selectTab(tabId)))
    handle("arbor:tab:set-collapsed", (_event, tabId: TabId, collapsed: boolean) =>
        toPromise(store.setCollapsed(tabId, collapsed)),
    )
    handle("arbor:tab:close", (_event, tabId: TabId) => toPromise(store.closeTab(tabId)))
    handle("arbor:tab:rename", (_event, tabId: TabId, label: string | null) =>
        toPromise(store.renameTab(tabId, label)),
    )
    handle("arbor:tab:reopen", () => toPromise(store.reopenTab()))
    handle(
        "arbor:tab:move",
        (_event, options: { tabId: TabId; parentId: TabId | null; index: number }) =>
            toPromise(store.moveTab(options)),
    )
    handle("arbor:tab:move-to-container", (_event, tabId: TabId, containerId: ContainerId) =>
        toPromise(store.moveToContainer(tabId, containerId)),
    )

    handle("arbor:tab:navigate", async (_event, tabId: TabId, input: string) => {
        const url = omniboxTarget(input, settings.get().searchTemplate)
        if (!viewForTab(tabId)) throw new Error(`No view for tab: ${tabId}`)
        await navigateTab({ store, getState }, tabId, url)
    })
    handle("arbor:tab:back", (_event, tabId: TabId) =>
        viewForTab(tabId)?.webContents.navigationHistory.goBack(),
    )
    handle("arbor:tab:forward", (_event, tabId: TabId) =>
        viewForTab(tabId)?.webContents.navigationHistory.goForward(),
    )
    handle("arbor:tab:reload", (_event, tabId: TabId) => viewForTab(tabId)?.webContents.reload())

    // Where a pinned toolbar icon sits, so its action popup opens above it.
    handle(
        "arbor:extensions:anchor",
        (
            _event,
            payload: {
                extensionId: string
                rect: { x: number; y: number; width: number; height: number }
            },
        ) => setExtensionAnchor(payload.extensionId, payload.rect),
    )
}
