import { Cause, Effect, Exit, Option } from "effect"

import type { DomainError } from "./state/state"

/**
 * Request/response: run an Effect and convert its Exit into a rejected-Error promise.
 * Used at IPC invoke handlers where the renderer expects a rejected Error on failure.
 */
export const runRequest = async <A>(effect: Effect.Effect<A, DomainError>): Promise<A> => {
    const exit = await Effect.runPromiseExit(effect)
    if (Exit.isSuccess(exit)) return exit.value
    const failure = Cause.findErrorOption(exit.cause)
    if (Option.isSome(failure)) throw new Error(failure.value.message)
    throw new Error(Cause.pretty(exit.cause))
}

/**
 * Background: observe the full cause without surfacing a rejection.
 * Used at Electron callbacks that fire-and-forget, and at best-effort workflow steps.
 *
 * Expected domain failures are silent (best-effort by design).
 * Unexpected defects are reported so they do not vanish.
 * Interruption during shutdown is not an operational error.
 */
export const runBackground = async (effect: Effect.Effect<unknown, unknown>): Promise<void> => {
    const exit = await Effect.runPromiseExit(effect)
    if (!Exit.isFailure(exit)) return
    if (Cause.hasInterruptsOnly(exit.cause)) return
    const failure = Cause.findErrorOption(exit.cause)
    if (Option.isSome(failure)) return
    console.error("Background operation defect:", Cause.pretty(exit.cause))
}
