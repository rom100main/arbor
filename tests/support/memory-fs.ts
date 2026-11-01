/**
 * `node:fs` in memory, for tests that run persistence: `vi.mock("node:fs", () => import("./support/memory-fs"))`.
 * `files` maps a path to its text. Call `files.clear()` between tests.
 */
export const files = new Map<string, string>()

/** How many times something was written, temp files included. */
export const writeCount = { value: 0 }

const missing = (path: string): Error =>
    Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" })

export const readFileSync = (path: string): string => {
    const text = files.get(path)
    if (text === undefined) throw missing(path)
    return text
}

export const writeFileSync = (path: string, text: string): void => {
    writeCount.value += 1
    files.set(path, text)
}

export const renameSync = (from: string, to: string): void => {
    const text = files.get(from)
    if (text === undefined) throw missing(from)
    files.delete(from)
    files.set(to, text)
}

export const existsSync = (path: string): boolean => files.has(path)

export const readdirSync = (): never[] => []
