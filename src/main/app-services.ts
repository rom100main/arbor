import path from "node:path"

import { Layer } from "effect"

import { ExtensionStorage } from "./extension/storage"
import { JsonFile } from "./persistence/json-file"
import { browserStoreFromFile } from "./persistence/state-file"
import { SettingsStore } from "./settings"

export const AppServicesLive = (userData: string) =>
    Layer.mergeAll(
        browserStoreFromFile(path.join(userData, "state.json")),
        SettingsStore.layer(path.join(userData, "settings.json")),
        ExtensionStorage.layer(path.join(userData, "extension-storage.json")),
    ).pipe(Layer.provide(JsonFile.layer))
