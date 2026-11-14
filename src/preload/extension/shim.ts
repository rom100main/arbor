// Runs in extension contexts (frames + service workers).
// Fixes MV3 gaps that make background scripts crash while evaluating
// (Electron reports that as "Service worker registration failed. Status code: 15"):
//
// 1. Electron exposes a partial `browser` global
//    (runtime.id but no `permissions` etc.).
//    webextension-polyfill adopts it as-is when `browser.runtime.id` exists,
//    so anything it lacks becomes a crash
//    (e.g. an extension reading `browser.permissions.onAdded`).
//    Copy missing namespaces over from the fully-populated `chrome`,
//    and merge missing methods onto an existing partial `permissions` object.
// 2. `chrome.permissions.onAdded`/`onRemoved` are missing from the electron-chrome-extensions API surface;
//     stub them so listeners don't throw (they never fire, which is expected for unsupported APIs).
// 3. `permissions.contains({ origins })` in electron-chrome-extensions is exact-string equality,
//     so a granted `https://*/*` does not cover `https://some.com/*` (Chrome does).
//     Wrap `contains` to fall back to match-pattern subsumption.
// 4. electron-chrome-extensions ends its preload with `Object.freeze(chrome)`.
//     A frozen `chrome` breaks lazy native APIs (`Failed to create API on Chrome object`)
//     and polyfills that assign `chrome.contentScripts` / `chrome.scripting` etc.
//     ("Cannot add property contentScripts, object is not extensible"),
//     which fails MV3 service-worker registration.
//     Replace the frozen globals with unfrozen clones before anything else.
//     Namespaces are shared by reference, so IPC still works.
//

import { contextBridge } from "electron"

import { originsCoveredBy } from "../../shared/match-patterns"

type ApiNamespace = Record<string, Record<string, unknown> | undefined>
type ExtensionGlobals = {
    chrome?: ApiNamespace
    browser?: ApiNamespace
    close?: unknown
    open?: unknown
    setTimeout?: unknown
    arborCloseWrapped?: boolean
    arborOpenWrapped?: boolean
}
type OriginsCoveredBy = (granted: readonly string[], requested: readonly string[]) => boolean

