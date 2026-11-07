import { describe, expect, it } from "vite-plus/test"

import {
    assetRelativePath,
    devAssetUrl,
    injectDocumentHead,
    isAssetRequest,
    isInternalUrl,
    isSettingsUrl,
} from "../src/main/windows/internal-page-urls"
import { settingsRoute } from "../src/renderer/settings/routes"
import { SETTINGS_URL } from "../src/shared/settings"

describe("the settings URL", () => {
    // `arbor:/settings` parses as a scheme with an empty authority, so hostname is "" and
    // nothing recognises the page as internal. The host is load-bearing.
    it("carries a host, so it parses with a hostname", () => {
        expect(SETTINGS_URL).toBe("arbor://settings")
        expect(new URL(SETTINGS_URL).hostname).toBe("settings")
        // The bare URL has no path of its own; routes hang off it.
        expect(new URL(SETTINGS_URL).pathname).toBe("")
        expect(new URL(`${SETTINGS_URL}/search`).pathname).toBe("/search")
    })
})

describe("isInternalUrl", () => {
    it("matches the arbor scheme only", () => {
        expect(isInternalUrl("arbor://settings")).toBe(true)
        expect(isInternalUrl("arbor://settings/appearance")).toBe(true)
        expect(isInternalUrl("https://example.com")).toBe(false)
        expect(isInternalUrl("chrome-extension://abc/page.html")).toBe(false)
    })

    it("rejects a hostless arbor URL", () => {
        // Same scheme, no authority: not a page Arbor can serve.
        expect(isInternalUrl("arbor:/settings")).toBe(false)
    })
})

describe("isSettingsUrl", () => {
    it("matches the settings host with or without a route", () => {
        expect(isSettingsUrl("arbor://settings")).toBe(true)
        expect(isSettingsUrl("arbor://settings/")).toBe(true)
        expect(isSettingsUrl("arbor://settings/search")).toBe(true)
        expect(isSettingsUrl("arbor://settings/assets/app.js")).toBe(true)
    })

    it("rejects another host on the same scheme", () => {
        expect(isSettingsUrl("arbor://other")).toBe(false)
        expect(isSettingsUrl("https://example.com")).toBe(false)
    })
})

describe("settingsRoute", () => {
    it("maps known paths to their section", () => {
        expect(settingsRoute("arbor://settings/search")).toBe("search")
        expect(settingsRoute("arbor://settings/downloads")).toBe("downloads")
        expect(settingsRoute("arbor://settings/appearance")).toBe("appearance")
    })

    it("falls back to search for the root, a trailing slash, or junk", () => {
        expect(settingsRoute("arbor://settings")).toBe("search")
        expect(settingsRoute("arbor://settings/")).toBe("search")
        expect(settingsRoute("arbor://settings/nope")).toBe("search")
        expect(settingsRoute("not a url")).toBe("search")
    })
})

describe("isAssetRequest", () => {
    it("treats everything outside the route table as an asset", () => {
        expect(isAssetRequest("/assets/app-abc123.js")).toBe(true)
        expect(isAssetRequest("/assets/style.css")).toBe(true)
        // A typo'd deep link is served as a file and 404s rather than blanking as HTML.
        expect(isAssetRequest("/searchh")).toBe(true)
    })

    it("treats a known route as a document", () => {
        expect(isAssetRequest("/")).toBe(false)
        expect(isAssetRequest("/search")).toBe(false)
        expect(isAssetRequest("/downloads")).toBe(false)
        expect(isAssetRequest("/appearance")).toBe(false)
    })

    it("treats an extensionless dev-server module as an asset, not a document", () => {
        // "/@vite/client" is a JavaScript module with no file extension. Deciding by
        // extension serves it as HTML and the module script fails, leaving a blank page.
        expect(isAssetRequest("/@vite/client")).toBe(true)
        expect(isAssetRequest("/@id/virtual:entry-client.tsx")).toBe(true)
        expect(isAssetRequest("/node_modules/.vite/deps/@solidjs_web.js")).toBe(true)
    })
})

describe("assetRelativePath", () => {
    it("strips the leading slash", () => {
        expect(assetRelativePath("/assets/app.js")).toBe("assets/app.js")
    })

    it("refuses paths that escape the bundle root", () => {
        expect(assetRelativePath("/../secret")).toBeNull()
        expect(assetRelativePath("/assets/../../secret")).toBeNull()
        expect(assetRelativePath("/")).toBeNull()
        expect(assetRelativePath("")).toBeNull()
    })
})

describe("injectDocumentHead", () => {
    it("injects into an existing head", () => {
        const html = injectDocumentHead("<html><head><meta></head><body></body></html>", "X")
        expect(html).toBe("<html><head>X<meta></head><body></body></html>")
    })

    it("falls back to the body when there is no head", () => {
        expect(injectDocumentHead("<html><body></body></html>", "X")).toBe(
            "<html>X<body></body></html>",
        )
    })

    it("prepends when the document has neither", () => {
        expect(injectDocumentHead("<p>hi</p>", "X")).toBe("X<p>hi</p>")
    })
})

describe("devAssetUrl", () => {
    // The bug this pins: VITE_DEV_SERVER_URL arrives as "http://localhost:5173/", and
    // joining naively yields "//@vite/client". Vite 404s on that, the response carries an
    // error page's MIME type, the module script fails, and the settings page is blank.
    it("normalises a trailing slash from the dev server", () => {
        expect(devAssetUrl("http://localhost:5173/", "@vite/client")).toBe(
            "http://localhost:5173/@vite/client",
        )
    })

    it("tolerates several trailing slashes", () => {
        expect(devAssetUrl("http://localhost:5173///", "a.js")).toBe("http://localhost:5173/a.js")
    })

    it("leaves an origin without a trailing slash alone", () => {
        expect(devAssetUrl("http://localhost:5173", "a.js")).toBe("http://localhost:5173/a.js")
    })

    it("preserves the query string, which changes the response MIME", () => {
        // `icon.svg?import&raw` is a module; the bare path is image/svg+xml.
        expect(devAssetUrl("http://localhost:5173/", "@tabler/x.svg", "?import&raw")).toBe(
            "http://localhost:5173/@tabler/x.svg?import&raw",
        )
    })
})
