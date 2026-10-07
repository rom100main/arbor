import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it } from "vite-plus/test"

import { createSettingsStore, fromPersistedSettings, SettingsError } from "../src/main/settings"
import { DEFAULT_SETTINGS } from "../src/shared/settings"

const tempFile = (): string =>
    path.join(mkdtempSync(path.join(tmpdir(), "arbor-settings-")), "settings.json")

/** Write through a controllable timer so flush behaviour is testable without waiting. */
const manualStore = (filePath: string) => {
    const scheduled: (() => void)[] = []
    let armed = 0
    const store = createSettingsStore(filePath, {
        debounceMs: 10,
        setTimer: (fn) => {
            scheduled.push(fn)
            armed += 1
            return armed
        },
        clearTimer: () => undefined,
    })
    return {
        store,
        armedCount: (): number => armed,
        runScheduled: (): void => {
            for (const fn of scheduled.splice(0)) fn()
        },
    }
}

describe("fromPersistedSettings", () => {
    it("returns null for a payload that is not an object", () => {
        expect(fromPersistedSettings(null)).toBeNull()
        expect(fromPersistedSettings("nope")).toBeNull()
        expect(fromPersistedSettings(7)).toBeNull()
    })

    it("fills in defaults for missing fields", () => {
        expect(fromPersistedSettings({})).toEqual(DEFAULT_SETTINGS)
    })

    it("repairs individual bad fields instead of rejecting the file", () => {
        const restored = fromPersistedSettings({
            searchTemplate: "https://duckduckgo.com/",
            theme: "neon",
            pinnedExtensionIds: ["a", "a", "", 3],
        })
        expect(restored).not.toBeNull()
        expect(restored!.searchTemplate).toBe(DEFAULT_SETTINGS.searchTemplate)
        expect(restored!.theme).toBe("system")
        expect(restored!.pinnedExtensionIds).toEqual(["a"])
    })

    it("keeps a valid file intact", () => {
        const payload = {
            searchTemplate: "https://kagi.com/search?q=%s",
            theme: "dark",
            pinnedExtensionIds: ["ext-a", "ext-b"],
        }
        expect(fromPersistedSettings(payload)).toEqual(payload)
    })
})

describe("settings store", () => {
    it("starts from defaults when there is no file", () => {
        const { store } = manualStore(tempFile())
        expect(store.get()).toEqual(DEFAULT_SETTINGS)
    })

    it("loads what a previous run wrote", () => {
        const filePath = tempFile()
        const { store, runScheduled } = manualStore(filePath)
        store.set({ theme: "dark", searchTemplate: "https://kagi.com/search?q=%s" })
        runScheduled()
        expect(fromPersistedSettings(JSON.parse(readFileSync(filePath, "utf8")))).toEqual({
            theme: "dark",
            searchTemplate: "https://kagi.com/search?q=%s",
            pinnedExtensionIds: [],
        })

        const reloaded = manualStore(filePath).store
        expect(reloaded.get().theme).toBe("dark")
        expect(reloaded.get().searchTemplate).toBe("https://kagi.com/search?q=%s")
    })

    it("normalises a bare-host template on the way in", () => {
        const { store } = manualStore(tempFile())
        expect(store.set({ searchTemplate: "kagi.com/search?q=%s" }).searchTemplate).toBe(
            "https://kagi.com/search?q=%s",
        )
    })

    it("rejects a template with no %s and writes nothing", () => {
        const filePath = tempFile()
        const { store, runScheduled } = manualStore(filePath)
        store.set({ theme: "light" })
        runScheduled()
        const before = JSON.parse(readFileSync(filePath, "utf8"))

        expect(() => store.set({ searchTemplate: "https://duckduckgo.com/" })).toThrow(
            SettingsError,
        )
        expect(store.get().searchTemplate).toBe(DEFAULT_SETTINGS.searchTemplate)
        // Disk still holds what the last accepted write left there.
        expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual(before)
        expect(before.theme).toBe("light")
    })

    // The unknown-theme guard is covered by the repair path above; here the only value that
    // can be type-valid and still be rejected is the template, since it is a free-text string.

    it("notifies subscribers on change and stops after unsubscribe", () => {
        const { store } = manualStore(tempFile())
        const seen: string[] = []
        const stop = store.subscribe((settings) => seen.push(settings.theme))
        store.set({ theme: "dark" })
        stop()
        store.set({ theme: "light" })
        expect(seen).toEqual(["dark"])
    })

    it("pins in order, dedupes, and unpins", () => {
        const { store } = manualStore(tempFile())
        store.pinExtension("ext-bbb")
        store.pinExtension("ext-aaa")
        store.pinExtension("ext-bbb")
        expect(store.get().pinnedExtensionIds).toEqual(["ext-bbb", "ext-aaa"])

        store.unpinExtension("ext-gone")
        expect(store.get().pinnedExtensionIds).toEqual(["ext-bbb", "ext-aaa"])

        store.unpinExtension("ext-bbb")
        expect(store.get().pinnedExtensionIds).toEqual(["ext-aaa"])
    })

    it("does not notify or reschedule when a pin is a no-op", () => {
        const { store, runScheduled, armedCount } = manualStore(tempFile())
        store.pinExtension("ext-aaa")
        runScheduled()
        const armed = armedCount()
        const seen: number[] = []
        store.subscribe(() => seen.push(1))
        store.pinExtension("ext-aaa")
        store.unpinExtension("ext-gone")
        expect(seen).toEqual([])
        expect(armedCount()).toBe(armed)
    })
})

describe("settings flush", () => {
    it("writes pending changes on flush without waiting for the timer", () => {
        const filePath = tempFile()
        const { store } = manualStore(filePath)
        store.set({ theme: "dark" })
        store.flush()
        expect(JSON.parse(readFileSync(filePath, "utf8")).theme).toBe("dark")
    })
})
