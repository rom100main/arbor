import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { Deferred, Effect, Fiber } from "effect"
import { describe, expect, it } from "vite-plus/test"

import { makeConsent, UndeclaredPermission } from "../../src/main/extension/consent"
import { PermissionPrompts } from "../../src/main/extension/prompts"
import { initialState } from "../../src/main/state/state"
import { BrowserStore } from "../../src/main/state/store"
import type { ExtensionGrant } from "../../src/shared/protocol"
import { runTest, settle } from "../support/effect"
import { scriptedPrompts } from "../support/prompts"

const manifest = {
    name: "Example",
    permissions: ["storage", "tabs"],
    host_permissions: ["https://example.com/*"],
    optional_permissions: ["cookies"],
    optional_host_permissions: ["https://other.example/*"],
}

const extension = { id: "ext-a", name: "Example", manifest }

/** The consent module over the real store, answering prompts from `answers`. */
const setup = (
    answers: Parameters<typeof scriptedPrompts>[0],
    ledger: Record<string, ExtensionGrant> = {},
) =>
    Effect.gen(function* () {
        const store = yield* BrowserStore.pipe(Effect.provide(BrowserStore.layer(initialState())))
        for (const [key, grant] of Object.entries(ledger)) {
            yield* store.setExtensionConsent(key, grant)
        }
        const prompts = scriptedPrompts(answers)
        const consent = yield* makeConsent.pipe(
            Effect.provideService(BrowserStore, store),
            Effect.provideService(PermissionPrompts, prompts.service),
        )
        return { consent, store, shown: prompts.shown }
    })

describe("permissionsRequest", () => {
    it("allows what the manifest or the ledger already covers, without a prompt", () =>
        runTest(
            Effect.gen(function* () {
                const { consent, shown } = yield* setup([], {
                    "ext-a": { permissions: [], origins: ["https://*/*"] },
                })
                const covered = [
                    {},
                    { permissions: ["storage"], origins: ["https://example.com/*"] },
                    // A wider granted origin covers a narrower one (match patterns).
                    { origins: ["https://deep.example.com/*"] },
                ]
                for (const request of covered) {
                    expect(yield* consent.permissionsRequest(extension, request)).toBe(true)
                }
                expect(shown).toEqual([])
            }),
        ))

    it("counts what an unpacked extension was granted under its source folder", () =>
        runTest(
            Effect.gen(function* () {
                const { consent, shown } = yield* setup([], {
                    "/src/ext": { permissions: ["cookies"], origins: [] },
                })
                const unpacked = { ...extension, path: "/src/ext" }
                expect(
                    yield* consent.permissionsRequest(unpacked, { permissions: ["cookies"] }),
                ).toBe(true)
                expect(shown).toEqual([])
            }),
        ))

    it("refuses what the manifest never declared, without a prompt", () =>
        runTest(
            Effect.gen(function* () {
                const { consent, shown } = yield* setup([])
                for (const request of [{ permissions: ["history"] }, { origins: ["<all_urls>"] }]) {
                    const error = yield* Effect.flip(consent.permissionsRequest(extension, request))
                    expect(error).toBeInstanceOf(UndeclaredPermission)
                }
                expect(shown).toEqual([])
            }),
        ))

    it("asks for an optional permission, and adds an Allow to what was granted before", () =>
        runTest(
            Effect.gen(function* () {
                const { consent, store, shown } = yield* setup([true], {
                    "ext-a": { permissions: [], origins: ["https://other.example/*"] },
                })
                // Only part of it is held: still a prompt.
                const request = { permissions: ["storage", "cookies"] }
                expect(yield* consent.permissionsRequest(extension, request)).toBe(true)
                expect(shown).toMatchObject([{ kind: "request", id: "ext-a" }])
                expect((yield* store.extensionConsent)["ext-a"]).toEqual({
                    permissions: ["storage", "cookies"],
                    origins: ["https://other.example/*"],
                })
            }),
        ))

    it("leaves the ledger alone on a Deny", () =>
        runTest(
            Effect.gen(function* () {
                const { consent, store } = yield* setup([false])
                const request = { origins: ["https://other.example/*"] }
                expect(yield* consent.permissionsRequest(extension, request)).toBe(false)
                expect(yield* store.extensionConsent).toEqual({})
            }),
        ))
})

