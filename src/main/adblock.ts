/**
 * The Adblock module:
 * native, main-process ad and tracker blocking for every Container session,
 * powered by Ghostery's filtering engine.
 *
 * Lists are fetched fresh on every launch.
 * The serialized engine is cached on disk so the next launch can block immediately and offline,
 * then swapped for the fresh lists when the fetch lands.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"

import { ElectronBlocker } from "@ghostery/adblocker-electron"
import { Context, Deferred, Effect, FiberSet, Layer, Option, Stream } from "effect"
import { ipcMain, type Session } from "electron"
import { parse } from "tldts-experimental"

import { SettingsStore } from "./settings"

const ghostPreloadPath = ((): string =>
    createRequire(import.meta.url).resolve("@ghostery/adblocker-electron-preload"))()

const INJECT_CHANNEL = "@ghostery/adblocker/inject-cosmetic-filters"
const MUTATION_CHANNEL = "@ghostery/adblocker/is-mutation-observer-enabled"

const globToRegExp = (glob: string): RegExp =>
    new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`, "i")

export const matchesDisabledPattern = (patterns: readonly string[], url: string): boolean => {
    try {
        const { hostname } = new URL(url)
        return patterns.some((raw) => {
            const pattern = raw.trim()
            if (pattern.length === 0) return false
            const target = pattern.includes("://") || pattern.includes("/") ? url : hostname
            return globToRegExp(pattern).test(target)
        })
    } catch {
        return false
    }
}

export interface AdblockService {
    /** Hook a session's webRequest and cosmetic preload. Safe to call repeatedly for one session. */
    readonly attach: (ses: Session) => Effect.Effect<void>
    /**
     * Completes once the startup pass latched an engine (cache or fresh).
     * Never fails: blocking simply stays off when both fail.
     */
    readonly ready: Effect.Effect<void>
}

export interface AdblockOptions {
    /** Where the serialized engine cache lives: `<userData>/adblock/engine.bin`. */
    readonly cachePath: string
}

