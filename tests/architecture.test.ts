import { existsSync, readdirSync, readFileSync } from "node:fs"
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

/**
 * Specifiers a file loads at runtime: `import type` and `export type` are erased, all else stays.
 * The clause before `from` may span lines (`import {\n a,\n} from`) but never holds `=`,
 * so a match cannot run from an `export const` on into a later statement.
 */
const runtimeImports = (source: string): string[] =>
    [
        ...source.matchAll(
            /^(?:import|export)\s+(?!type\s)(?:[^"';=]*?\sfrom\s+)?["']([^"']+)["']/gm,
        ),
    ].map((match) => match[1])

const resolveLocal = (from: string, specifier: string): string | null => {
    const base = path.resolve(path.dirname(from), specifier)
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
        if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate
    }
    return null
}

/** The import path from `file` to `effect`, following local runtime imports; `null` when none. */
const effectImportChain = (file: string, seen: Set<string>): string[] | null => {
    if (seen.has(file)) return null
    seen.add(file)
    for (const specifier of runtimeImports(readFileSync(file, "utf8"))) {
        if (specifier === "effect" || specifier.startsWith("effect/")) return [file, specifier]
        if (!specifier.startsWith(".")) continue
        const target = resolveLocal(file, specifier)
        const chain = target ? effectImportChain(target, seen) : null
        if (chain) return [file, ...chain]
    }
    return null
}

describe("architecture", () => {
    it("starts Effect fibers only through the app runtime", () => {
        const offenders = sourceFiles(SRC)
            .map((file) => path.relative(SRC, file).split(path.sep).join("/"))
            .filter((file) => file !== RUNTIME && !ALLOWED.includes(file))
            .filter((file) => /\bEffect\.run[A-Z]/.test(readFileSync(path.join(SRC, file), "utf8")))
        expect(offenders).toEqual([])
    })

    it("keeps effect out of the renderer and preload bundles", () => {
        const offenders = sourceFiles(SRC)
            .filter((file) => /[\\/](renderer|preload)[\\/]/.test(file))
            .flatMap((file) => {
                const chain = effectImportChain(file, new Set())
                return chain
                    ? [
                          chain
                              .map((f) => (path.isAbsolute(f) ? path.relative(SRC, f) : f))
                              .join(" -> "),
                      ]
                    : []
            })
        expect(offenders).toEqual([])
    })
})
