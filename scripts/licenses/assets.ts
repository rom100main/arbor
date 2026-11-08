/* oxlint-disable no-await-in-loop */
import { readFile } from "node:fs/promises"
import path from "node:path"

interface BundledAssetJson {
    id: string
    kind: string
    name: string
    author?: string
    copyright?: string
    source?: string
    revision?: string
    license: string
    license_file: string
    license_evidence?: string
}

interface AssetsManifest {
    assets: BundledAssetJson[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null
}

function optionalString(value: unknown, field: string, manifestPath: string): string | undefined {
    if (value === undefined) return undefined
    if (typeof value !== "string") {
        throw new Error(`${manifestPath}: asset.${field} must be a string`)
    }
    return value
}

function parseAsset(raw: unknown, manifestPath: string): BundledAssetJson {
    if (!isRecord(raw)) throw new Error(`invalid asset entry in ${manifestPath}`)
    const {
        id,
        kind,
        name,
        author,
        copyright,
        source,
        revision,
        license,
        license_file,
        license_evidence,
    } = raw
    if (
        typeof id !== "string" ||
        typeof kind !== "string" ||
        typeof name !== "string" ||
        typeof license !== "string" ||
        typeof license_file !== "string"
    ) {
        throw new Error(`${manifestPath}: asset is missing a required string field`)
    }
    return {
        id,
        kind,
        name,
        license,
        license_file,
        author: optionalString(author, "author", manifestPath),
        copyright: optionalString(copyright, "copyright", manifestPath),
        source: optionalString(source, "source", manifestPath),
        revision: optionalString(revision, "revision", manifestPath),
        license_evidence: optionalString(license_evidence, "license_evidence", manifestPath),
    }
}

export interface BundledAsset {
    id: string
    kind: string
    name: string
    author?: string
    copyright?: string
    source?: string
    revision?: string
    license: string
    licenseFile: string
    licenseEvidence?: string
}

async function loadAssets(siteRoot: string): Promise<BundledAsset[]> {
    const manifestPath = path.join(siteRoot, "scripts", "licenses", "assets.json")
    const raw: unknown = JSON.parse(await readFile(manifestPath, "utf-8"))
    if (!isRecord(raw) || !Array.isArray(raw.assets)) {
        throw new Error(`invalid assets manifest: ${manifestPath}`)
    }
    const manifest: AssetsManifest = {
        assets: raw.assets.map((entry) => parseAsset(entry, manifestPath)),
    }
    return manifest.assets.map(
        ({ license_file: licenseFile, license_evidence: licenseEvidence, ...rest }) => ({
            ...rest,
            licenseFile,
            licenseEvidence,
        }),
    )
}

async function readLicenseText(siteRoot: string, relative: string): Promise<string> {
    let content: string
    try {
        content = await readFile(path.join(siteRoot, relative), "utf-8")
    } catch {
        throw new Error(`missing asset license file: ${relative}`)
    }
    if (!content.trim()) {
        throw new Error(`empty asset license file: ${relative}`)
    }
    return content
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t]+$/gm, "")
        .replace(/\n+$/, "")
}

export async function renderBundledAssets(siteRoot: string): Promise<string> {
    const ordered = (await loadAssets(siteRoot)).sort((a, b) => a.id.localeCompare(b.id))
    const lines: string[] = [
        "## Bundled assets",
        "",
        "This section lists non-npm assets distributed with Arbor. It",
        "is generated from `scripts/licenses/assets.json`; do not edit it by hand.",
        "",
    ]

    for (const asset of ordered) {
        lines.push(`### ${asset.name}`)
        lines.push("")
        lines.push(`- Identifier: \`${asset.id}\``)
        lines.push(`- Kind: ${asset.kind}`)
        if (asset.author) {
            lines.push(`- Author: ${asset.author}`)
        }
        if (asset.copyright) {
            lines.push(`- Copyright: ${asset.copyright}`)
        }
        lines.push(`- License: ${asset.license}`)
        if (asset.source) {
            lines.push(`- Source: ${asset.source}`)
            if (asset.revision) {
                lines.push(`- Revision: ${asset.revision}`)
            }
        } else {
            lines.push("- Source: first-party (Arbor)")
        }
        lines.push(`- License text: ${asset.licenseFile}`)
        if (asset.licenseEvidence) {
            lines.push(`- License evidence: ${asset.licenseEvidence}`)
        }
        lines.push("")
    }

    const texts: Record<string, string[]> = {}
    for (const asset of ordered) {
        const names = (texts[asset.licenseFile] ??= [])
        names.push(asset.name)
    }

    lines.push("## Bundled asset license texts")
    lines.push("")
    lines.push(
        "The following license texts are reproduced in full for the bundled assets listed above.",
    )
    lines.push("")
    for (const [licenseFile, names] of Object.entries(texts)) {
        lines.push(`### ${licenseFile}`)
        lines.push("")
        lines.push(`Used by: ${names.join(", ")}`)
        lines.push("")
        lines.push("```")
        lines.push(await readLicenseText(siteRoot, licenseFile))
        lines.push("```")
        lines.push("")
    }

    return lines.join("\n")
}
