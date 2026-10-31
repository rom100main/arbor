import { readFileSync, renameSync, writeFileSync } from "node:fs"

import { Context, Effect, Layer, Schema } from "effect"

export class FileMissing extends Schema.TaggedError<FileMissing>()("FileMissing", {
    path: Schema.String,
}) {}

export class FileUnreadable extends Schema.TaggedError<FileUnreadable>()("FileUnreadable", {
    path: Schema.String,
    /** EACCES, invalid JSON, unsupported content (bad shape, unknown version, no live container)… */
    reason: Schema.String,
}) {}

export class FileUnwritable extends Schema.TaggedError<FileUnwritable>()("FileUnwritable", {
    path: Schema.String,
    reason: Schema.String,
}) {}

export interface JsonFileService {
    /**
     * Parse the file and decode it, `decode` returns `null` for content it cannot use.
     * A missing file and an unusable one are different failures.
     */
    readonly read: <A>(
        path: string,
        decode: (data: unknown) => A | null,
    ) => Effect.Effect<A, FileMissing | FileUnreadable>
    /** Atomic: temp file + rename. Synchronous inside, so it is safe on the quit path. */
    readonly write: (path: string, value: unknown) => Effect.Effect<void, FileUnwritable>
}

const reasonOf = (error: unknown): string =>
    error instanceof Error ? error.message : String(error)

const isMissingFile = (error: unknown): boolean =>
    typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"

/**
 * Read and write through `readText` / `writeText`, so every adapter shares parsing and decoding.
 * Exported for the in-memory test adapter (`tests/support/json-file.ts`).
 */
export const makeJsonFile = (io: {
    readonly readText: (path: string) => string
    readonly writeText: (path: string, text: string) => void
}): JsonFileService => ({
    read: (path, decode) =>
        Effect.try({
            try: () => io.readText(path),
            catch: (error) =>
                isMissingFile(error)
                    ? new FileMissing({ path })
                    : new FileUnreadable({ path, reason: reasonOf(error) }),
        }).pipe(
            Effect.flatMap((text) =>
                Effect.try({
                    try: () => decode(JSON.parse(text) as unknown),
                    catch: (error) => new FileUnreadable({ path, reason: reasonOf(error) }),
                }),
            ),
            Effect.flatMap((value) =>
                value === null
                    ? Effect.fail(new FileUnreadable({ path, reason: "unsupported content" }))
                    : Effect.succeed(value),
            ),
        ),
    write: (path, value) =>
        Effect.try({
            try: () => io.writeText(path, JSON.stringify(value)),
            catch: (error) => new FileUnwritable({ path, reason: reasonOf(error) }),
        }),
})

const nodeJsonFile = makeJsonFile({
    readText: (path) => readFileSync(path, "utf8"),
    writeText: (path, text) => {
        const tmp = `${path}.tmp`
        writeFileSync(tmp, text, "utf8")
        renameSync(tmp, path)
    },
})

export class JsonFile extends Context.Service<JsonFile, JsonFileService>()("arbor.JsonFile") {
    static readonly layer = Layer.succeed(JsonFile, nodeJsonFile)
}

/** Lenient read for files Arbor does not own (extension manifests): any failure is `null`. */
export const readJsonLenient = (path: string): unknown => {
    try {
        return JSON.parse(readFileSync(path, "utf8")) as unknown
    } catch {
        return null
    }
}
