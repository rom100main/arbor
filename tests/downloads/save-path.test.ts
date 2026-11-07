import path from "node:path"

import { describe, expect, it } from "vite-plus/test"

import { sanitizeFilename, uniqueSavePath } from "../../src/main/downloads/save-path"

describe("sanitizeFilename", () => {
    it("keeps a normal name", () => {
        expect(sanitizeFilename("report.pdf")).toBe("report.pdf")
    })

    it("strips directory parts from either separator", () => {
        expect(sanitizeFilename("../../etc/passwd")).toBe("passwd")
        expect(sanitizeFilename("..\\..\\secret.txt")).toBe("secret.txt")
    })

    it("strips control characters", () => {
        expect(sanitizeFilename("a\u0000b\u001fc\u007fd.txt")).toBe("abcd.txt")
    })

    it("strips leading dots and surrounding spaces", () => {
        expect(sanitizeFilename(".hidden")).toBe("hidden")
        expect(sanitizeFilename("  report.pdf  ")).toBe("report.pdf")
    })

    it("falls back to download when nothing usable remains", () => {
        for (const input of ["", ".", "..", "/", "\\"]) {
            expect(sanitizeFilename(input)).toBe("download")
        }
    })
})

describe("uniqueSavePath", () => {
    const dir = "/Downloads"
    const taken = (...names: string[]): ((candidate: string) => boolean) => {
        const files = new Set(names.map((name) => path.join(dir, name)))
        return (candidate) => files.has(candidate)
    }

    it("returns the plain path when it is free", () => {
        expect(uniqueSavePath(dir, "a.txt", taken())).toBe(path.join(dir, "a.txt"))
    })

    it("numbers the name until a free path is found", () => {
        const exists = taken("a.txt", "a (1).txt")
        expect(uniqueSavePath(dir, "a.txt", exists)).toBe(path.join(dir, "a (2).txt"))
    })

    it("keeps only the last extension", () => {
        expect(uniqueSavePath(dir, "archive.tar.gz", taken("archive.tar.gz"))).toBe(
            path.join(dir, "archive.tar (1).gz"),
        )
    })

    it("appends the number after a name with no extension", () => {
        expect(uniqueSavePath(dir, "README", taken("README"))).toBe(path.join(dir, "README (1)"))
    })
})
