import { Effect, Layer } from "effect"

import { Adblock } from "../../src/main/adblock"

/** `Adblock` with no blocking: for tests of modules that only pass it along. */
export const noAdblock = Layer.succeed(Adblock, {
    attach: () => Effect.void,
    ready: Effect.void,
})
