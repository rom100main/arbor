import { describe, expect, it } from "vite-plus/test"

import { linuxDefaultHandlers, mimeAppsWithDefault } from "../src/main/default-browser"

const DESKTOP = "dev.arbor.app.desktop"

describe("linuxDefaultHandlers", () => {
    it("reads the browser schemes from [Default Applications]", () => {
        const content = [
            "[Default Applications]",
            "x-scheme-handler/http=firefox.desktop",
            "x-scheme-handler/https=firefox.desktop",
            "text/html=firefox.desktop",
            "audio/mpeg=other.desktop",
            "",
            "[Added Associations]",
            "x-scheme-handler/http=other.desktop",
        ].join("\n")
        const handlers = linuxDefaultHandlers(content)
        expect(handlers["x-scheme-handler/http"]).toBe("firefox.desktop")
        expect(handlers["x-scheme-handler/https"]).toBe("firefox.desktop")
        expect(handlers["text/html"]).toBe("firefox.desktop")
        expect(handlers["audio/mpeg"]).toBeUndefined()
    })

    it("takes the first handler of a list and is null for an empty file", () => {
        const handlers = linuxDefaultHandlers(
            "[Default Applications]\ntext/html=a.desktop;b.desktop\n",
        )
        expect(handlers["text/html"]).toBe("a.desktop")
        expect(linuxDefaultHandlers(null)).toEqual({})
        expect(linuxDefaultHandlers("")).toEqual({})
    })
})

describe("mimeAppsWithDefault", () => {
    it("creates the section when there is no file", () => {
        const next = mimeAppsWithDefault(null, DESKTOP)
        expect(next).toContain("[Default Applications]")
        expect(next).toContain(`x-scheme-handler/http=${DESKTOP}`)
        expect(next).toContain(`x-scheme-handler/https=${DESKTOP}`)
    })

    it("puts Arbor first and keeps the previous handlers", () => {
        const next = mimeAppsWithDefault(
            "[Default Applications]\nx-scheme-handler/http=firefox.desktop\ntext/html=other.desktop\n",
            DESKTOP,
        )
        expect(next).toContain(`x-scheme-handler/http=${DESKTOP};firefox.desktop`)
        expect(next).toContain(`x-scheme-handler/https=${DESKTOP}`)
        expect(next).toContain(`text/html=${DESKTOP};other.desktop`)
    })

    it("keeps other sections and cannot duplicate Arbor", () => {
        const content = [
            "[Default Applications]",
            `x-scheme-handler/http=${DESKTOP}`,
            "",
            "[Added Associations]",
            "audio/mpeg=other.desktop",
        ].join("\n")
        const next = mimeAppsWithDefault(content, DESKTOP)
        expect(next).toContain("[Added Associations]")
        expect(next).toContain("audio/mpeg=other.desktop")
        // Three entries (http, https, text/html) mention Arbor once each.
        expect(next.split(DESKTOP)).toHaveLength(4)
        expect(next).not.toContain(`${DESKTOP};${DESKTOP}`)
    })
})
