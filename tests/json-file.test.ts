import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { Effect } from "effect"
import { describe, expect, it } from "vite-plus/test"

import { readJson, writeJson } from "../src/main/persistence/json-file"
import { runTest } from "./support/effect"

describe("json-file (real disk)", () => {
    it("writes atomically and reads back; a missing file is FileMissing", () =>
        runTest(
            Effect.gen(function* () {
                const filePath = path.join(
                    mkdtempSync(path.join(tmpdir(), "arbor-json-")),
                    "a.json",
                )

                const missing = yield* Effect.flip(readJson(filePath, (data) => data))
                expect(missing).toMatchObject({ path: filePath })

                yield* writeJson(filePath, { a: 1 })
                expect(yield* readJson(filePath, (data) => data)).toEqual({ a: 1 })
            }),
        ))
})
