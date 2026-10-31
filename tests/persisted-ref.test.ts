import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { Context, Effect, Exit, Layer, Option, Scope } from "effect"
import { TestClock } from "effect/testing"
import { describe, expect, it } from "vite-plus/test"

import { JsonFile } from "../src/main/persistence/json-file"
import * as PersistedRef from "../src/main/persistence/persisted-ref"
import { browserStoreFromFile } from "../src/main/persistence/state-file"
import { PERSIST_VERSION } from "../src/main/state/persist"
import { BrowserStore } from "../src/main/state/store"
import { captureLogs, runTest, settle } from "./support/effect"
import { memoryJsonFile, memoryJsonFileLayer } from "./support/json-file"

const FILE = "/data/value.json"

/** A file of numbers, counting how many times it was written. */
const setup = (initial?: string) =>
    Effect.gen(function* () {
        const files = new Map<string, string>()
        if (initial !== undefined) files.set(FILE, initial)
        let writes = 0
        const memory = memoryJsonFile(files)
        const counting = Layer.succeed(JsonFile, {
            read: memory.read,
            write: (filePath, value) =>
                Effect.tap(memory.write(filePath, value), () => Effect.sync(() => (writes += 1))),
        })
        const scope = yield* Scope.make()
        const ref = yield* PersistedRef.make({
            path: FILE,
            read: Effect.gen(function* () {
                const file = yield* JsonFile
                return yield* file.read(FILE, (data) => (typeof data === "number" ? data : null))
            }),
            encode: (n: number) => n,
            empty: () => 0,
        }).pipe(Effect.provide(counting), Scope.provide(scope))
        const increment = ref.modifySome((n) => [undefined, Option.some(n + 1)] as const)
        return { ref, files, scope, increment, writes: () => writes }
    })

describe("PersistedRef", () => {
    it("writes a burst of changes once, after the debounce", () =>
        runTest(
            Effect.gen(function* () {
                const { files, increment, writes } = yield* setup()
                yield* increment
                yield* increment
                yield* increment
                yield* settle
                expect(writes()).toBe(0)

                yield* TestClock.adjust(PersistedRef.DEFAULT_DEBOUNCE)
                yield* settle
                expect(writes()).toBe(1)
                expect(files.get(FILE)).toBe("3")
            }),
        ))

    it("closing the scope writes a pending change at once", () =>
        runTest(
            Effect.gen(function* () {
                const { files, scope, increment, writes } = yield* setup()
                yield* increment
                // No settle, no clock: the change has not reached the debounce yet.
                yield* Scope.close(scope, Exit.void)
                expect(writes()).toBe(1)
                expect(files.get(FILE)).toBe("1")
            }),
        ))

    it("a missing file starts empty and writes nothing until a change", () =>
        runTest(
            Effect.gen(function* () {
                const { ref, scope, writes } = yield* setup()
                expect(yield* ref.get).toBe(0)
                yield* TestClock.adjust("1 second")
                yield* Scope.close(scope, Exit.void)
                expect(writes()).toBe(0)
            }),
        ))

    it("a no-op modification writes nothing", () =>
        runTest(
            Effect.gen(function* () {
                const { ref, scope, writes } = yield* setup("5")
                yield* ref.modifySome((n) => [n, Option.none()] as const)
                yield* Scope.close(scope, Exit.void)
                expect(writes()).toBe(0)
            }),
        ))

    it("an unusable file is logged and the value starts empty (B6)", () =>
        runTest(
            Effect.gen(function* () {
                for (const content of ["{ not json", '"not a number"']) {
                    const logs = captureLogs()
                    const { ref } = yield* setup(content).pipe(Effect.provide(logs.layer))
                    expect(yield* ref.get).toBe(0)
                    expect(logs.entries.map((entry) => entry.level)).toEqual(["Warn"])
                }
            }),
        ))
})

describe("state file", () => {
    const STATE = "/data/state.json"

    const loadStore = (content: string) =>
        Effect.gen(function* () {
            const files = new Map([[STATE, content]])
            const logs = captureLogs()
            const scope = yield* Scope.make()
            const context = yield* Layer.buildWithScope(
                browserStoreFromFile(STATE).pipe(Layer.provide(memoryJsonFileLayer(files))),
                scope,
            ).pipe(Effect.provide(logs.layer))
            const store = Context.get(context, BrowserStore)
            return { store, files, scope, levels: logs.entries.map((entry) => entry.level) }
        })

    it("starts empty and logs on bad JSON, an unknown version, or no live container", () =>
        runTest(
            Effect.gen(function* () {
                const unusable = [
                    "{ not json",
                    JSON.stringify({ version: 99, containers: [], tabs: [] }),
                    JSON.stringify({ version: PERSIST_VERSION, containers: [], tabs: [] }),
                ]
                for (const content of unusable) {
                    const { store, levels } = yield* loadStore(content)
                    expect((yield* store.state).containers).toEqual([])
                    expect(levels).toEqual(["Warn"])
                }
            }),
        ))

    it("writes the store's changes, and what it wrote loads back", () =>
        runTest(
            Effect.gen(function* () {
                const empty = JSON.stringify({ version: PERSIST_VERSION, containers: [], tabs: [] })
                const first = yield* loadStore(empty)
                const id = yield* first.store.createContainer("Work")
                yield* Scope.close(first.scope, Exit.void)

                const second = yield* loadStore(first.files.get(STATE)!)
                const containers = (yield* second.store.state).containers
                expect(containers.map((c) => [c.id, c.name])).toEqual([[id, "Work"]])
            }),
        ))
})

describe("JsonFile (node adapter)", () => {
    it("writes atomically and reads back; a missing file is FileMissing", () =>
        runTest(
            Effect.gen(function* () {
                const file = yield* JsonFile
                const filePath = path.join(
                    mkdtempSync(path.join(tmpdir(), "arbor-json-")),
                    "a.json",
                )

                const missing = yield* Effect.flip(file.read(filePath, (data) => data))
                expect(missing).toMatchObject({ path: filePath })

                yield* file.write(filePath, { a: 1 })
                expect(yield* file.read(filePath, (data) => data)).toEqual({ a: 1 })
            }).pipe(Effect.provide(JsonFile.layer)),
        ))
})
