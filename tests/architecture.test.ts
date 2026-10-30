import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vite-plus/test"

const SRC = path.resolve(import.meta.dirname, "../src")

/** The one place allowed to start Effect fibers: everything else runs on `AppRuntime`. */
const RUNTIME = "main/runtime.ts"

/**
 * Files that still call `Effect.run*` directly. This list only shrinks:
 * a phase that removes a site deletes its entry, and no phase adds one.
 */
const ALLOWED: ReadonlyArray<string> = []

const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) return sourceFiles(full)
        return /\.tsx?$/.test(entry.name) ? [full] : []
    })

describe("architecture", () => {
    it("starts Effect fibers only through the app runtime", () => {
        const offenders = sourceFiles(SRC)
            .map((file) => path.relative(SRC, file).split(path.sep).join("/"))
            .filter((file) => file !== RUNTIME && !ALLOWED.includes(file))
            .filter((file) => /\bEffect\.run[A-Z]/.test(readFileSync(path.join(SRC, file), "utf8")))
        expect(offenders).toEqual([])
    })
})
