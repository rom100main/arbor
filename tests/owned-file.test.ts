import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { Effect } from "effect"
import { describe, expect, it } from "vite-plus/test"

import { loadOwnedFile } from "../src/main/persistence"
import { captureLogs, runTest } from "./support/effect"

const tempDir = (): string => mkdtempSync(path.join(tmpdir(), "arbor-owned-"))

const load = async <A>(filePath: string, decode: (data: unknown) => A | null) => {
    const logs = captureLogs()
    const value = await runTest(
        loadOwnedFile(filePath, decode, "Data").pipe(Effect.provide(logs.layer)),
    )
    return { value, levels: logs.entries.map((entry) => entry.level) }
}

describe("loadOwnedFile", () => {
    it("starts from defaults silently when the file is missing", async () => {
        const { value, levels } = await load(path.join(tempDir(), "state.json"), () => ({}))
        expect(value).toBeNull()
        expect(levels).toEqual([])
    })

    it("returns the decoded value of a usable file", async () => {
        const file = path.join(tempDir(), "data.json")
        writeFileSync(file, JSON.stringify({ a: 1 }))
        const { value, levels } = await load(file, (data) => data)
        expect(value).toEqual({ a: 1 })
        expect(levels).toEqual([])
    })

    it("warns and starts from defaults on invalid JSON", async () => {
        const file = path.join(tempDir(), "data.json")
        writeFileSync(file, "{ not json")
        const { value, levels } = await load(file, (data) => data)
        expect(value).toBeNull()
        expect(levels).toEqual(["Warn"])
    })

    it("warns and starts from defaults when decode rejects the content", async () => {
        const file = path.join(tempDir(), "data.json")
        writeFileSync(file, JSON.stringify({ version: 99 }))
        const { value, levels } = await load(file, () => null)
        expect(value).toBeNull()
        expect(levels).toEqual(["Warn"])
    })
})