describe("installConsent", () => {
    const details = {
        id: "ext-store",
        localizedName: "From the store",
        // Repeats are dropped and missing lists are empty.
        manifest: { permissions: ["tabs", "tabs"] },
    }

    it("records the manifest's permissions on Allow", () =>
        runTest(
            Effect.gen(function* () {
                const { consent, store, shown } = yield* setup([true])
                expect(yield* consent.installConsent(details)).toBe("allow")
                expect(shown).toMatchObject([
                    { kind: "install", name: "From the store", permissions: ["tabs"], origins: [] },
                ])
                expect((yield* store.extensionConsent)["ext-store"]).toEqual({
                    permissions: ["tabs"],
                    origins: [],
                })
            }),
        ))

    it("records nothing on Deny", () =>
        runTest(
            Effect.gen(function* () {
                const { consent, store } = yield* setup([false])
                expect(yield* consent.installConsent(details)).toBe("deny")
                expect(yield* store.extensionConsent).toEqual({})
            }),
        ))
})

describe("unpackedConsent", () => {
    const unpackedFolder = (): string => {
        const folder = mkdtempSync(path.join(tmpdir(), "arbor-ext-"))
        writeFileSync(
            path.join(folder, "manifest.json"),
            JSON.stringify({ name: "Dev", permissions: ["storage"] }),
        )
        return folder
    }

    it("asks once for two concurrent loads of the same folder", () =>
        runTest(
            Effect.gen(function* () {
                const folder = unpackedFolder()
                const { consent, store, shown } = yield* setup([true])
                const answers = yield* Effect.all(
                    [consent.unpackedConsent(folder), consent.unpackedConsent(folder)],
                    { concurrency: "unbounded" },
                )
                expect(answers).toEqual([true, true])
                expect(shown).toMatchObject([{ kind: "install", id: folder, name: "Dev" }])
                expect((yield* store.extensionConsent)[folder]).toEqual({
                    permissions: ["storage"],
                    origins: [],
                })
            }),
        ))

    it("does not ask again after a Deny (B8)", () =>
        runTest(
            Effect.gen(function* () {
                const folder = unpackedFolder()
                const { consent, shown } = yield* setup([false])
                expect(yield* consent.unpackedConsent(folder)).toBe(false)
                expect(yield* consent.unpackedConsent(folder)).toBe(false)
                expect(shown).toHaveLength(1)
            }),
        ))

    it("does not ask for a folder the ledger already holds", () =>
        runTest(
            Effect.gen(function* () {
                const folder = unpackedFolder()
                const { consent, shown } = yield* setup([], {
                    [folder]: { permissions: ["storage"], origins: [] },
                })
                expect(yield* consent.unpackedConsent(folder)).toBe(true)
                expect(shown).toEqual([])
            }),
        ))
})

describe("one prompt at a time", () => {
    const installA = { id: "a", localizedName: "A", manifest: {} }
    const installB = { id: "b", localizedName: "B", manifest: {} }
    const installC = { id: "c", localizedName: "C", manifest: {} }

    it("shows the next prompt only once the current one is answered", () =>
        runTest(
            Effect.gen(function* () {
                const gate = yield* Deferred.make<boolean>()
                const { consent, shown } = yield* setup([Deferred.await(gate), false])
                const first = yield* Effect.forkChild(consent.installConsent(installA))
                const second = yield* Effect.forkChild(consent.installConsent(installB))
                yield* settle
                expect(shown.map((request) => request.id)).toEqual(["a"])

                yield* Deferred.succeed(gate, true)
                expect(yield* Fiber.join(first)).toBe("allow")
                expect(yield* Fiber.join(second)).toBe("deny")
                expect(shown.map((request) => request.id)).toEqual(["a", "b"])
            }),
        ))

    it("an ask interrupted while waiting is never shown, and does not block the next", () =>
        runTest(
            Effect.gen(function* () {
                const gate = yield* Deferred.make<boolean>()
                const { consent, shown } = yield* setup([Deferred.await(gate), true])
                const first = yield* Effect.forkChild(consent.installConsent(installA))
                const waiting = yield* Effect.forkChild(consent.installConsent(installB))
                const third = yield* Effect.forkChild(consent.installConsent(installC))
                yield* settle
                yield* Fiber.interrupt(waiting)

                yield* Deferred.succeed(gate, false)
                expect(yield* Fiber.join(first)).toBe("deny")
                expect(yield* Fiber.join(third)).toBe("allow")
                expect(shown.map((request) => request.id)).toEqual(["a", "c"])
            }),
        ))
})
