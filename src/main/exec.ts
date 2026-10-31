import { Cause, Effect, Exit, Option } from "effect"

import { AppRuntime } from "./runtime"

/**
 * Request/response: run an Effect and convert its Exit into a rejected-Error promise.
 * Used at IPC invoke handlers where the renderer expects a rejected Error on failure:
 * the error's `message` is what the renderer sees.
 */
export const runRequest = async <A, E extends { readonly message: string }>(
    effect: Effect.Effect<A, E>,
): Promise<A> => {
    const exit = await AppRuntime.runPromiseExit(effect)
    if (Exit.isSuccess(exit)) return exit.value
    const failure = Cause.findErrorOption(exit.cause)
    if (Option.isSome(failure)) throw new Error(failure.value.message)
    throw new Error(Cause.pretty(exit.cause))
}

/**
 * Background: fire-and-forget, never rejects.
 * Used at Electron callbacks that fire-and-forget, and at best-effort workflow steps.
 *
 * Expected failures are logged at debug level (best-effort by design, visible in dev).
 * Defects are logged at error level so they do not vanish.
 * Interruption during shutdown is not an operational error.
 */
export const runBackground = (effect: Effect.Effect<unknown, unknown>): Promise<void> =>
    AppRuntime.runPromise(
        effect.pipe(
            Effect.tapCause((cause) => {
                if (Cause.hasInterruptsOnly(cause)) return Effect.void
                return Cause.hasFails(cause)
                    ? Effect.logDebug("Background operation failed", cause)
                    : Effect.logError("Background operation defect", cause)
            }),
            Effect.ignoreCause,
        ),
    )
