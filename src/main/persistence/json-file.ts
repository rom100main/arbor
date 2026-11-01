import { readFileSync, renameSync, writeFileSync } from "node:fs"

import { Effect, Schema } from "effect"

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

const reasonOf = (error: unknown): string =>
    error instanceof Error ? error.message : String(error)

const isMissingFile = (error: unknown): boolean =>
    typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"

/** Parse the file and decode it, `decode` returns `null` for content it cannot use. */
export const readJson = <A>(
    path: string,
    decode: (data: unknown) => A | null,
): Effect.Effect<A, FileMissing | FileUnreadable> =>
    Effect.try({
        try: () => readFileSync(path, "utf8"),
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
    )

/** Atomic: temp file + rename. Synchronous inside, so it is safe on the quit path. */
export const writeJson = (path: string, value: unknown): Effect.Effect<void, FileUnwritable> =>
    Effect.try({
        try: () => {
            const tmp = `${path}.tmp`
            writeFileSync(tmp, JSON.stringify(value), "utf8")
            renameSync(tmp, path)
        },
        catch: (error) => new FileUnwritable({ path, reason: reasonOf(error) }),
    })

/** Lenient read for files Arbor does not own (extension manifests): any failure is `null`. */
export const readJsonLenient = (path: string): unknown => {
    try {
        return JSON.parse(readFileSync(path, "utf8")) as unknown
    } catch {
        return null
    }
}
