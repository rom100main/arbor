import type { MenuItemConstructorOptions } from "electron"

import type { DomainState } from "../state/state"
import type { MenuAction, MenuModel } from "./host"

export const menuModel = (state: DomainState): MenuModel => ({
    containerNames: state.containers.map((container) => container.name),
    // The last tab of the last container cannot close.
    canCloseTab: !(state.containers.length === 1 && state.tabs.size === 1),
    canReopenTab: state.closeHistory.length > 0,
})

export const sameMenuModel = (a: MenuModel, b: MenuModel): boolean =>
    a.canCloseTab === b.canCloseTab &&
    a.canReopenTab === b.canReopenTab &&
    a.containerNames.length === b.containerNames.length &&
    a.containerNames.every((name, index) => name === b.containerNames[index])

/** The application menu for `model`. */
export const menuTemplate = (
    model: MenuModel,
    run: (action: MenuAction) => void,
): MenuItemConstructorOptions[] => {
    const item = (
        label: string,
        accelerator: string,
        action: MenuAction,
        enabled = true,
    ): MenuItemConstructorOptions => ({ label, accelerator, enabled, click: () => run(action) })

    const containerItems = Array.from({ length: 9 }, (_, index) =>
        item(
            model.containerNames[index] ?? `Container ${index + 1}`,
            `CmdOrCtrl+${index + 1}`,
            { kind: "switchContainer", index },
            index < model.containerNames.length,
        ),
    )

    return [
        ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
        {
            label: "File",
            submenu: [
                item("New Tab", "CmdOrCtrl+T", { kind: "newTab" }),
                item("New Container", "CmdOrCtrl+Shift+A", { kind: "newContainer" }),
                item("Focus Address Bar", "CmdOrCtrl+L", { kind: "focusAddressBar" }),
                item("Focus Tab Tree", "CmdOrCtrl+0", { kind: "focusTabTree" }),
                { type: "separator" },
                item("Close Tab", "CmdOrCtrl+W", { kind: "closeTab" }, model.canCloseTab),
                item(
                    "Reopen Closed Tab",
                    "CmdOrCtrl+Shift+T",
                    { kind: "reopenTab" },
                    model.canReopenTab,
                ),
                { type: "separator" },
                item("Next Tab", "Ctrl+Tab", { kind: "stepTab", delta: 1 }),
                item("Previous Tab", "Ctrl+Shift+Tab", { kind: "stepTab", delta: -1 }),
                { type: "separator" },
                { label: "Containers", submenu: containerItems },
            ],
        },
        { role: "editMenu" },
        {
            label: "View",
            submenu: [
                item("Reload Page", "CmdOrCtrl+R", { kind: "history", step: "reload" }),
                { type: "separator" },
                { role: "toggleDevTools" },
            ],
        },
        {
            label: "History",
            submenu: [
                item("Back", "CmdOrCtrl+[", { kind: "history", step: "back" }),
                item("Forward", "CmdOrCtrl+]", { kind: "history", step: "forward" }),
            ],
        },
        { role: "windowMenu" },
    ]
}
