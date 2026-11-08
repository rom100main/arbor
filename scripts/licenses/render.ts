import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { getProjectLicenses, type ILicense } from "generate-license-file"

import { renderBundledAssets } from "./assets.ts"

export const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

interface LockPackage {
    version?: string
    dependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null
}

function isStringRecord(value: unknown): value is Record<string, string> {
    return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string")
}

function splitDependency(dependency: string): [string, string] {
    const at = dependency.lastIndexOf("@")
    if (at <= 0) return [dependency, ""]
    return [dependency.slice(0, at), dependency.slice(at + 1)]
}

function firstLine(content: string): string | undefined {
    return content
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0)
}

// Keep generated notices ordered identically across locales and CI runners.
function compareStrings(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0
}

function shortTitle(content: string): string {
    const title = (firstLine(content) ?? "License")
        .replace(/^#+\s*/, "")
        .replace(/\s+/g, " ")
        .trim()
    if (!title) return "License"
    return title.length > 80 ? `${title.slice(0, 77).trimEnd()}...` : title
}

function normalizeLicenseText(content: string): string {
    return content
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t]+$/gm, "")
        .trim()
}

function packageNameOf(lockPath: string): string {
    const marker = "node_modules/"
    const segments = lockPath.slice(lockPath.lastIndexOf(marker) + marker.length).split("/")
    const name = segments[0] ?? ""
    return name.startsWith("@") ? `${name}/${segments[1] ?? ""}` : name
}

/** Resolve a dependency the way Node does: nearest `node_modules` first, then ancestors. */
function resolvePackage(
    packages: Record<string, LockPackage>,
    from: string,
    name: string,
): string | undefined {
    let base = from
    while (true) {
        const candidate = base ? `${base}/node_modules/${name}` : `node_modules/${name}`
        if (packages[candidate]) return candidate
        if (!base) return undefined
        const index = base.lastIndexOf("/node_modules/")
        base = index === -1 ? "" : base.slice(0, index)
    }
}

async function readLockPackages(): Promise<Record<string, LockPackage>> {
    const raw: unknown = JSON.parse(
        await readFile(path.join(siteRoot, "package-lock.json"), "utf-8"),
    )
    if (!isRecord(raw) || !isRecord(raw.packages)) {
        throw new Error("package-lock.json has no packages map")
    }

    const packages: Record<string, LockPackage> = {}
    for (const [lockPath, entry] of Object.entries(raw.packages)) {
        if (!isRecord(entry)) continue
        packages[lockPath] = {
            version: typeof entry.version === "string" ? entry.version : undefined,
            dependencies: isStringRecord(entry.dependencies) ? entry.dependencies : undefined,
            optionalDependencies: isStringRecord(entry.optionalDependencies)
                ? entry.optionalDependencies
                : undefined,
        }
    }
    return packages
}

/**
 * Every `name@version` in Arbor's production dependency closure.
 *
 * Derived from `package-lock.json` rather than the installed tree so the
 * generated notices are identical on every OS and CI runner. Type-only
 * `@types/*` packages are not distributed and are left out.
 */
async function productionPackages(): Promise<Set<string>> {
    const packages = await readLockPackages()
    const root = packages[""]
    if (!root) throw new Error("package-lock.json has no root package")

    const included = new Set<string>()
    const seen = new Set<string>()
    const queue: Array<{ name: string; from: string; optional: boolean }> = Object.entries(
        root.dependencies ?? {},
    ).map(([name]) => ({ name, from: "", optional: false }))

    while (queue.length > 0) {
        const { name, from, optional } = queue.pop()!
        const lockPath = resolvePackage(packages, from, name)
        if (!lockPath) {
            if (optional) continue
            throw new Error(`package-lock.json is missing ${name} required by ${from || "Arbor"}`)
        }
        if (seen.has(lockPath)) continue
        seen.add(lockPath)

        const entry = packages[lockPath]
        if (entry.version) {
            const packageName = packageNameOf(lockPath)
            if (!packageName.startsWith("@types/")) included.add(`${packageName}@${entry.version}`)
        }
        for (const dependency of Object.keys(entry.dependencies ?? {})) {
            queue.push({ name: dependency, from: lockPath, optional: false })
        }
        for (const dependency of Object.keys(entry.optionalDependencies ?? {})) {
            queue.push({ name: dependency, from: lockPath, optional: true })
        }
    }

    return included
}

function renderLicense(license: ILicense): string[] {
    const lines: string[] = [`### ${shortTitle(license.content)}`]
    lines.push("")
    lines.push("Used by:")
    lines.push("")
    for (const dependency of [...license.dependencies].sort((a, b) => {
        const [nameA, versionA] = splitDependency(a)
        const [nameB, versionB] = splitDependency(b)
        return compareStrings(nameA, nameB) || compareStrings(versionA, versionB)
    })) {
        const [name, version] = splitDependency(dependency)
        lines.push(version ? `- \`${name}\` ${version}` : `- \`${name}\``)
    }
    lines.push("")
    lines.push("```")
    lines.push(normalizeLicenseText(license.content))
    if (license.notices.length > 0) {
        lines.push("")
        lines.push("With the following notices:")
        lines.push("")
        for (const notice of license.notices) {
            lines.push(normalizeLicenseText(notice))
        }
    }
    lines.push("```")
    lines.push("")
    return lines
}

async function renderNpmDependencies(): Promise<string> {
    const licenses = await getProjectLicenses(path.join(siteRoot, "package.json"))
    const included = await productionPackages()
    const ordered = licenses
        .map((license) => ({
            ...license,
            dependencies: license.dependencies.filter((dependency) => included.has(dependency)),
        }))
        .filter((license) => license.dependencies.length > 0)
        .sort(
            (a, b) =>
                compareStrings(normalizeLicenseText(a.content), normalizeLicenseText(b.content)) ||
                compareStrings(
                    [...a.dependencies].sort(compareStrings)[0] ?? "",
                    [...b.dependencies].sort(compareStrings)[0] ?? "",
                ),
        )

    const covered = new Set(ordered.flatMap((license) => license.dependencies))
    const missing = [...included].filter((dependency) => !covered.has(dependency)).sort()
    if (missing.length > 0) {
        throw new Error(
            `no license found for production dependencies: ${missing.join(", ")} (run npm install)`,
        )
    }

    const lines: string[] = [
        "## npm dependencies",
        "",
        "This section lists the npm packages in Arbor's production dependency",
        "closure, and the license under which each is distributed. The package",
        "set is derived from `package-lock.json`; type-only `@types/*` packages",
        "are not distributed and are excluded. License texts come from the",
        "installed `node_modules` tree via the `generate-license-file` npm package",
        "(https://www.npmjs.com/package/generate-license-file); do not edit this",
        "section by hand.",
        "",
    ]

    for (const license of ordered) {
        lines.push(...renderLicense(license))
    }

    return lines.join("\n")
}

export async function renderNotices(): Promise<string> {
    const intro = await readFile(
        path.join(siteRoot, "scripts", "licenses", "notices-intro.md"),
        "utf-8",
    )

    const bundledAssets = await renderBundledAssets(siteRoot)
    const npmDependencies = await renderNpmDependencies()

    return `${intro.replace(/\r\n?/g, "\n").trim()}\n\n${bundledAssets}\n\n${npmDependencies}`
}
