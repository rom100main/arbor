import { Context, Effect, Exit, Layer, Scope } from "effect"
import { beforeEach, describe, expect, it, vi } from "vite-plus/test"

import { PermissionPrompts } from "../src/main/extension/prompts"
import { IpcPush } from "../src/main/ipc/router"
import { SettingsStore } from "../src/main/settings"
import { initialState } from "../src/main/state/state"
import { BrowserStore, type StoreService } from "../src/main/state/store"
import { Updater } from "../src/main/update/updater"
import { CurrentWindow } from "../src/main/windows/current-window"
import { WindowManager } from "../src/main/windows/window-manager"
import { EVENTS, PUSHES, REQUESTS } from "../src/shared/ipc/channels"
import type { DownloadInfo } from "../src/shared/protocol"
import { fakeDownloads } from "./support/downloads"
import { runTest, settle } from "./support/effect"
import { noExtensions } from "./support/extensions"
import { fakeHistory } from "./support/history"
import * as fakeIpc from "./support/ipc"
import { fakeRenderer } from "./support/ipc"
import { files } from "./support/memory-fs"
import { scriptedPrompts } from "./support/prompts"
import { currentHost, type HostCall, type MemoryHost } from "./support/window-host"

// These libraries only load inside Electron. Nothing here reaches extensions.
vi.mock("electron-chrome-extensions", () => ({ ElectronChromeExtensions: {} }))
vi.mock("electron-chrome-web-store", () => ({}))
// No Electron, IPC or disk: the in-memory stand-ins from `tests/support`.
vi.mock("../src/main/windows/electron-host", () => import("./support/window-host"))
vi.mock("../src/main/ipc/transport", () => import("./support/ipc"))
vi.mock("node:fs", () => import("./support/memory-fs"))
beforeEach(() => {
    fakeIpc.resetIpc()
    files.clear()
})

type MemoryIpc = typeof fakeIpc

/**
 * The real module over in-memory Electron, IPC and files, started like the app starts it.
 * `configure` runs before the start, to script the host.
 */
const startAppWith = (configure: (host: MemoryHost, ipc: MemoryIpc) => void) =>
    Effect.gen(function* () {
        const scope = yield* Scope.make()
        const downloads = fakeDownloads()
        const history = fakeHistory()
        const base = Layer.mergeAll(
            BrowserStore.layer(initialState()),
            SettingsStore.layer("/data/settings.json"),
            IpcPush.layer,
            CurrentWindow.layer,
            Layer.succeed(PermissionPrompts, scriptedPrompts([]).service),
            noExtensions,
            Updater.none,
            downloads.layer,
            history.layer,
        )
        const context = yield* Layer.buildWithScope(
            WindowManager.layer.pipe(Layer.provideMerge(base)),
            scope,
        )
        const host = currentHost()
        configure(host, fakeIpc)
        const store = Context.get(context, BrowserStore)
        const currentWindow = Context.get(context, CurrentWindow)
        // A renderer of the window, to see what it is pushed.
        const shell = fakeRenderer()
        yield* Context.get(context, IpcPush).attach(shell.renderer)
        const running = yield* Effect.forkIn(Context.get(context, WindowManager).start, scope)
        yield* settleLong
        return { host, ipc: fakeIpc, store, currentWindow, running, shell, downloads, history }
    })

const startApp = startAppWith(() => undefined)

/** Reconciliation runs on a forked consumer: give it room. */
const settleLong = Effect.repeat(settle, { times: 5 })

const ops = (calls: ReadonlyArray<HostCall>, op: HostCall["op"]) => calls.filter((c) => c.op === op)

const activeTab = (store: StoreService) =>
    Effect.map(store.snapshot, (snapshot) => snapshot.activeTabId)

const download = (name: string): DownloadInfo => ({
    id: `download-${name}`,
    filename: `${name}.txt`,
    savePath: `/Downloads/${name}.txt`,
    url: `https://files.test/${name}.txt`,
    state: "completed",
    receivedBytes: 10,
    totalBytes: 10,
    startedAt: 0,
    finishedAt: 1,
})

