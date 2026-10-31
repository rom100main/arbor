// Fails when a built preload requires anything but `electron`.
//
// Preloads run sandboxed, and a sandboxed preload can only require `electron`.
// A shared chunk or a runtime `effect` import builds fine, then breaks the bridge at runtime.
// Run after `vp build` (`vp run build` does).
import { readdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const PRELOAD_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/electron/preload")

const offenders = readdirSync(PRELOAD_DIR)
    .filter((file) => file.endsWith(".cjs"))
    .flatMap((file) => {
        const source = readFileSync(resolve(PRELOAD_DIR, file), "utf8")
        const required = [...source.matchAll(/\brequire\(\s*["'`]([^"'`]+)["'`]\s*\)/g)].map(
            (match) => match[1],
        )
        return required.filter((name) => name !== "electron").map((name) => `${file}: ${name}`)
    })

if (offenders.length > 0) {
    console.error(`Sandboxed preloads may only require "electron":\n${offenders.join("\n")}`)
    process.exit(1)
}
