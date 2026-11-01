import { Effect, type Scope } from "effect"
import { ipcMain, type WebContents } from "electron"

/** Answer `channel` while the current scope is open. */
export const handle = (
    channel: string,
    answer: (raw: unknown, sender: WebContents) => Promise<unknown>,
): Effect.Effect<void, never, Scope.Scope> =>
    Effect.acquireRelease(
        Effect.sync(() =>
            ipcMain.handle(channel, (event, raw: unknown) => answer(raw, event.sender)),
        ),
        () => Effect.sync(() => ipcMain.removeHandler(channel)),
    )

/** Receive messages on `channel` while the current scope is open. */
export const on = (
    channel: string,
    receive: (raw: unknown, sender: WebContents) => void,
): Effect.Effect<void, never, Scope.Scope> =>
    Effect.acquireRelease(
        Effect.sync(() => {
            const listener = (event: Electron.IpcMainEvent, raw: unknown): void =>
                receive(raw, event.sender)
            ipcMain.on(channel, listener)
            return listener
        }),
        (listener) => Effect.sync(() => ipcMain.off(channel, listener)),
    )

/** Does nothing for a destroyed renderer. */
export const send = (target: WebContents, channel: string, value: unknown): Effect.Effect<void> =>
    Effect.sync(() => {
        if (!target.isDestroyed()) target.send(channel, value)
    })
