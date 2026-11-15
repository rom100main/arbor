/**
 * `node:fs/promises` in memory, for tests that touch serialized caches:
 * `vi.mock("node:fs/promises", () => import("./support/memory-fs-promises"))`.
 * Shares `files` with `memory-fs` so a wrapper can seed or inspect them.
 */
import { files } from "./memory-fs"

const missing = (path: string): Error =>
    Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" })

export const readFile = async (path: string): Promise<Uint8Array> => {
    const bytes = files.get(path)
    if (bytes === undefined) throw missing(path)
    return new TextEncoder().encode(bytes)
}

export const writeFile = async (path: string, bytes: Uint8Array | string): Promise<void> => {
    files.set(path, typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes))
}

export const mkdir = async (): Promise<void> => undefined
