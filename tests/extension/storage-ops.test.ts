import { describe, expect, it } from "vite-plus/test"

import {
    applyExtStorageOp,
    emptyExtStorageAreas,
    fromPersistedExtStorage,
    toPersistedExtStorage,
    type ExtStorageAreas,
} from "../../src/main/extension/storage-ops"
import type { ExtStorageOp } from "../../src/shared/extension-storage"

const run = (areas: ExtStorageAreas, ...ops: ExtStorageOp[]) => {
    let current = areas
    let result: unknown
    for (const op of ops) {
        const step = applyExtStorageOp(current, op)
        current = step.areas
        result = step.result
    }
    return { areas: current, result }
}

const isNumber = (value: unknown): value is number => typeof value === "number"

describe("extension storage ops", () => {
    it("set/get/remove/clear on local", () => {
        const { areas } = run(emptyExtStorageAreas(), {
            op: "set",
            area: "local",
            items: { ps: "session-blob", features: 1 },
        })
        expect(areas.local).toEqual({ ps: "session-blob", features: 1 })

        let step = applyExtStorageOp(areas, { op: "get", area: "local", keys: "ps" })
        expect(step.result).toEqual({ ps: "session-blob" })

        step = applyExtStorageOp(areas, { op: "get", area: "local", keys: ["ps", "missing"] })
        expect(step.result).toEqual({ ps: "session-blob" })

        step = applyExtStorageOp(areas, {
            op: "get",
            area: "local",
            keys: { features: 0, no: "d" },
        })
        expect(step.result).toEqual({ features: 1, no: "d" })

        step = applyExtStorageOp(areas, { op: "get", area: "local" })
        expect(step.result).toEqual({ ps: "session-blob", features: 1 })

        step = applyExtStorageOp(areas, { op: "remove", area: "local", keys: "features" })
        expect(step.areas.local).toEqual({ ps: "session-blob" })

        step = applyExtStorageOp(step.areas, { op: "clear", area: "local" })
        expect(step.areas.local).toEqual({})
    })

    it("aliases sync/managed onto local (electron-chrome-extensions semantics)", () => {
        const { areas } = run(emptyExtStorageAreas(), {
            op: "set",
            area: "sync",
            items: { k: "v" },
        })
        expect(areas.local).toEqual({ k: "v" })
        expect(areas.session).toEqual({})

        const viaManaged = applyExtStorageOp(areas, { op: "get", area: "managed", keys: "k" })
        expect(viaManaged.result).toEqual({ k: "v" })
    })

    it("keeps session separate from local", () => {
        const { areas } = run(
            emptyExtStorageAreas(),
            { op: "set", area: "local", items: { a: 1 } },
            { op: "set", area: "session", items: { a: 2 } },
        )
        expect(areas.local).toEqual({ a: 1 })
        expect(areas.session).toEqual({ a: 2 })
    })

    it("getBytesInUse counts selected keys", () => {
        const { areas, result } = run(
            emptyExtStorageAreas(),
            { op: "set", area: "local", items: { ab: "x", cd: "yz" } },
            { op: "getBytesInUse", area: "local" },
        )
        expect(isNumber(result)).toBe(true)
        const one = applyExtStorageOp(areas, {
            op: "getBytesInUse",
            area: "local",
            keys: "ab",
        })
        expect(isNumber(one.result)).toBe(true)
        if (isNumber(result) && isNumber(one.result)) {
            expect(one.result).toBeLessThan(result)
        }
    })

    it("does not mutate the input areas", () => {
        const before = emptyExtStorageAreas()
        applyExtStorageOp(before, { op: "set", area: "local", items: { x: 1 } })
        expect(before.local).toEqual({})
    })
})

describe("extension storage persist format", () => {
    it("round-trips local items only (session is memory-only)", () => {
        const extensions: Record<string, ExtStorageAreas> = {
            ext1: { local: { ps: "blob" }, session: { live: 1 } },
        }
        const restored = fromPersistedExtStorage(toPersistedExtStorage(extensions))
        expect(restored).toEqual({
            ext1: { local: { ps: "blob" }, session: {} },
        })
    })

    it("rejects unknown versions and bad shapes", () => {
        expect(fromPersistedExtStorage(null)).toBeNull()
        expect(fromPersistedExtStorage({ version: 2, extensions: {} })).toBeNull()
        expect(fromPersistedExtStorage({ version: 1, extensions: [] })).toBeNull()
    })

    it("skips non-object extension entries", () => {
        const restored = fromPersistedExtStorage({
            version: 1,
            extensions: { ok: { a: 1 }, bad: "nope" },
        })
        expect(restored).toEqual({ ok: { local: { a: 1 }, session: {} } })
    })
})

describe("applyExtStorageOp set merges", () => {
    it("overwrites matching keys and leaves others", () => {
        const { areas } = applyExtStorageOp(
            { local: { a: 1, b: 2 }, session: {} },
            { op: "set", area: "local", items: { b: 3, c: 4 } },
        )
        expect(areas.local).toEqual({ a: 1, b: 3, c: 4 })
    })
})
