import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vite-plus/test"

import { loadOwnedFile } from "../src/main/persistence"

const tempDir = (): string => mkdtempSync(path.join(tmpdir(), "arbor-owned-"))

afterEach(() => {
    vi.restoreAllMocks()
})

describe("loadOwnedFile", () => {
    it("starts from defaults silently when the file is missing", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        expect(loadOwnedFile(path.join(tempDir(), "state.json"), () => ({}), "State")).toBeNull()
        expect(warn).not.toHaveBeenCalled()
    })

    it("returns the decoded value of a usable file", () => {
        const file = path.join(tempDir(), "data.json")
        writeFileSync(file, JSON.stringify({ a: 1 }))
        expect(loadOwnedFile(file, (data) => data, "Data")).toEqual({ a: 1 })
    })

    it("warns and starts from defaults on invalid JSON", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        const file = path.join(tempDir(), "data.json")
        writeFileSync(file, "{ not json")
        expect(loadOwnedFile(file, (data) => data, "Data")).toBeNull()
        expect(warn).toHaveBeenCalledOnce()
    })

    it("warns and starts from defaults when decode rejects the content", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        const file = path.join(tempDir(), "data.json")
        writeFileSync(file, JSON.stringify({ version: 99 }))
        expect(loadOwnedFile(file, () => null, "Data")).toBeNull()
        expect(warn).toHaveBeenCalledOnce()
    })
})
