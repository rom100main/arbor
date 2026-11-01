import { Effect } from "effect"
import type { WebContents } from "electron"

import type * as Transport from "../../src/main/ipc/transport"

type Answer = (raw: unknown, sender: WebContents) => Promise<unknown>
type Receive = (raw: unknown, sender: WebContents) => void

/** A renderer that records what it receives, and can be destroyed. */
export const fakeRenderer = () => {
    const received: Array<{ readonly channel: string; readonly value: unknown }> = []
    const onDestroyed: Array<() => void> = []
    let destroyed = false
    const fake = {
        isDestroyed: () => destroyed,
        send: (channel: string, value?: unknown) => received.push({ channel, value }),
        once: (_event: "destroyed", listener: () => void) => onDestroyed.push(listener),
    }
    // Only the methods the IPC code calls: a real WebContents needs Electron.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const renderer = fake as unknown as WebContents
    const destroy = (): void => {
        destroyed = true
        for (const listener of onDestroyed) listener()
    }
    return { renderer, received, destroy }
}

export const answers = new Map<string, Answer>()
export const receivers = new Map<string, Receive>()
const sender = fakeRenderer().renderer

/*
 * `src/main/ipc/transport.ts` over two Maps, for tests that serve IPC:
 * `vi.mock("../src/main/ipc/transport", () => import("./support/ipc"))`.
 * Tests call `invoke` and `emit` in place of a renderer, and `resetIpc` between tests.
 */

export const handle: typeof Transport.handle = (channel, answer) =>
    Effect.acquireRelease(
        Effect.sync(() => void answers.set(channel, answer)),
        () => Effect.sync(() => void answers.delete(channel)),
    )

export const on: typeof Transport.on = (channel, receive) =>
    Effect.acquireRelease(
        Effect.sync(() => void receivers.set(channel, receive)),
        () => Effect.sync(() => void receivers.delete(channel)),
    )

export const send: typeof Transport.send = (target, channel, value) =>
    Effect.sync(() => {
        if (!target.isDestroyed()) target.send(channel, value)
    })

/** Like `ipcRenderer.invoke`: rejects when nothing answers `channel`. */
export const invoke = (channel: string, raw?: unknown): Promise<unknown> => {
    const answer = answers.get(channel)
    return answer ? answer(raw, sender) : Promise.reject(new Error(`No handler for ${channel}`))
}

/** Like `ipcRenderer.send`: nothing happens when nothing listens. */
export const emit = (channel: string, raw?: unknown): void => receivers.get(channel)?.(raw, sender)

export const resetIpc = (): void => {
    answers.clear()
    receivers.clear()
}
