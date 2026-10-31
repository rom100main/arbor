import { Context, Effect, Layer, type Scope } from "effect"
import { ipcMain, type WebContents } from "electron"

export interface IpcTransportService {
    /** Answer `channel` while the current scope is open. */
    readonly handle: (
        channel: string,
        answer: (raw: unknown, sender: WebContents) => Promise<unknown>,
    ) => Effect.Effect<void, never, Scope.Scope>
    /** Receive messages on `channel` while the current scope is open. */
    readonly on: (
        channel: string,
        receive: (raw: unknown, sender: WebContents) => void,
    ) => Effect.Effect<void, never, Scope.Scope>
    /** Does nothing for a destroyed renderer. */
    readonly send: (target: WebContents, channel: string, value: unknown) => Effect.Effect<void>
}

/** Electron's `ipcMain` and `webContents.send`. Tests use `tests/support/ipc.ts` instead. */
export class IpcTransport extends Context.Service<IpcTransport, IpcTransportService>()(
    "arbor.IpcTransport",
) {
    static readonly electron = Layer.succeed(IpcTransport, {
        handle: (channel, answer) =>
            Effect.acquireRelease(
                Effect.sync(() =>
                    ipcMain.handle(channel, (event, raw: unknown) => answer(raw, event.sender)),
                ),
                () => Effect.sync(() => ipcMain.removeHandler(channel)),
            ),
        on: (channel, receive) =>
            Effect.acquireRelease(
                Effect.sync(() => {
                    const listener = (event: Electron.IpcMainEvent, raw: unknown): void =>
                        receive(raw, event.sender)
                    ipcMain.on(channel, listener)
                    return listener
                }),
                (listener) => Effect.sync(() => ipcMain.off(channel, listener)),
            ),
        send: (target, channel, value) =>
            Effect.sync(() => {
                if (!target.isDestroyed()) target.send(channel, value)
            }),
    })
}
