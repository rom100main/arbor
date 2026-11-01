/**
 * Keeps a value in memory and saves it to its file:
 * 500 ms after the last change, and on quit.
 */

import {
    Deferred,
    Duration,
    Effect,
    Ref,
    Stream,
    SubscriptionRef,
    type Option,
    type Scope,
} from "effect"

import { writeJson, type FileMissing, type FileUnreadable } from "./json-file"

/** A value that loads itself, can be read, modified and observed, and writes itself back. */
export interface PersistedRef<A> {
    readonly get: Effect.Effect<A>
    /** The current value on subscribe, then every effective change. */
    readonly changes: Stream.Stream<A>
    /** Like `SubscriptionRef.modifySome`, an effective change schedules a write. */
    readonly modifySome: <B>(f: (a: A) => readonly [B, Option.Option<A>]) => Effect.Effect<B>
}

export const DEFAULT_DEBOUNCE = Duration.millis(500)

/** Read the file at boot. Missing file: use defaults. Broken file: log it, then use defaults. */
export const loadOrEmpty = <A>(
    read: Effect.Effect<A, FileMissing | FileUnreadable>,
    empty: () => A,
): Effect.Effect<A> =>
    read.pipe(
        Effect.catchTags({
            FileMissing: () => Effect.succeed(empty()),
            FileUnreadable: (error) =>
                Effect.as(
                    Effect.logWarning(
                        `Unreadable ${error.path}, starting from defaults`,
                        error.reason,
                    ),
                    empty(),
                ),
        }),
    )

/**
 * Saves the value whenever it changes: once, 500 ms after the last change, and again on quit.
 * Skips the write if nothing changed.
 */
export const persistChanges = <A>(
    source: { readonly current: Effect.Effect<A>; readonly changes: Stream.Stream<A> },
    options: {
        readonly path: string
        readonly encode: (a: A) => unknown
        readonly debounce?: Duration.Input
    },
): Effect.Effect<void, never, Scope.Scope> =>
    Effect.gen(function* () {
        // What is on disk now: the value just loaded.
        const written = yield* Ref.make(yield* source.current)

        const flush = Effect.gen(function* () {
            const value = yield* source.current
            if (value === (yield* Ref.get(written))) return
            yield* Ref.set(written, value)
            yield* writeJson(options.path, options.encode(value)).pipe(
                Effect.catchTag("FileUnwritable", (error) =>
                    Effect.logError(`Save failed ${error.path}`, error.reason),
                ),
            )
        })

        // Return only once subscribed: a change made right after setup must reach the debounce.
        const subscribed = yield* Deferred.make<void>()
        yield* source.changes.pipe(
            Stream.tap(() => Deferred.succeed(subscribed, undefined)),
            Stream.drop(1),
            Stream.debounce(options.debounce ?? DEFAULT_DEBOUNCE),
            Stream.runForEach(() => flush),
            Effect.forkScoped,
        )
        yield* Deferred.await(subscribed)
        yield* Effect.addFinalizer(() => flush)
    })

export const make = <A>(options: {
    readonly path: string
    readonly read: Effect.Effect<A, FileMissing | FileUnreadable>
    readonly encode: (a: A) => unknown
    readonly empty: () => A
    readonly debounce?: Duration.Input
}): Effect.Effect<PersistedRef<A>, never, Scope.Scope> =>
    Effect.gen(function* () {
        const ref = yield* SubscriptionRef.make(yield* loadOrEmpty(options.read, options.empty))
        const current = SubscriptionRef.get(ref)
        const changes = SubscriptionRef.changes(ref)
        yield* persistChanges({ current, changes }, options)
        return {
            get: current,
            changes,
            modifySome: (f) => SubscriptionRef.modifySome(ref, f),
        }
    })
