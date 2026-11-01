import { readdirSync } from "node:fs"
import path from "node:path"

import { Effect } from "effect"
import { app, nativeImage, session } from "electron"

import type { PinnedActionInfo } from "../../shared/protocol"
import { readJsonLenient } from "../persistence/json-file"
import { parseManifest, type ParsedManifest } from "./manifest"

const ICON_SIZE = 32

/**
 * Installed extension root: `<userData>/Extensions/<id>/<version>`.
 *
 * Electron's extension API does not expose extensions restored from its enabled set,
 * so the install directory is the reliable source for the manifest and its files.
 * The session API is still preferred where it works, since it covers extensions loaded this run.
 */
const installedRoot = (extensionId: string): string | null => {
    const root = path.join(app.getPath("userData"), "Extensions", extensionId)
    let versions: string[]
    try {
        versions = readdirSync(root)
    } catch {
        return null
    }
    // Highest version first, matching how Chromium picks a version directory.
    for (const version of versions.sort().reverse()) {
        const dir = path.join(root, version)
        try {
            if (readdirSync(dir).length > 0) return dir
        } catch {
            // Unreadable version directory: try the next one.
        }
    }
    return null
}

export const manifestFor = (extensionId: string): ParsedManifest | null => {
    const extension = session.defaultSession.extensions?.getExtension(extensionId)
    if (extension) return parseManifest(extension.manifest)
    const root = installedRoot(extensionId)
    if (!root) return null
    return parseManifest(readJsonLenient(path.join(root, "manifest.json")))
}

/**
 * Best icon file for `size`, from either manifest shape: a bare path, or a size-keyed map.
 *
 * Sizes are matched the way Chromium does: exact, then the smallest size at or above the request,
 * then the largest available, so a manifest offering only 48 still renders at 16.
 */
export const iconPathFor = (
    root: string,
    spec: string | Record<string, string>,
    size: number,
): string | null => {
    const candidates =
        typeof spec === "string" ? [spec] : Object.entries(spec).map(([k, v]) => [k, v] as const)
    if (typeof spec !== "string") {
        const sized = candidates
            .map(([key, value]) => ({ key: Number.parseInt(key, 10), value }))
            .filter((entry) => Number.isFinite(entry.key))
            .sort((a, b) => a.key - b.key)
        if (sized.length === 0) return null
        const exact = sized.find((entry) => entry.key === size)
        const larger = sized.find((entry) => entry.key > size)
        const chosen = exact ?? larger ?? sized[sized.length - 1]
        return resolveIcon(root, chosen.value)
    }
    return resolveIcon(root, spec)
}

/**
 * Keep the path inside the extension root: a manifest should not be able to read elsewhere.
 *
 * Leading slashes are stripped first, because manifests commonly write extension-relative paths as `/assets/icon.png`.
 * Resolving those against the root would otherwise escape it.
 */
export const resolveIcon = (root: string, relative: string): string | null => {
    const full = path.resolve(root, relative.replace(/^[/\\]+/, ""))
    const base = path.resolve(root)
    if (full !== base && !full.startsWith(base + path.sep)) return null
    return full
}

const EMPTY: PinnedActionInfo = { extensionId: "", title: "", iconDataUrl: null, popupUrl: null }

export interface ActionInfo {
    /** What the toolbar shows for an extension's action: title, icon, popup. */
    readonly info: (extensionId: string) => Effect.Effect<PinnedActionInfo>
    /** Drop its cached icon, so a reinstall or update is picked up. */
    readonly forget: (extensionId: string) => void
}

/** Action info with its own icon cache: decoding an icon is not done again on every render. */
export const makeActionInfo = (): ActionInfo => {
    const iconCache = new Map<string, string | null>()

    const iconDataUrl = (
        root: string,
        spec: string | Record<string, string> | null,
    ): Effect.Effect<string | null> =>
        Effect.suspend(() => {
            const file = spec ? iconPathFor(root, spec, ICON_SIZE) : null
            if (!file) return Effect.succeed(null)
            const cached = iconCache.get(file)
            if (cached !== undefined) return Effect.succeed(cached)
            return Effect.try(() => {
                const image = nativeImage.createFromPath(file)
                return image.isEmpty() ? null : image.resize({ width: ICON_SIZE }).toDataURL()
            }).pipe(
                Effect.catchCause((cause) =>
                    Effect.as(
                        Effect.logError(`Failed to read extension icon ${file}`, cause),
                        null,
                    ),
                ),
                Effect.tap((dataUrl) => Effect.sync(() => iconCache.set(file, dataUrl))),
            )
        })

    return {
        info: (extensionId) =>
            Effect.suspend(() => {
                const manifest = manifestFor(extensionId)
                if (!manifest) return Effect.succeed({ ...EMPTY, extensionId })
                const root = installedRoot(extensionId)
                return Effect.map(
                    root ? iconDataUrl(root, manifest.actionIcon) : Effect.succeed(null),
                    (dataUrl) => ({
                        extensionId,
                        title: manifest.actionTitle || extensionId,
                        iconDataUrl: dataUrl,
                        popupUrl: manifest.actionPopup
                            ? `chrome-extension://${extensionId}/${manifest.actionPopup.replace(/^\/+/, "")}`
                            : null,
                    }),
                )
            }),
        forget: (extensionId) => {
            for (const key of iconCache.keys()) {
                if (key.includes(`${path.sep}${extensionId}${path.sep}`)) iconCache.delete(key)
            }
        },
    }
}
