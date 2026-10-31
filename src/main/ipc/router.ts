/**
 * Serves the contract in `shared/ipc/contract.ts`: checks what renderers send, runs the handler, encodes what goes back.
 * Handlers only see checked, typed values.
 */
import { Context, Effect, FiberSet, Layer, Schema, Struct, type Scope } from "effect"
import type { WebContents } from "electron"

import { EVENTS, PUSHES, REQUESTS } from "../../shared/ipc/channels"
import {
    Events,
    Pushes,
    Requests,
    type EventKey,
    type PushKey,
    type RequestKey,
} from "../../shared/ipc/contract"
import { IpcTransport } from "./transport"

type RequestOf<K extends RequestKey> = (typeof Requests)[K]

/** One handler per request: leaving one out, or failing with an undeclared error, does not compile. */
export type RequestHandlers<R> = {
    readonly [K in RequestKey]: (
        payload: RequestOf<K>["payload"]["Type"],
        sender: WebContents,
    ) => Effect.Effect<RequestOf<K>["success"]["Type"], RequestOf<K>["error"]["Type"], R>
}

export type EventHandlers<R> = {
    readonly [K in EventKey]: (
        payload: (typeof Events)[K]["payload"]["Type"],
        sender: WebContents,
    ) => Effect.Effect<void, never, R>
}

/**
 * Answers every request channel while the current scope is open.
 * An expected failure answers `ok: false`. A bad payload or a defect rejects the call and is logged.
 */
export const serveRequests = <R>(
    handlers: RequestHandlers<R>,
): Effect.Effect<void, never, IpcTransport | Scope.Scope | R> =>
    Effect.gen(function* () {
        const transport = yield* IpcTransport
        const run = yield* FiberSet.makeRuntimePromise<R>()
        // Generic in `K`, so TS pairs each handler with its own payload, success and error.
        const serve = <K extends RequestKey>(key: K, handler: RequestHandlers<R>[K]) => {
            const channel = REQUESTS[key]
            const def = Requests[key]
            const decode = Schema.decodeUnknownEffect(def.payload)
            const encodeOk = Schema.encodeUnknownEffect(def.success)
            const encodeErr = Schema.encodeUnknownEffect(def.error)
            return transport.handle(channel, (raw, sender) =>
                run(
                    decode(raw).pipe(
                        Effect.orDie,
                        Effect.flatMap((payload) => handler(payload, sender)),
                        Effect.matchEffect({
                            onSuccess: (value) =>
                                Effect.map(encodeOk(value), (v) => ({ ok: true, value: v })),
                            onFailure: (error) =>
                                Effect.map(encodeErr(error), (e) => ({ ok: false, error: e })),
                        }),
                        Effect.orDie,
                        Effect.tapDefect((defect) => Effect.logError(`IPC ${channel}`, defect)),
                    ),
                ),
            )
        }
        yield* Effect.forEach(Struct.keys(REQUESTS), (key) => serve(key, handlers[key]), {
            discard: true,
        })
    })

/** Receives every event channel while the current scope is open. A bad payload or a defect is logged. */
export const serveEvents = <R>(
    handlers: EventHandlers<R>,
): Effect.Effect<void, never, IpcTransport | Scope.Scope | R> =>
    Effect.gen(function* () {
        const transport = yield* IpcTransport
        const run = yield* FiberSet.makeRuntime<R>()
        const serve = <K extends EventKey>(key: K, handler: EventHandlers<R>[K]) => {
            const channel = EVENTS[key]
            const decode = Schema.decodeUnknownEffect(Events[key].payload)
            return transport.on(channel, (raw, sender) => {
                run(
                    decode(raw).pipe(
                        Effect.orDie,
                        Effect.flatMap((payload) => handler(payload, sender)),
                        Effect.tapDefect((defect) => Effect.logError(`IPC ${channel}`, defect)),
                    ),
                )
            })
        }
        yield* Effect.forEach(Struct.keys(EVENTS), (key) => serve(key, handlers[key]), {
            discard: true,
        })
    })

/** A void push takes no value. */
type PushArgs<K extends PushKey> = [(typeof Pushes)[K]["value"]["Type"]] extends [void]
    ? []
    : [value: (typeof Pushes)[K]["value"]["Type"]]

export interface IpcPushService {
    /** Encode once, then send to every attached renderer. */
    readonly push: <K extends PushKey>(key: K, ...value: PushArgs<K>) => Effect.Effect<void>
    /** Receive pushes until the renderer is destroyed. */
    readonly attach: (renderer: WebContents) => Effect.Effect<void>
}

export class IpcPush extends Context.Service<IpcPush, IpcPushService>()("arbor.IpcPush") {
    static readonly layer = Layer.effect(
        IpcPush,
        Effect.gen(function* () {
            const transport = yield* IpcTransport
            const audience = new Set<WebContents>()
            return {
                push: (key, ...value) =>
                    Schema.encodeUnknownEffect(Pushes[key].value)(value[0]).pipe(
                        Effect.flatMap((encoded) =>
                            Effect.forEach(
                                audience,
                                (renderer) => transport.send(renderer, PUSHES[key], encoded),
                                { discard: true },
                            ),
                        ),
                        Effect.catchCause((cause) =>
                            Effect.logError(`IPC push ${PUSHES[key]}`, cause),
                        ),
                    ),
                attach: (renderer) =>
                    Effect.sync(() => {
                        if (renderer.isDestroyed() || audience.has(renderer)) return
                        audience.add(renderer)
                        renderer.once("destroyed", () => audience.delete(renderer))
                    }),
            }
        }),
    )
}

/** `IpcPushService` for code outside Effect (windows, overlays), until 06 gives them a scope. */
export interface Pusher {
    readonly push: <K extends PushKey>(key: K, ...value: PushArgs<K>) => void
    readonly attach: (renderer: WebContents) => void
}
