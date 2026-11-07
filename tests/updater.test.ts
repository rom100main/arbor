import { describe, expect, it } from "vite-plus/test"

import { IDLE, nextStatus, shouldCheck, type UpdaterEvent } from "../src/main/update/updater"
import type { UpdateStatus } from "../src/shared/protocol"

/** Feed events in order, as electron-updater would. */
const play = (events: UpdaterEvent[], canInstall = true): UpdateStatus =>
    events.reduce((status, event) => nextStatus(status, event, canInstall), IDLE)

describe("nextStatus", () => {
    it("downloads a found update, then is ready to install it", () => {
        expect(play([{ kind: "available", version: "0.2.0" }])).toEqual({
            kind: "downloading",
            percent: 0,
        })
        expect(
            play([
                { kind: "available", version: "0.2.0" },
                { kind: "progress", percent: 42.7 },
            ]),
        ).toEqual({ kind: "downloading", percent: 42 })
        expect(
            play([
                { kind: "available", version: "0.2.0" },
                { kind: "progress", percent: 99 },
                { kind: "downloaded", version: "0.2.0" },
            ]),
        ).toEqual({ kind: "ready", version: "0.2.0" })
    })

    it("links to the release where the build cannot install itself", () => {
        expect(play([{ kind: "available", version: "0.2.0" }], false)).toEqual({
            kind: "manual",
            version: "0.2.0",
            url: "https://github.com/rom100main/arbor/releases/tag/v0.2.0",
        })
    })

    it("keeps the same status when progress stays on the same percent, so nothing is pushed", () => {
        const downloading: UpdateStatus = { kind: "downloading", percent: 10 }
        expect(nextStatus(downloading, { kind: "progress", percent: 10.9 }, true)).toBe(downloading)
    })

    it("ignores progress outside a download", () => {
        expect(nextStatus(IDLE, { kind: "progress", percent: 50 }, true)).toBe(IDLE)
    })

    it("drops a failed download, and keeps an update already found", () => {
        expect(play([{ kind: "available", version: "0.2.0" }, { kind: "failed" }])).toEqual(IDLE)
        const ready: UpdateStatus = { kind: "ready", version: "0.2.0" }
        expect(nextStatus(ready, { kind: "failed" }, true)).toBe(ready)
        expect(nextStatus(IDLE, { kind: "failed" }, true)).toBe(IDLE)
    })
})

describe("shouldCheck", () => {
    it("checks only while no update is under way", () => {
        expect(shouldCheck(IDLE)).toBe(true)
        expect(shouldCheck({ kind: "downloading", percent: 5 })).toBe(false)
        expect(shouldCheck({ kind: "ready", version: "0.2.0" })).toBe(false)
        expect(shouldCheck({ kind: "manual", version: "0.2.0", url: "https://example.com" })).toBe(
            false,
        )
    })
})
