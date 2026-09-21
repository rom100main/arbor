import { Effect } from "effect"
import { Menu, type MenuItemConstructorOptions } from "electron"

import { stepVisibleTab } from "../../shared/tree-display"
import { snapshot, type DomainState } from "../state/state"
import type { StoreService } from "../state/store"
import { viewForTab } from "./tab-views"

export interface MenuDeps {
    store: StoreService
    getState: () => DomainState
    focusOmnibox: () => void
}

const run = (effect: Effect.Effect<unknown, unknown>): void => {
    // runPromiseExit never rejects; failures (e.g. protected-tab close) are discarded.
    void Effect.runPromiseExit(effect)
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

    const activeTabId = (): string | null => snapshot(getState()).activeTabId

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
        if (nextId !== null) run(store.selectTab(nextId))
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
                if (container) run(store.switchContainer(container.id))
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
                        run(store.createTab())
                        focusOmnibox()
                    },
                },
                {
                    label: "New Container",
                    accelerator: "CmdOrCtrl+Shift+A",
                    click: () => run(store.createContainer()),
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
                        if (tabId !== null) run(store.closeTab(tabId))
                    },
                },
                {
                    label: "Reopen Closed Tab",
                    accelerator: "CmdOrCtrl+Shift+T",
                    enabled: getState().closeHistory.length > 0,
                    click: () => run(store.reopenTab()),
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
                    click: () => withActiveView((webContents) => webContents.goBack()),
                },
                {
                    label: "Forward",
                    accelerator: "CmdOrCtrl+]",
                    click: () => withActiveView((webContents) => webContents.goForward()),
                },
            ],
        },
        { role: "windowMenu" },
    ]
    return template
}
