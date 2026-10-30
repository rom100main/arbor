import { Menu, type MenuItemConstructorOptions } from "electron"

import type { TabId } from "../../shared/protocol"
import { stepVisibleTab } from "../../shared/tree-display"
import { runBackground } from "../exec"
import { snapshot, type DomainState } from "../state/state"
import type { StoreService } from "../state/store"
import { viewForTab } from "./tab-views"

export interface MenuDeps {
    store: StoreService
    getState: () => DomainState
    focusOmnibox: () => void
}

export const installMenu = (deps: MenuDeps): (() => void) => {
    const rebuild = (): void => {
        Menu.setApplicationMenu(Menu.buildFromTemplate(buildTemplate(deps)))
    }
    rebuild()
    return rebuild
}

const buildTemplate = (deps: MenuDeps): MenuItemConstructorOptions[] => {
    const { store, getState, focusOmnibox } = deps

    const activeTabId = (): TabId | null => snapshot(getState()).activeTabId

    const withActiveView = (action: (webContents: Electron.WebContents) => void): void => {
        const tabId = activeTabId()
        if (tabId === null) return
        const view = viewForTab(tabId)
        if (view) action(view.webContents)
    }

    const stepTab = (delta: 1 | -1): void => {
        const state = getState()
        const snap = snapshot(state)
        if (snap.activeContainerId === null) return
        const nextId = stepVisibleTab(state.tabs, snap.activeContainerId, snap.activeTabId, delta)
        if (nextId !== null) void runBackground(store.selectTab(nextId))
    }

    const containers = getState().containers
    const protectedTab = containers.length === 1 && getState().tabs.size === 1

    const containerItems: MenuItemConstructorOptions[] = Array.from(
        { length: 9 },
        (_, index): MenuItemConstructorOptions => ({
            label: containers[index]?.name ?? `Container ${index + 1}`,
            accelerator: `CmdOrCtrl+${index + 1}`,
            enabled: index < containers.length,
            click: () => {
                const container = getState().containers[index]
                if (container) void runBackground(store.switchContainer(container.id))
            },
        }),
    )

    const template: MenuItemConstructorOptions[] = [
        ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
        {
            label: "File",
            submenu: [
                {
                    label: "New Tab",
                    accelerator: "CmdOrCtrl+T",
                    click: () => {
                        void runBackground(store.createTab())
                        focusOmnibox()
                    },
                },
                {
                    label: "New Container",
                    accelerator: "CmdOrCtrl+Shift+A",
                    click: () => void runBackground(store.createContainer()),
                },
                {
                    label: "Focus Address Bar",
                    accelerator: "CmdOrCtrl+L",
                    click: () => focusOmnibox(),
                },
                { type: "separator" },
                {
                    label: "Close Tab",
                    accelerator: "CmdOrCtrl+W",
                    enabled: !protectedTab,
                    click: () => {
                        const tabId = activeTabId()
                        if (tabId !== null) void runBackground(store.closeTab(tabId))
                    },
                },
                {
                    label: "Reopen Closed Tab",
                    accelerator: "CmdOrCtrl+Shift+T",
                    enabled: getState().closeHistory.length > 0,
                    click: () => void runBackground(store.reopenTab()),
                },
                { type: "separator" },
                { label: "Next Tab", accelerator: "Ctrl+Tab", click: () => stepTab(1) },
                {
                    label: "Previous Tab",
                    accelerator: "Ctrl+Shift+Tab",
                    click: () => stepTab(-1),
                },
                { type: "separator" },
                { label: "Containers", submenu: containerItems },
            ],
        },
        { role: "editMenu" },
        {
            label: "View",
            submenu: [
                {
                    label: "Reload Page",
                    accelerator: "CmdOrCtrl+R",
                    click: () => withActiveView((webContents) => webContents.reload()),
                },
                { type: "separator" },
                { role: "toggleDevTools" },
            ],
        },
        {
            label: "History",
            submenu: [
                {
                    label: "Back",
                    accelerator: "CmdOrCtrl+[",
                    click: () =>
                        withActiveView((webContents) => webContents.navigationHistory.goBack()),
                },
                {
                    label: "Forward",
                    accelerator: "CmdOrCtrl+]",
                    click: () =>
                        withActiveView((webContents) => webContents.navigationHistory.goForward()),
                },
            ],
        },
        { role: "windowMenu" },
    ]
    return template
}
