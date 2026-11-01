import { Effect, Layer } from "effect"

import { Extensions } from "../../src/main/extension/extensions"

/** `Extensions` with no extension installed: for tests of modules that only pass it along. */
export const noExtensions = Layer.succeed(Extensions, {
    install: () => Effect.void,
    ready: () => Effect.void,
    sessionFor: () => Effect.die(new Error("No extension sessions in tests")),
    attachTab: () => Effect.void,
    actionInfo: (extensionId) =>
        Effect.succeed({ extensionId, title: extensionId, iconDataUrl: null, popupUrl: null }),
    openMenu: () => Effect.void,
    uninstall: () => Effect.void,
})