describe("WindowManager start", () => {
    it("seeds a fresh profile with one Container and opens one window", () =>
        runTest(
            Effect.gen(function* () {
                const { host, store } = yield* startApp
                expect(host.windows).toHaveLength(1)
                expect((yield* store.state).containers).toHaveLength(1)
            }),
        ))

    it("answers the shell's first asks: the channels are served before it loads", () =>
        runTest(
            Effect.gen(function* () {
                const replies: unknown[] = []
                yield* startAppWith((host, ipc) => {
                    const ask = (channel: string) =>
                        Effect.tryPromise(() => ipc.invoke(channel)).pipe(
                            Effect.catch(() => Effect.succeed("no handler")),
                            Effect.map((reply) => void replies.push(reply)),
                        )
                    host.onShellLoad(
                        Effect.andThen(ask(REQUESTS.getSnapshot), ask(REQUESTS.getSettings)),
                    )
                })
                expect(replies).toHaveLength(2)
                for (const reply of replies) expect(reply).toMatchObject({ ok: true })
            }),
        ))

    it("creates no tab view before the shell has loaded", () =>
        runTest(
            Effect.gen(function* () {
                let callsAtShellLoad: number | null = null
                const { host } = yield* startAppWith((memoryHost) => {
                    memoryHost.onShellLoad(
                        Effect.sync(() => {
                            callsAtShellLoad = memoryHost.windows[0].calls.length
                        }),
                    )
                })
                expect(callsAtShellLoad).toBe(0)
                expect(host.windows[0].calls.length).toBeGreaterThan(0)
            }),
        ))

    it("ends when the user closes the window, after closing its views (the app then quits)", () =>
        runTest(
            Effect.gen(function* () {
                const { host, running } = yield* startApp
                const window = host.windows[0]
                window.close()
                yield* settleLong
                expect(window.open).toBe(false)
                const exit = running.pollUnsafe()
                expect(exit && Exit.isSuccess(exit)).toBe(true)
            }),
        ))

    it("brings the window forward on a second launch, and opens no other", () =>
        runTest(
            Effect.gen(function* () {
                const { host } = yield* startApp
                host.relaunch()
                yield* settleLong
                expect(host.windows).toHaveLength(1)
                expect(ops(host.windows[0].calls, "focus")).toHaveLength(1)
            }),
        ))
})

describe("downloads", () => {
    it("pushes the list at startup, then on every change", () =>
        runTest(
            Effect.gen(function* () {
                const { shell, downloads } = yield* startApp
                const pushed = () =>
                    shell.received.filter((message) => message.channel === PUSHES.downloads)
                expect(pushed()).toHaveLength(1)
                expect(pushed()[0].value).toEqual({ items: [], folder: "/Downloads" })

                downloads.emit([download("a")])
                yield* settleLong
                expect(pushed()).toHaveLength(2)
                expect(pushed()[1].value).toMatchObject({ items: [{ id: "download-a" }] })
            }),
        ))
})

describe("CurrentWindow", () => {
    it("makes a tab's view at once, before reconciliation runs (chrome.tabs.create)", () =>
        runTest(
            Effect.gen(function* () {
                const { host, store, currentWindow } = yield* startApp
                const tabId = yield* store.createTab("https://now.test/")
                const view = yield* currentWindow.ensureTabView(tabId)
                expect(view.tabId).toBe(tabId)
                expect(ops(host.windows[0].calls, "createView")).toContainEqual(
                    expect.objectContaining({ tabId }),
                )
                expect(yield* currentWindow.tabIdFor(view.webContents)).toBe(tabId)
                expect(yield* currentWindow.tabIdFor(fakeRenderer().renderer)).toBeNull()
            }),
        ))
})

