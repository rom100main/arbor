import solid from "@solidjs/vite-plugin"
import electron from "vite-plugin-electron/simple"
import { defineConfig } from "vite-plus"

export default defineConfig({
    base: "./",
    build: {
        outDir: "dist/client",
        rollupOptions: { input: "src/renderer/App.tsx" },
        emptyOutDir: true,
    },
    test: { include: ["tests/**/*.test.ts"], environment: "node" },
    plugins: [
        solid({ start: { app: "src/renderer/App.tsx" } }),
        electron({
            main: {
                entry: "src/main/index.ts",
                vite: { build: { outDir: "dist/electron/main", emptyOutDir: true } },
            },
            preload: {
                input: "src/preload/index.ts",
                vite: {
                    build: {
                        outDir: "dist/electron/preload",
                        emptyOutDir: true,
                        rollupOptions: {
                            output: [{ format: "cjs", entryFileNames: "[name].cjs" }],
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