const make = (options: AdblockOptions) =>
    Effect.gen(function* () {
        const settings = yield* SettingsStore
        const run = yield* FiberSet.makeRuntime()

        let blocker: ElectronBlocker | null = null

        /**
         * Read synchronously: the webRequest hooks cannot wait on an Effect.
         * Mirrored from the setting, so toggling blocks or unblocks everywhere at once,
         * without touching any session.
         */
        const initial = yield* settings.get
        let enabled = initial.adblockEnabled
        let disabledSites = initial.adblockDisabledSites
        yield* settings.changes.pipe(
            Stream.runForEach((next) =>
                Effect.sync(() => {
                    enabled = next.adblockEnabled
                    disabledSites = next.adblockDisabledSites
                }),
            ),
            Effect.forkScoped,
        )

        /** A disabled site gets no blocking at all: no network verdicts, no cosmetic CSS. */
        const isDisabledSite = (url: string): boolean =>
            disabledSites.length > 0 && matchesDisabledPattern(disabledSites, url)

        /**
         * Network hooks delegate to `blocker`,
         * so a fresh-list swap needs no session work:
         * the next request already uses the new engine.
         * Requests before it lands are allowed.
         */
        const onBeforeRequest = (
            details: Parameters<ElectronBlocker["onBeforeRequest"]>[0],
            callback: Parameters<ElectronBlocker["onBeforeRequest"]>[1],
        ): void => {
            if (
                !enabled ||
                !blocker ||
                details.resourceType === "mainFrame" ||
                isDisabledSite(details.url)
            ) {
                callback({})
                return
            }
            blocker.onBeforeRequest(details, callback)
        }

        const onHeadersReceived = (
            details: Parameters<ElectronBlocker["onHeadersReceived"]>[0],
            callback: Parameters<ElectronBlocker["onHeadersReceived"]>[1],
        ): void => {
            if (!enabled || !blocker || isDisabledSite(details.url)) {
                callback({})
                return
            }
            blocker.onHeadersReceived(details, callback)
        }

        /**
         * Cosmetic filters need the Ghostery preload in every session,
         * but its two `ipcMain` handlers are process-global, so they register once.
         * `ElectronBlocker.enableBlockingInSession`
         * registers them per session and throws on the second Container,
         * hence this thin wiring.
         *
         * Injection is CSS only.
         * Ghostery's own handler also runs `+js` scriptlets via `executeJavaScript`;
         * those patch page globals and break some websites.
         * CSS hiding cannot break the page's scripts, so works everywhere.
         * `getInjectionRules: false` keeps the engine from even compiling a scriptlet to run.
         */
        let ipcWired = false
        const ensureIpc = (): void => {
            if (ipcWired) return
            ipcWired = true
            ipcMain.handle(INJECT_CHANNEL, (event, url: string, msg) => {
                if (!enabled || !blocker || isDisabledSite(url)) return Promise.resolve()
                try {
                    const parsed = parse(url)
                    const hostname = parsed.hostname || ""
                    const domain = parsed.domain || ""
                    const isFirstRun = msg === undefined
                    const { active, styles } = blocker.getCosmeticsFilters({
                        domain,
                        hostname,
                        url,
                        classes: msg?.classes,
                        hrefs: msg?.hrefs,
                        ids: msg?.ids,
                        getBaseRules: isFirstRun,
                        getInjectionRules: false,
                        getExtendedRules: false,
                        getRulesFromHostname: isFirstRun,
                        getRulesFromDOM: !isFirstRun,
                        callerContext: {
                            frameId: event.frameId,
                            processId: event.processId,
                            lifecycle: msg?.lifecycle,
                        },
                    })
                    if (!active || styles.length === 0) return Promise.resolve()
                    // A sender destroyed mid-navigation just fails the insert: expected.
                    return event.sender
                        .insertCSS(styles, { cssOrigin: "user" })
                        .then(
                            () => undefined,
                            () => undefined,
                        )
                } catch (error) {
                    run(Effect.logError("Adblock: cosmetic filter failed", error))
                    return Promise.resolve()
                }
            })
            ipcMain.handle(MUTATION_CHANNEL, (event) => {
                if (!enabled || !blocker) return Promise.resolve(false)
                const senderUrl =
                    typeof event.sender?.getURL === "function" ? event.sender.getURL() : ""
                if (senderUrl.length > 0 && isDisabledSite(senderUrl)) {
                    return Promise.resolve(false)
                }
                return blocker.onIsMutationObserverEnabled(event)
            })
        }

        const attached = new Set<Session>()

        const attach = (ses: Session) =>
            Effect.sync(() => {
                if (attached.has(ses)) return
                attached.add(ses)
                ensureIpc()
                ses.registerPreloadScript({ type: "frame", filePath: ghostPreloadPath })
                ses.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, onBeforeRequest)
                ses.webRequest.onHeadersReceived({ urls: ["<all_urls>"] }, onHeadersReceived)
            })

        // `null` when there is no cache file or it does not deserialize.
        // `Effect.option` turns a failed read / deserialize into absence.
        const loadCache = Effect.gen(function* () {
            const raw = yield* Effect.tryPromise({
                try: () => readFile(options.cachePath),
                catch: (error) => error,
            }).pipe(Effect.option)
            if (Option.isNone(raw)) return null
            const parsed = yield* Effect.try({
                try: () => ElectronBlocker.deserialize(raw.value),
                catch: (error) => error,
            }).pipe(Effect.option)
            return Option.getOrNull(parsed)
        })

        /**
         * One startup pass: block fast from cache if there is one,
         * then replace it with freshly fetched lists and refresh the cache.
         * A failed fetch never clears the cache,
         * a failed deserialize just falls through to the fetch.
         */
        const refresh = Effect.gen(function* () {
            const cached = yield* loadCache
            if (cached) {
                blocker = cached
                yield* Effect.logInfo("Adblock: blocking from cached lists")
            }
            const fresh = yield* Effect.tryPromise({
                try: () => ElectronBlocker.fromPrebuiltAdsAndTracking(globalThis.fetch),
                catch: (error) => error,
            }).pipe(Effect.option)
            if (Option.isNone(fresh)) {
                if (!cached) {
                    yield* Effect.logError("Adblock: filter lists failed to load, blocking is off")
                } else {
                    yield* Effect.logError("Adblock: filter update failed, keeping cached lists")
                }
                return
            }
            blocker = fresh.value
            const next = fresh.value
            yield* Effect.logInfo("Adblock: lists updated")
            yield* Effect.tryPromise({
                try: () =>
                    mkdir(path.dirname(options.cachePath), { recursive: true }).then(() =>
                        writeFile(options.cachePath, next.serialize()),
                    ),
                catch: (error) => error,
            }).pipe(
                Effect.tapError((error) => Effect.logError("Adblock: cache write failed", error)),
                Effect.ignore,
            )
        })

        const done = yield* Deferred.make<void>()
        run(
            Effect.andThen(
                Effect.catchCause(refresh, (cause) =>
                    Effect.logError("Adblock: startup failed", cause),
                ),
                Deferred.succeed(done, void 0),
            ),
        )

        return Adblock.of({ attach, ready: Deferred.await(done) })
    })

export class Adblock extends Context.Service<Adblock, AdblockService>()("arbor.Adblock") {
    static readonly layer = (options: AdblockOptions): Layer.Layer<Adblock, never, SettingsStore> =>
        Layer.effect(Adblock, make(options))
}
