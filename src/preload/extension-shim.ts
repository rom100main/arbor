// Runs in extension contexts (frames + service workers).
// Fixes two MV3 gaps that make background scripts crash while evaluating
// (Electron reports that as "Service worker registration failed. Status code: 15"):
//
// 1. Electron exposes a partial `browser` global
//    (runtime.id but no `permissions` etc.).
//    webextension-polyfill adopts it as-is when `browser.runtime.id` exists,
//    so anything it lacks becomes a crash
//    (e.g. Proton Pass reading `browser.permissions.onAdded`).
//    Copy missing namespaces over from the fully-populated `chrome`.
// 2. `chrome.permissions.onAdded`/`onRemoved` are missing from the electron-chrome-extensions API surface;
//     stub them so listeners don't throw (they never fire, which is expected for unsupported APIs).
//
// NOTE: patchMainWorld is passed to contextBridge.executeInMainWorld,
// which evaluates it in the main world,
// it must not reference anything from this module's scope.

import { contextBridge } from "electron"

type ApiNamespace = Record<string, Record<string, unknown> | undefined>
type ExtensionGlobals = { chrome?: ApiNamespace; browser?: ApiNamespace }

const patchMainWorld = function patchMainWorld(): void {
    // globalThis is referenced inside the function body (never hoisted out):
    // this function is evaluated in the extension's main world.
    const globals = globalThis as typeof globalThis & ExtensionGlobals
    const chromeApi = globals.chrome
    const browserApi = globals.browser

    const stubEvent = (): unknown => ({
        addListener: (): void => undefined,
        removeListener: (): void => undefined,
        hasListener: (): boolean => false,
    })

    const ensurePermissions = (ns: ApiNamespace): void => {
        if (!ns.permissions) {
            try {
                ns.permissions = {}
            } catch {
                return
            }
        }
        const permissions = ns.permissions as Record<string, unknown> | undefined
        if (!permissions) return
        for (const event of ["onAdded", "onRemoved"]) {
            if (!permissions[event]) {
                try {
                    permissions[event] = stubEvent()
                } catch {
                    // Frozen namespace; nothing to do.
                }
            }
        }
    }

    if (chromeApi) ensurePermissions(chromeApi)

    if (chromeApi && browserApi) {
        for (const key of Object.getOwnPropertyNames(chromeApi)) {
            if (browserApi[key] === undefined) {
                try {
                    Object.defineProperty(browserApi, key, {
                        value: chromeApi[key],
                        configurable: true,
                        enumerable: true,
                        writable: true,
                    })
                } catch {
                    // Frozen or sealed global; nothing to do.
                }
            }
        }
        ensurePermissions(browserApi)
    }
}

if ("executeInMainWorld" in contextBridge) {
    // Sandboxed preload world: patch the world the extension script runs in.
    contextBridge.executeInMainWorld({ func: patchMainWorld })
} else {
    patchMainWorld()
}
