import { Effect, Layer, type Duration } from "effect"

import { fromPersisted, toPersisted } from "../state/persist"
import { initialState } from "../state/state"
import { BrowserStore } from "../state/store"
import { JsonFile } from "./json-file"
import { loadOrEmpty, persistChanges } from "./persisted-ref"

/**
 * The store, loaded from `state.json` at boot and saved back on every change.
 * The store already keeps the state in memory, so this only connects its changes to the saver.
 */
export const browserStoreFromFile = (
    path: string,
    debounce?: Duration.Input,
): Layer.Layer<BrowserStore, never, JsonFile> =>
    Layer.effect(
        BrowserStore,
        Effect.gen(function* () {
            const file = yield* JsonFile
            const initial = yield* loadOrEmpty(file.read(path, fromPersisted), initialState)
            const store = yield* BrowserStore.make(initial)
            yield* persistChanges(
                { current: store.state, changes: store.changes },
                { path, encode: toPersisted, debounce },
            )
            return store
        }),
    )
