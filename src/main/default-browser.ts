/**
 * Make Arbor the OS default browser, and report whether it already is.
 *
 * macOS and Windows go through Electron's `app.setAsDefaultProtocolClient`,
 * which speaks LaunchServices / the Windows registry for the `http` and `https` schemes
 * (the packaged app declares those schemes at build time in electron-builder.yml).
 *
 * Linux has no such API:
 * the default browser lives in the freedesktop `mimeapps.list` (`[Default Applications]`),
 * and `xdg-settings` is the portable way to write it.
 * We update both, best-effort.
 */

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

import { app } from "electron"

export interface DefaultBrowserStatus {
    readonly isDefault: boolean
    readonly platform: NodeJS.Platform
}

const BROWSER_SCHEMES = ["http", "https"] as const

/**
 * Reverse-DNS desktop entry electron-builder installs.
 * Matches `appId` in electron-builder.yml and `desktopName` in package.json,
 * so Electron's app_id, the `.desktop` filename and the mimeapps entry agree.
 */
export const desktopEntryName = (): string => "dev.arbor.app.desktop"

const linuxMimeAppsPath = (): string =>
    path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "mimeapps.list")

/** The default handler for each scheme, from mimeapps.list, or null when unset. */
export const linuxDefaultHandlers = (content: string | null): Record<string, string | null> => {
    const out: Record<string, string | null> = {}
    if (content === null) return out
    let section = ""
    for (const rawLine of content.split("\n")) {
        const line = rawLine.trim()
        if (line.startsWith("[") && line.endsWith("]")) {
            section = line
            continue
        }
        if (section !== "[Default Applications]") continue
        const eq = line.indexOf("=")
        if (eq === -1) continue
        const key = line.slice(0, eq).trim()
        if (
            key === "x-scheme-handler/http" ||
            key === "x-scheme-handler/https" ||
            key === "text/html"
        ) {
            out[key] =
                line
                    .slice(eq + 1)
                    .split(";")[0]
                    .trim() || null
        }
    }
    return out
}

/** mimeapps.list content with Arbor first for the browser schemes, other content kept. */
export const mimeAppsWithDefault = (content: string | null, desktop: string): string => {
    const keys = ["x-scheme-handler/http", "x-scheme-handler/https", "text/html"]
    const lines = content === null ? [] : content.split("\n")
    let inDefault = false
    let insertAt = -1
    const seen = new Set<string>()
    const next: string[] = []
    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i]
        const line = rawLine.trim()
        if (line.startsWith("[") && line.endsWith("]")) {
            inDefault = line === "[Default Applications]"
            if (inDefault && insertAt === -1) insertAt = next.length + 1
            next.push(rawLine)
            continue
        }
        if (inDefault && keys.some((key) => line.startsWith(`${key}=`))) {
            const key = line.slice(0, line.indexOf("=")).trim()
            if (seen.has(key)) continue
            seen.add(key)
            const rest = line
                .slice(line.indexOf("=") + 1)
                .split(";")
                .map((part) => part.trim())
                .filter((part) => part.length > 0 && part !== desktop)
            next.push(`${key}=${[desktop, ...rest].join(";")}`)
            continue
        }
        next.push(rawLine)
    }
    const missing = keys.filter((key) => !seen.has(key))
    if (insertAt === -1) {
        const body = next.join("\n").trim()
        const section = [
            "[Default Applications]",
            ...missing.map((key) => `${key}=${desktop}`),
        ].join("\n")
        return body.length > 0 ? `${body}\n\n${section}\n` : `${section}\n`
    }
    next.splice(insertAt, 0, ...missing.map((key) => `${key}=${desktop}`))
    return next.join("\n").endsWith("\n") ? next.join("\n") : `${next.join("\n")}\n`
}

const isDefaultOnLinux = (): boolean => {
    const file = linuxMimeAppsPath()
    if (!existsSync(file)) return false
    const handlers = linuxDefaultHandlers(readFileSync(file, "utf8"))
    const desktop = desktopEntryName()
    return (
        handlers["x-scheme-handler/http"] === desktop &&
        handlers["x-scheme-handler/https"] === desktop
    )
}

const setDefaultOnLinux = (): boolean => {
    const file = linuxMimeAppsPath()
    mkdirSync(path.dirname(file), { recursive: true })
    const existing = existsSync(file) ? readFileSync(file, "utf8") : null
    writeFileSync(file, mimeAppsWithDefault(existing, desktopEntryName()))
    try {
        execFileSync("xdg-settings", ["set", "default-web-browser", desktopEntryName()], {
            stdio: "ignore",
        })
    } catch {
        // mimeapps.list is the source of truth; xdg-settings is best-effort.
    }
    return isDefaultOnLinux()
}

/** Whether Arbor is currently the default browser for http and https. */
export const getDefaultBrowserStatus = (): DefaultBrowserStatus => {
    const platform = process.platform
    const isDefault =
        platform === "linux"
            ? isDefaultOnLinux()
            : BROWSER_SCHEMES.every((scheme) => app.isDefaultProtocolClient(scheme))
    return { isDefault, platform }
}

/**
 * Register Arbor as the default http(s) handler.
 * Returns whether the OS accepted it and the check passes,
 * or false when registration failed.
 */
export const setDefaultBrowser = (): boolean => {
    if (process.platform === "linux") return setDefaultOnLinux()
    const ok = BROWSER_SCHEMES.every((scheme) => app.setAsDefaultProtocolClient(scheme))
    return ok && getDefaultBrowserStatus().isDefault
}