describe("navigation", () => {
    it("moving to arbor://settings swaps the view for an internal one, with one load (B3)", () =>
        runTest(
            Effect.gen(function* () {
                const { host, ipc, store } = yield* startApp
                const tabId = (yield* activeTab(store))!
                const calls = host.windows[0].calls
                calls.length = 0

                ipc.emit(EVENTS.omniboxActivate, { kind: "go", query: "arbor://settings" })
                yield* settleLong

                expect(ops(calls, "close")).toEqual([{ op: "close", tabId }])
                expect(ops(calls, "createView")).toEqual([
                    { op: "createView", tabId, sessionKey: { kind: "internal" } },
                ])
                expect(ops(calls, "load")).toEqual([{ op: "load", tabId, url: "arbor://settings" }])
                expect(calls).toContainEqual({ op: "show", tabId })
            }),
        ))

    it("middle click Back opens the previous page in a background child tab", () =>
        runTest(
            Effect.gen(function* () {
                const { host, ipc, store } = yield* startApp
                const tabId = (yield* activeTab(store))!

                yield* Effect.promise(() =>
                    ipc.invoke(REQUESTS.goBack, { tabId, background: true }),
                )
                yield* settleLong

                const state = yield* store.state
                const child = [...state.tabs.values()].find((tab) => tab.parentId === tabId)
                expect(child?.url).toBe("https://before.test/")
                // The current tab and its page stay put.
                expect(state.containers[0].activeTabId).toBe(tabId)
                expect(ops(host.windows[0].calls, "history")).toHaveLength(0)
            }),
        ))

    it("finishes an omnibox activation even when the page never loads (B4)", () =>
        runTest(
            Effect.gen(function* () {
                const { host, ipc, shell } = yield* startApp
                host.setLoad((url) => (url.includes("slow.test") ? Effect.never : Effect.void))

                ipc.emit(EVENTS.omniboxActivate, { kind: "go", query: "https://slow.test/" })
                yield* settleLong

                expect(shell.received.map((message) => message.channel)).toContain(
                    PUSHES.omniboxActivated,
                )
            }),
        ))

    it("sets the settings and history icons from navigation, so a reload cannot lose them", () =>
        runTest(
            Effect.gen(function* () {
                const { host, store } = yield* startApp
                const tabId = (yield* activeTab(store))!
                const window = host.windows[0]

                window.emit({ kind: "navigated", tabId, url: "arbor://settings" })
                yield* settleLong
                const first = (yield* store.state).tabs.get(tabId)
                expect(first?.favicon?.startsWith("data:image/svg+xml,")).toBe(true)

                // A favicon-less report (Chromium's "no favicon" marker) after it.
                window.emit({ kind: "favicon", tabId, favicon: null })
                yield* settleLong
                expect((yield* store.state).tabs.get(tabId)?.favicon).toBe(first?.favicon)

                // A reload reports the same URL again, with no favicon event after.
                window.emit({ kind: "navigated", tabId, url: "arbor://settings" })
                yield* settleLong
                expect((yield* store.state).tabs.get(tabId)?.favicon).toBe(first?.favicon)

                window.emit({ kind: "navigated", tabId, url: "arbor://history" })
                yield* settleLong
                const historyFavicon = (yield* store.state).tabs.get(tabId)?.favicon
                expect(historyFavicon?.startsWith("data:image/svg+xml,")).toBe(true)
                expect(historyFavicon).not.toBe(first?.favicon)

                // Ordinary pages stay with Chromium: navigation clears, then the page reports.
                window.emit({ kind: "navigated", tabId, url: "https://example.com/" })
                yield* settleLong
                expect((yield* store.state).tabs.get(tabId)?.favicon).toBeNull()
                window.emit({ kind: "favicon", tabId, favicon: "https://example.com/icon.png" })
                yield* settleLong
                expect((yield* store.state).tabs.get(tabId)?.favicon).toBe(
                    "https://example.com/icon.png",
                )
            }),
        ))
})

describe("reconciliation", () => {
    it("closes the view of a closed tab", () =>
        runTest(
            Effect.gen(function* () {
                const { host, store } = yield* startApp
                const first = (yield* activeTab(store))!
                yield* store.createTab("https://second.test/")
                yield* settleLong
                yield* store.closeTab(first)
                yield* settleLong
                expect(host.windows[0].calls).toContainEqual({ op: "close", tabId: first })
            }),
        ))

    it("gives a tab moved to another Container a view on that Container's session", () =>
        runTest(
            Effect.gen(function* () {
                const { host, store } = yield* startApp
                const tabId = (yield* activeTab(store))!
                yield* store.createTab("https://stays.test/")
                const other = yield* store.createContainer("Other")
                yield* store.moveToContainer(tabId, other)
                yield* store.selectTab(tabId)
                yield* settleLong

                const calls = host.windows[0].calls
                const created = ops(calls, "createView").filter(
                    (call) => "tabId" in call && call.tabId === tabId,
                )
                expect(created.at(-1)).toEqual({
                    op: "createView",
                    tabId,
                    sessionKey: { kind: "container", containerId: other },
                })
                expect(calls).toContainEqual({ op: "close", tabId })
            }),
        ))
})

describe("menu", () => {
    it("is rebuilt on a rename, not on a title change", () =>
        runTest(
            Effect.gen(function* () {
                const { host, store } = yield* startApp
                const tabId = (yield* activeTab(store))!
                const built = host.menus.length

                yield* store.updateTabMeta(tabId, { title: "New title" })
                yield* settleLong
                expect(host.menus).toHaveLength(built)

                const containerId = (yield* store.state).containers[0].id
                yield* store.renameContainer(containerId, "Renamed")
                yield* settleLong
                expect(host.menus.at(-1)?.containerNames).toEqual(["Renamed"])
            }),
        ))

    it("Focus Tab Tree asks the shell to focus the active tab", () =>
        runTest(
            Effect.gen(function* () {
                const { host, shell } = yield* startApp
                host.pickMenu({ kind: "focusTabTree" })
                yield* settleLong
                expect(shell.received.map((message) => message.channel)).toContain(
                    PUSHES.focusTabTree,
                )
            }),
        ))

    it("New Tab creates a tab, shows it and focuses the address bar", () =>
        runTest(
            Effect.gen(function* () {
                const { host, store, shell } = yield* startApp
                host.pickMenu({ kind: "newTab" })
                yield* settleLong
                const tabId = (yield* activeTab(store))!
                expect((yield* store.state).tabs.size).toBe(2)
                expect(host.windows[0].calls).toContainEqual({ op: "show", tabId })
                expect(shell.received.map((message) => message.channel)).toContain(
                    PUSHES.focusOmnibox,
                )
            }),
        ))
})
