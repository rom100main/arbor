// Generates src/renderer/ui/Icon.tsx from src/renderer/ui/icons.json.
//
// Run manually with `vp run build:icons`. Also auto-runs through the arbor-icons
// Vite plugin in vite.config.ts on `vp dev` / `vp build`.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
export const ICONS_JSON = resolve(root, "src/renderer/ui/icons.json")
export const ICON_TSX = resolve(root, "src/renderer/ui/Icon.tsx")

const toVarName = (name: string): string =>
    name
        .split("-")
        .map((part, index) => (index === 0 ? part : part[0].toUpperCase() + part.slice(1)))
        .join("")

const loadIconNames = (): string[] => {
    const raw = JSON.parse(readFileSync(ICONS_JSON, "utf8")) as unknown
    if (!Array.isArray(raw) || !raw.every((entry): entry is string => typeof entry === "string")) {
        throw new Error(`Invalid ${ICONS_JSON}: expected a JSON array of strings`)
    }
    const names = [...raw].sort()
    const seenVars = new Map<string, string>()
    for (const name of names) {
        if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
            throw new Error(`Invalid icon name "${name}": use kebab-case`)
        }
        const variable = toVarName(name)
        const clash = seenVars.get(variable)
        if (clash !== undefined) {
            throw new Error(
                `Icon names "${clash}" and "${name}" map to the same variable "${variable}"`,
            )
        }
        seenVars.set(variable, name)
        // The `@tabler/icons/outline/*` subpath maps to `icons/outline/*` on
        // disk via the package's `exports` map (`"./*": ["./icons/*"]`).
        const svgPath = resolve(root, "node_modules/@tabler/icons/icons/outline", `${name}.svg`)
        if (!existsSync(svgPath)) {
            throw new Error(`Missing Tabler SVG for "${name}": ${svgPath} not found`)
        }
    }
    return names
}

const render = (names: string[]): string => {
    const imports = names
        .map((name) => `import ${toVarName(name)} from "@tabler/icons/outline/${name}.svg?raw"`)
        .join("\n")
    const entries = names
        .map((name) => {
            const variable = toVarName(name)
            return variable === name ? `    ${variable},` : `    "${name}": ${variable},`
        })
        .join("\n")
    return `// GENERATED - do not edit by hand. Source: src/renderer/ui/icons.json.
// Regenerate with \`vp run build:icons\` (also auto-runs in \`vp dev\` / \`vp build\`).
import type { JSX } from "@solidjs/web"
${imports}
import { Show, createMemo, type Component } from "solid-js"

const icons = {
${entries}
} as const

export type IconName = keyof typeof icons

export interface IconProps {
    name: IconName
    size?: number
    stroke?: number
    class?: string
    style?: JSX.CSSProperties
}

export const Icon: Component<IconProps> = (props) => {
    const svg = createMemo(() => {
        const raw = icons[props.name]
        const size = props.size ?? 16
        const stroke = props.stroke ?? 2
        return raw
            .replace('width="24"', \`width="\${size}"\`)
            .replace('height="24"', \`height="\${size}"\`)
            .replace('stroke-width="2"', \`stroke-width="\${stroke}"\`)
    })

    return (
        <Show when={svg()}>
            <span
                class={props.class}
                style={{ display: "inline-flex", ...props.style }}
                innerHTML={svg()}
            />
        </Show>
    )
}
`
}

export const generateIcons = (): void => {
    const next = render(loadIconNames())
    // Skip the write when nothing changed so watchers don't loop.
    const prev = existsSync(ICON_TSX) ? readFileSync(ICON_TSX, "utf8") : null
    if (prev !== next) writeFileSync(ICON_TSX, next)
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/build-icons.ts") ?? false) {
    generateIcons()
}