const patchMainWorld = function patchMainWorld(coveredBy: OriginsCoveredBy): void {
    // globalThis is referenced inside the function body (never hoisted out):
    // this function is evaluated in the extension's main world.
    const globals = globalThis as typeof globalThis & ExtensionGlobals

    const unfreezeGlobal = (key: "chrome" | "browser"): void => {
        const value = globals[key]
        if (!value || typeof value !== "object" || Object.isExtensible(value)) return
        // Shallow freeze only: copy descriptors onto a fresh extensible object.
        const clone: ApiNamespace = {}
        for (const name of Reflect.ownKeys(value)) {
            const descriptor = Object.getOwnPropertyDescriptor(value, name)
            if (descriptor) {
                try {
                    Object.defineProperty(clone, name, descriptor)
                } catch {
                    // Skip a single uncopyable property.
                }
            }
        }
        try {
            Reflect.set(globals, key, clone)
        } catch {
            // Read-only global binding; try the descriptor below.
        }
        if (Reflect.get(globals, key) !== clone) {
            try {
                Object.defineProperty(globals, key, {
                    value: clone,
                    writable: true,
                    configurable: true,
                    enumerable: true,
                })
            } catch {
                // Non-configurable global; leave the frozen one in place.
            }
        }
    }
    unfreezeGlobal("chrome")
    unfreezeGlobal("browser")

    const chromeApi = globals.chrome
    const browserApi = globals.browser

    const stubEvent = (): unknown => ({
        addListener: (): void => undefined,
        removeListener: (): void => undefined,
        hasListener: (): boolean => false,
    })

    // Extensions may fire-and-forget tabs.create/window.open then autoClose (window.close) in the same tick.
    // Delay close so the IPC can reach main.
    try {
        const originalClose = globals.close
        if (typeof originalClose === "function" && !globals.arborCloseWrapped) {
            const delayedClose = function delayedClose(): void {
                globals.setTimeout(() => {
                    Reflect.apply(originalClose, globals, [])
                }, 250)
            }
            globals.close = delayedClose
            globals.arborCloseWrapped = true
        }
    } catch {
        // Non-configurable; leave native close alone.
    }

    // Fills gaps in a `permissions` namespace:
    // create it if missing, merge methods from a fuller source object,
    // stub missing onAdded/onRemoved, and wrap contains() with match-pattern subsumption
    // (exact equality misses https://*/* covering https://some.com/*).
    const wrapPermissions = (ns: ApiNamespace, source?: ApiNamespace): void => {
        if (!ns.permissions) {
            try {
                ns.permissions = {}
            } catch {
                return
            }
        }
        const permissions = ns.permissions as Record<string, unknown> | undefined
        if (!permissions) return

        // Merge methods from chrome.permissions when browser.permissions is a partial stub.
        const sourcePermissions = source?.permissions
        if (sourcePermissions) {
            for (const key of Object.getOwnPropertyNames(sourcePermissions)) {
                if (permissions[key] === undefined) {
                    try {
                        permissions[key] = sourcePermissions[key]
                    } catch {
                        // Frozen namespace; nothing to do.
                    }
                }
            }
        }

        for (const event of ["onAdded", "onRemoved"]) {
            if (!permissions[event]) {
                try {
                    permissions[event] = stubEvent()
                } catch {
                    // Frozen namespace; nothing to do.
                }
            }
        }

        const originalContains = permissions.contains
        if (typeof originalContains === "function" && !permissions.arborContainsWrapped) {
            const readOrigins = (value: unknown): readonly string[] => {
                if (typeof value !== "object" || value === null || !("origins" in value)) {
                    return []
                }
                const { origins } = value
                if (!Array.isArray(origins)) return []
                return origins.filter((item): item is string => typeof item === "string")
            }
            const wrapped = async (request: {
                permissions?: string[]
                origins?: string[]
            }): Promise<boolean> => {
                const raw = await Promise.resolve(
                    Reflect.apply(originalContains, permissions, [request]),
                )
                const covered =
                    raw !== false || !request.origins?.length
                        ? raw !== false
                        : await (async (): Promise<boolean> => {
                              const getAll = permissions.getAll
                              if (typeof getAll !== "function") return false
                              try {
                                  const current = await Promise.resolve(
                                      Reflect.apply(getAll, permissions, []),
                                  )
                                  return coveredBy(readOrigins(current), request.origins!)
                              } catch {
                                  return false
                              }
                          })()
                return covered
            }
            try {
                permissions.contains = wrapped
                permissions.arborContainsWrapped = true
            } catch {
                // Frozen namespace; leave original contains in place.
            }
        }
    }

    if (chromeApi) wrapPermissions(chromeApi)

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
        wrapPermissions(browserApi, chromeApi)
    }

    // Electron's partial browser.tabs may lack create, fall back to chrome's.
    if (browserApi?.tabs && chromeApi?.tabs && browserApi.tabs.create === undefined) {
        try {
            browserApi.tabs.create = chromeApi.tabs.create
        } catch {
            // ignore
        }
    }

    // Electron's native `browser.tabs`/`browser.windows` consult Chromium's tab strip,
    // which WebContentsViews never join, so they return no tabs.
    // The crx `chrome.tabs`/`chrome.windows` read Arbor's mirrored store.
    // webextension-polyfill adopts the native `browser` global as-is when it is a plain object,
    // so its `browser.tabs.query` saw an empty tab list.
    // Point those two namespaces at chrome's.
    // Other namespaces stay native (i18n, runtime, ...).
    if (chromeApi && browserApi) {
        for (const key of ["tabs", "windows"]) {
            const chromeNs = chromeApi[key]
            if (chromeNs && browserApi[key] !== chromeNs) {
                try {
                    Object.defineProperty(browserApi, key, {
                        value: chromeNs,
                        configurable: true,
                        enumerable: true,
                        writable: true,
                    })
                } catch {
                    try {
                        browserApi[key] = chromeNs
                    } catch {
                        // Frozen namespace; leave the native one in place.
                    }
                }
            }
        }
    }
}

if ("executeInMainWorld" in contextBridge) {
    // Sandboxed preload world: patch the world the extension script runs in.
    // Never let a patch failure take down the whole preload (MV3 SW registration).
    try {
        contextBridge.executeInMainWorld({ func: patchMainWorld, args: [originsCoveredBy] })
    } catch (error) {
        console.error("[arbor] extension-shim executeInMainWorld failed:", error)
    }
} else {
    try {
        patchMainWorld(originsCoveredBy)
    } catch (error) {
        console.error("[arbor] extension-shim patch failed:", error)
    }
}
