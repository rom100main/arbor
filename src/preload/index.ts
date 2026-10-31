import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"
import { injectBrowserAction } from "electron-chrome-extensions/browser-action"

import { EVENTS, PUSHES, REQUESTS } from "../shared/ipc/channels"

// <browser-action-list> element + window.browserAction API (main world injection).
injectBrowserAction()

// Only the channels in the tables are reachable: never a generic `invoke(channel)`,
// which would let any Arbor page call the handlers extension libraries register on ipcMain.
// `window.arbor` is typed by `ArborApi` (arbor.d.ts), built from the same tables as these methods.
type Method = [name: string, method: (...args: never[]) => unknown]

const requests = Object.entries(REQUESTS).map(([name, channel]): Method => [
    name,
    (payload?: unknown) => ipcRenderer.invoke(channel, payload),
])
const events = Object.entries(EVENTS).map(([name, channel]): Method => [
    name,
    (payload?: unknown) => ipcRenderer.send(channel, payload),
])
const pushes = Object.entries(PUSHES).map(([name, channel]): Method => [
    `on${name[0].toUpperCase()}${name.slice(1)}`,
    (callback: (value: unknown) => void) => {
        const listener = (_event: IpcRendererEvent, value: unknown): void => callback(value)
        ipcRenderer.on(channel, listener)
        return () => {
            ipcRenderer.removeListener(channel, listener)
        }
    },
])

contextBridge.exposeInMainWorld("arbor", Object.fromEntries([...requests, ...events, ...pushes]))
