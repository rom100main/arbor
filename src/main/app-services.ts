import path from "node:path"

import { Layer } from "effect"
import { app, shell } from "electron"

import { Downloads } from "./downloads/downloads"
import { Extensions } from "./extension/extensions"
import { PermissionPrompts } from "./extension/prompts"
import { ExtensionStorage } from "./extension/storage"
import { History } from "./history/service"
import { IpcPush } from "./ipc/router"
import { browserStoreFromFile } from "./persistence/state-file"
import { SettingsStore } from "./settings"
import { ElectronUpdater } from "./update/electron-updater"
import { CurrentWindow } from "./windows/current-window"
import { WindowManager } from "./windows/window-manager"

const PersistedServices = (userData: string) =>
    Layer.mergeAll(
        browserStoreFromFile(path.join(userData, "state.json")),
        SettingsStore.layer(path.join(userData, "settings.json")),
        ExtensionStorage.layer(path.join(userData, "extension-storage.json")),
    )

export const AppServices = (userData: string) => {
    const base = Layer.mergeAll(PersistedServices(userData), IpcPush.layer, CurrentWindow.layer)
    const updater = ElectronUpdater.pipe(Layer.provideMerge(base))
    const downloads = Downloads.layer({
        folder: app.getPath("downloads"),
        historyPath: path.join(userData, "downloads.json"),
        opener: {
            reveal: (file) => shell.showItemInFolder(file),
            open: (target) => void shell.openPath(target),
        },
    }).pipe(Layer.provideMerge(base))
    const extensions = Extensions.layer.pipe(
        Layer.provideMerge(PermissionPrompts.modal),
        Layer.provideMerge(updater),
    )
    const history = History.layer({ historyPath: path.join(userData, "history.json") }).pipe(
        Layer.provideMerge(base),
    )
    return WindowManager.layer.pipe(
        Layer.provideMerge(extensions),
        Layer.provideMerge(downloads),
        Layer.provideMerge(history),
    )
}
