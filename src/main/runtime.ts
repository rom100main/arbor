import { appendFileSync } from "node:fs"
import path from "node:path"

import { Effect, Layer, LogLevel, Logger, ManagedRuntime, References } from "effect"
import { app } from "electron"

const isDev = process.env.VITE_DEV_SERVER_URL !== undefined
/** Tests run in plain Node, where Electron's `app` does not exist. */
const inElectron = process.versions.electron !== undefined

const fileLogger = (file: string) =>
    Logger.make((options) => {
        if (!LogLevel.isGreaterThanOrEqualTo(options.logLevel, "Warn")) return
        try {
            appendFileSync(file, `${Logger.formatSimple.log(options)}\n`)
        } catch {
            // A failed log write must never take the app down.
        }
    })

/** Process-wide logging: one format, dev-only debug. Later phases merge their app-scope layers in here. */
export const LoggingLive = Layer.unwrap(
    // Built lazily, so app.getPath runs when the runtime first starts, not at import.
    Effect.sync(() =>
        Layer.mergeAll(
            Logger.layer(
                isDev || !inElectron
                    ? [Logger.consolePretty()]
                    : [
                          Logger.consolePretty(),
                          fileLogger(path.join(app.getPath("logs"), "arbor.log")),
                      ],
            ),
            Layer.succeed(References.MinimumLogLevel, isDev ? "Debug" : "Info"),
        ),
    ),
)

export const AppLive = LoggingLive // grows in 04, 05, 06 and 07

export const AppRuntime = ManagedRuntime.make(AppLive)
