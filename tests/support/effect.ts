import { Effect, Logger, type Layer, type LogLevel } from "effect"
import { TestClock } from "effect/testing"

/** Run an Effect under a TestClock: time moves only through `TestClock.adjust`. */
export const runTest = <A, E>(effect: Effect.Effect<A, E, TestClock.TestClock>): Promise<A> =>
    Effect.runPromise(effect.pipe(Effect.provide(TestClock.layer())))

/** A logger that records each entry's level and message, in place of the console. */
export const captureLogs = (): {
    readonly entries: Array<{ readonly level: LogLevel.LogLevel; readonly message: unknown }>
    readonly layer: Layer.Layer<never>
} => {
    const entries: Array<{ level: LogLevel.LogLevel; message: unknown }> = []
    const layer = Logger.layer([
        Logger.make((options) => {
            entries.push({ level: options.logLevel, message: options.message })
        }),
    ])
    return { entries, layer }
}

/** Let forked consumer fibers catch up with what was just published. */
export const settle = Effect.repeat(Effect.yieldNow, { times: 10 })
