import { Layer } from "effect"

import { JsonFile, makeJsonFile, type JsonFileService } from "../../src/main/persistence/json-file"

/** In memory: `files` maps a path to its text, and is what writes change. */
export const memoryJsonFile = (files: Map<string, string>): JsonFileService =>
    makeJsonFile({
        readText: (path) => {
            const text = files.get(path)
            if (text === undefined)
                throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" })
            return text
        },
        writeText: (path, text) => {
            files.set(path, text)
        },
    })

export const memoryJsonFileLayer = (files: Map<string, string>): Layer.Layer<JsonFile> =>
    Layer.succeed(JsonFile, memoryJsonFile(files))
