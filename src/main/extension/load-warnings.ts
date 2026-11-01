import { Option, Schema } from "effect"

/**
 * Electron's extension loader warns about permission names it does not know
 * (`webNavigation` is provided by electron-chrome-extensions itself, `privacy` is optional and unimplemented).
 * Drop only those all-benign warnings so real extension load problems stay visible.
 */
const decodeWarningType = Schema.decodeUnknownOption(
    Schema.Union([Schema.String, Schema.Struct({ type: Schema.String })]),
)

const readWarningType = (value: unknown): string =>
    Option.match(decodeWarningType(value), {
        onNone: () => "",
        onSome: (decoded) => (typeof decoded === "string" ? decoded : decoded.type),
    })

export const filterBenignExtensionLoadWarnings = (): void => {
    const original = process.emitWarning.bind(process)
    process.emitWarning = (warning: string | Error, ...rest: unknown[]): void => {
        const text = typeof warning === "string" ? warning : (warning?.message ?? "")
        const name = readWarningType(rest[0])
        const isExtensionLoad =
            name === "ExtensionLoadWarning" || text.includes("ExtensionLoadWarning")
        if (isExtensionLoad) {
            const unknown = [...text.matchAll(/Permission '([^']+)' is unknown/g)].map((m) => m[1])
            const benign = new Set(["webNavigation", "privacy"])
            if (unknown.length > 0 && unknown.every((permission) => benign.has(permission))) {
                return
            }
        }
        Reflect.apply(original, process, [warning, ...rest])
    }
}
