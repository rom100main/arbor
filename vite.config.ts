import solid from "@solidjs/vite-plugin"
import electron from "vite-plugin-electron/simple"
import type { Plugin } from "vite-plus"
import { defineConfig } from "vite-plus"

import { ICONS_JSON, generateIcons } from "./scripts/build-icons.ts"

// Regenerates src/renderer/common/Icon/Icon.tsx from icons.json on dev/build startup,
// and re-runs when icons.json changes during `vp dev`.
const iconsPlugin: Plugin = {
    name: "arbor-icons",
    buildStart: (): void => {
        generateIcons()
    },
    configureServer: (server): void => {
        server.watcher.add(ICONS_JSON)
    },
    handleHotUpdate: ({ file }): void => {
        if (file.replace(/\\/g, "/").endsWith("src/renderer/common/Icon/icons.json"))
            generateIcons()
    },
}

// electron-chrome-extensions hardcodes roundedCorners:
// false for action popup windows;
// the option is creation-only,
// so patch it during the main process build instead.
const roundedCrxPopups: Plugin = {
    name: "arbor-crx-rounded-popups",
    transform(code, id) {
        if (id.includes("electron-chrome-extensions") && code.includes("roundedCorners: false")) {
            return code.replaceAll("roundedCorners: false", "roundedCorners: true")
        }
        return null
    },
}

// electron-chrome-web-store starts workers with a scope missing the trailing slash  (`chrome-extension://<id>`),
// which startWorkerForScope always rejects.
// Patch the scope literal so the library's own start attempt succeeds,
// and drop its single-try failure log (transient, Arbor retries and logs real ones).
const webStoreWorkerScope: Plugin = {
    name: "arbor-web-store-worker-scope",
    transform(code, id) {
        if (id.includes("electron-chrome-web-store") && code.includes("startWorkerForScope")) {
            return code
                .replaceAll(
                    "`chrome-extension://${extension.id}`",
                    "`chrome-extension://${extension.id}/`",
                )
                .replaceAll(
                    "console.error(`Failed to start worker for extension ${extension.id}`)",
                    "void 0",
                )
        }
        return null
    },
}

export default defineConfig({
    base: "./",
    build: {
        outDir: "dist/client",
        rollupOptions: { input: "src/renderer/App.tsx" },
        emptyOutDir: true,
    },
    test: { include: ["tests/**/*.test.ts"], environment: "node" },
    plugins: [
        iconsPlugin,
        solid({ start: { app: "src/renderer/App.tsx" } }),
        electron({
            main: {
                // Dev startup without `--no-sandbox`:
                // Electron skips session-registered preload scripts
                // (extension SW preloads, MV3 shim) under that flag.
                onstart: ({ startup }) => void startup(["."]),
                entry: "src/main/index.ts",
                vite: {
                    build: { outDir: "dist/electron/main", emptyOutDir: true },
                    plugins: [roundedCrxPopups, webStoreWorkerScope],
                },
            },
            preload: {
                input: {
                    index: "src/preload/index.ts",
                    "extension-shim": "src/preload/extension/shim.ts",
                    "extension-storage-shim": "src/preload/extension/storage-shim.ts",
                },
                vite: {
                    build: {
                        outDir: "dist/electron/preload",
                        emptyOutDir: true,
                        rollupOptions: {
                            output: {
                                format: "cjs",
                                entryFileNames: "[name].cjs",
                                codeSplitting: true,
                            },
                        },
                    },
                },
            },
        }),
    ],
    fmt: {
        printWidth: 100,
        useTabs: false,
        tabWidth: 4,
        singleQuote: false,
        semi: false,
        trailingComma: "all",
        arrowParens: "always",
        sortPackageJson: false,
        ignorePatterns: ["temp", "THIRD-PARTY-NOTICES.md"],
        sortImports: {
            newlinesBetween: true,
        },
    },
    lint: {
        ignorePatterns: ["temp"],
        plugins: ["typescript", "import", "promise"],
        categories: { correctness: "error", perf: "error", suspicious: "error" },
        jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
        rules: {
            "vite-plus/prefer-vite-plus-imports": "error",
            eqeqeq: ["error", "smart"],
            "no-unused-vars": ["error", { ignoreRestSiblings: true }],
            "no-var": "error",
            "prefer-const": "error",
            "prefer-template": "error",
            "promise/prefer-await-to-then": "error",
            "typescript/consistent-type-imports": "error",
            "typescript/consistent-type-exports": "error",
            "import/no-duplicates": "error",
            "import/no-cycle": "error",
            "import/no-unassigned-import": ["error", { allow: ["**/*.css"] }],
        },
        options: { typeAware: true, typeCheck: true, denyWarnings: true },
    },
})
