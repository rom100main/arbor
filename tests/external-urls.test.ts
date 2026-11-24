import { describe, expect, it } from "vite-plus/test"

import { isBrowserUrl, urlsFromCommandLine } from "../src/main/windows/external-urls"

describe("isBrowserUrl", () => {
    it("accepts http and https URLs with a host", () => {
        expect(isBrowserUrl("https://example.com/a?b=1")).toBe(true)
        expect(isBrowserUrl("http://localhost:3000/x")).toBe(true)
    })

    it("rejects other schemes, hosts and garbage", () => {
        expect(isBrowserUrl("arbor://settings")).toBe(false)
        expect(isBrowserUrl("mailto:a@b.c")).toBe(false)
        expect(isBrowserUrl("https://")).toBe(false)
        expect(isBrowserUrl("not a url")).toBe(false)
        expect(isBrowserUrl("")).toBe(false)
    })
})

describe("urlsFromCommandLine", () => {
    it("keeps browser URLs in order and drops everything else", () => {
        expect(
            urlsFromCommandLine([
                "/Applications/Arbor.app/Contents/MacOS/Arbor",
                "--flag",
                "https://example.com/a",
                "arbor://settings",
                "http://example.org",
            ]),
        ).toEqual(["https://example.com/a", "http://example.org"])
    })

    it("deduplicates repeated URLs and returns nothing for a plain launch", () => {
        expect(urlsFromCommandLine(["https://example.com", "https://example.com"])).toEqual([
            "https://example.com",
        ])
        expect(urlsFromCommandLine(["/usr/bin/arbor", "."])).toEqual([])
    })
})
