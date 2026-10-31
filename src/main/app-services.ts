import path from "node:path"

import { Layer } from "effect"

import { ExtensionStorage } from "./extension/storage"
import { IpcPush } from "./ipc/router"
import { IpcTransport } from "./ipc/transport"
import { JsonFile } from "./persistence/json-file"
import { browserStoreFromFile } from "./persistence/state-file"
import { SettingsStore } from "./settings"

const PersistedServices = (userData: string) =>
    Layer.mergeAll(
        browserStoreFromFile(path.join(userData, "state.json")),
        SettingsStore.layer(path.join(userData, "settings.json")),
        ExtensionStorage.layer(path.join(userData, "extension-storage.json")),
    ).pipe(Layer.provide(JsonFile.layer))

/** The transport stays in the output: serving requests and events needs it too. */
const IpcServices = IpcPush.layer.pipe(Layer.provideMerge(IpcTransport.electron))

export const AppServices = (userData: string) =>
    Layer.mergeAll(PersistedServices(userData), IpcServices)
