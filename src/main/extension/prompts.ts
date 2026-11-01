import { Context, Deferred, Effect, Exit, Layer, Option, Ref } from "effect"
import { BrowserWindow } from "electron"

import type { PermissionPromptRequest } from "../../shared/protocol"
import { IpcPush, makePusher, type Pusher } from "../ipc/router"
import { CurrentWindow } from "../windows/current-window"
import { loadRenderer, preloadPath } from "../windows/paths"

export interface PermissionPromptsService {
    /** Show the modal: `true` on Allow, `false` on Deny or when it is closed. Callers serialize. */
    readonly show: (request: PermissionPromptRequest) => Effect.Effect<boolean>
    /** Answer the visible modal (`permissionRespond`). Does nothing when none is visible. */
    readonly respond: (allowed: boolean) => Effect.Effect<void>
}

/** A transparent window covering `parent`. */
const coverWindow = (parent: BrowserWindow): BrowserWindow => {
    const bounds = parent.getContentBounds()
    return new BrowserWindow({
        ...bounds,
        show: false,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        hasShadow: false,
        parent,
        webPreferences: { preload: preloadPath },
    })
}

/**
 * A frameless modal over the main window, destroyed when `show` returns.
 * `parent` waits for the main window: an ask at startup is not shown before it.
 */
const modalPrompts = (options: {
    readonly parent: Effect.Effect<BrowserWindow>
    readonly ipc: Pusher
}): Effect.Effect<PermissionPromptsService> =>
    Effect.gen(function* () {
        const visible = yield* Ref.make(Option.none<Deferred.Deferred<boolean>>())

        const show = (request: PermissionPromptRequest): Effect.Effect<boolean> =>
            Effect.gen(function* () {
                const parent = yield* options.parent
                const answer = yield* Deferred.make<boolean>()
                const win = yield* Effect.acquireRelease(
                    Effect.sync(() => coverWindow(parent)),
                    (modal) =>
                        Effect.sync(() => {
                            if (!modal.isDestroyed()) modal.destroy()
                        }),
                )
                yield* Effect.acquireRelease(Ref.set(visible, Option.some(answer)), () =>
                    Ref.set(visible, Option.none()),
                )
                yield* Effect.sync(() => {
                    // Closing the modal without answering is a refusal; an earlier answer wins.
                    win.on("closed", () => Deferred.doneUnsafe(answer, Exit.succeed(false)))
                    options.ipc.attach(win.webContents)
                    // The renderer listens once loaded, so the request is sent after the load.
                    win.webContents.on("did-finish-load", () =>
                        options.ipc.push("permissionRequest", request),
                    )
                    void loadRenderer(win, "permission")
                    win.show()
                })
                return yield* Deferred.await(answer)
            }).pipe(Effect.scoped)

        const respond = (allowed: boolean): Effect.Effect<void> =>
            Effect.flatMap(
                Ref.get(visible),
                Option.match({
                    onNone: () => Effect.void,
                    onSome: (answer) => Effect.asVoid(Deferred.succeed(answer, allowed)),
                }),
            )

        return { show, respond }
    })

/** The permission modal: consent shows it, the `permissionRespond` event answers it. */
export class PermissionPrompts extends Context.Service<
    PermissionPrompts,
    PermissionPromptsService
>()("arbor.PermissionPrompts") {
    static readonly modal = Layer.effect(
        PermissionPrompts,
        Effect.gen(function* () {
            const currentWindow = yield* CurrentWindow
            return yield* modalPrompts({
                parent: currentWindow.native,
                ipc: yield* makePusher(yield* IpcPush),
            })
        }),
    )
}
