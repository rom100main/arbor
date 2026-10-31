import { Cause, Effect } from "effect"

import { AppRuntime } from "./runtime"

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
