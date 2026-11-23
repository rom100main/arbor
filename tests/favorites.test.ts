import { Context, Effect, Layer, Scope } from "effect"
import { beforeEach, describe, expect, it, vi } from "vite-plus/test"

import { decodeFavorites, subtreeIds } from "../src/main/favorites/favorites"
import { Favorites } from "../src/main/favorites/service"
import { NEW_TAB_FAVORITES_FOLDER_ID } from "../src/shared/constants"
import type { FavoriteNode } from "../src/shared/protocol"
import { runTest, settle } from "./support/effect"
import { files } from "./support/memory-fs"

vi.mock("node:fs", () => import("./support/memory-fs"))
beforeEach(() => files.clear())

const FAVORITES = "/data/favorites.json"

const node = (overrides: Partial<FavoriteNode> = {}): FavoriteNode => ({
    id: "favorite-1",
    parentId: null,
    order: 0,
    name: "Example",
    url: "https://example.com/",
    favicon: null,
    ...overrides,
})

const open = (favoritesPath = FAVORITES) =>
    Effect.gen(function* () {
        const scope = yield* Scope.make()
        const context = yield* Layer.buildWithScope(Favorites.layer({ favoritesPath }), scope)
        return { favorites: Context.get(context, Favorites), scope }
    })

describe("decodeFavorites", () => {
    it("always includes the protected new-tab folder", () => {
        const decoded = decodeFavorites([])
        expect(decoded?.map((n) => n.id)).toEqual([NEW_TAB_FAVORITES_FOLDER_ID])
        expect(decoded?.[0]).toMatchObject({ parentId: null, url: null, name: "New Tab" })
    })

    it("keeps valid nodes, drops bad and duplicate ids", () => {
        const decoded = decodeFavorites([
            node(),
            node(),
            node({ id: "favorite-2", parentId: "favorite-missing" }),
            { nope: true },
        ])
        expect(decoded?.map((n) => n.id)).toEqual(["favorite-newtab", "favorite-1", "favorite-2"])
    })

    it("keeps children of the protected folder", () => {
        const decoded = decodeFavorites([
            node({ id: "favorite-2", parentId: NEW_TAB_FAVORITES_FOLDER_ID }),
        ])
        expect(decoded?.find((n) => n.id === "favorite-2")?.parentId).toBe(
            NEW_TAB_FAVORITES_FOLDER_ID,
        )
    })

    it("forces a stored protected entry back to a root folder", () => {
        const decoded = decodeFavorites([
            node({
                id: NEW_TAB_FAVORITES_FOLDER_ID,
                parentId: "favorite-1",
                name: "Tampered",
                url: "https://nope.test/",
            }),
            node(),
        ])
        expect(decoded?.find((n) => n.id === NEW_TAB_FAVORITES_FOLDER_ID)).toMatchObject({
            parentId: null,
            name: "New Tab",
            url: null,
        })
    })

    it("reparents children of bookmarks to the root", () => {
        const decoded = decodeFavorites([
            node(),
            node({
                id: "favorite-2",
                parentId: "favorite-1",
                url: "https://child.test/",
            }),
        ])
        expect(decoded?.find((n) => n.id === "favorite-2")?.parentId).toBeNull()
    })

    it("breaks parent cycles to the root", () => {
        const decoded = decodeFavorites([
            node({ id: "favorite-a", parentId: "favorite-b", url: null }),
            node({ id: "favorite-b", parentId: "favorite-a", url: null }),
        ])
        expect(decoded?.some((n) => n.parentId === null)).toBe(true)
    })
})

describe("favorites helpers", () => {
    it("lists a subtree parents before children", () => {
        const nodes = [
            node({ id: "favorite-a", url: null }),
            node({ id: "favorite-b", parentId: "favorite-a" }),
            node({ id: "favorite-c", parentId: "favorite-b" }),
            node({ id: "favorite-d" }),
        ]
        expect(subtreeIds(nodes, "favorite-a")).toEqual(["favorite-a", "favorite-b", "favorite-c"])
    })
})

describe("favorites service", () => {
    it("adds bookmarks and folders, and renames a bookmark URL", () =>
        runTest(
            Effect.gen(function* () {
                const { favorites } = yield* open()
                const folder = yield* favorites.createFolder({ name: "Work", parentId: null })
                const id = yield* favorites.add({
                    name: "Example",
                    url: "https://example.com/",
                    parentId: folder,
                })
                yield* settle
                const snapshot = yield* favorites.snapshot
                expect(snapshot.nodes).toHaveLength(3)
                const added = snapshot.nodes.find((n) => n.id === id)!
                expect(added.parentId).toBe(folder)
                expect(added.favicon).toBeNull()
                yield* favorites.update(id, { name: "Renamed", url: "https://example.com/new" })
                const renamed = (yield* favorites.snapshot).nodes.find((n) => n.id === id)!
                expect(renamed.name).toBe("Renamed")
                expect(renamed.url).toBe("https://example.com/new")
                // Folder URLs are not editable.
                yield* favorites.update(folder, { url: "https://nope.test/" })
                expect(
                    (yield* favorites.snapshot).nodes.find((n) => n.id === folder)?.url,
                ).toBeNull()
            }),
        ))

    it("removing a folder removes its subtree", () =>
        runTest(
            Effect.gen(function* () {
                const { favorites } = yield* open()
                const folder = yield* favorites.createFolder({ name: "Work", parentId: null })
                yield* favorites.add({
                    name: "A",
                    url: "https://a.test/",
                    parentId: folder,
                })
                yield* favorites.add({
                    name: "B",
                    url: "https://b.test/",
                    parentId: null,
                })
                yield* favorites.remove(folder)
                const snapshot = yield* favorites.snapshot
                expect(snapshot.nodes).toHaveLength(2)
                expect(snapshot.nodes.some((n) => n.id === NEW_TAB_FAVORITES_FOLDER_ID)).toBe(true)
                expect(snapshot.nodes.some((n) => n.url === "https://b.test/")).toBe(true)
            }),
        ))

    it("moves a node between parents and reorders siblings", () =>
        runTest(
            Effect.gen(function* () {
                const { favorites } = yield* open()
                const folder = yield* favorites.createFolder({ name: "Work", parentId: null })
                const first = yield* favorites.add({
                    name: "First",
                    url: "https://first.test/",
                    parentId: null,
                })
                const second = yield* favorites.add({
                    name: "Second",
                    url: "https://second.test/",
                    parentId: null,
                })
                yield* favorites.move(first, null, 3)
                let nodes = (yield* favorites.snapshot).nodes
                const roots = nodes
                    .filter((n) => n.parentId === null && n.url !== null)
                    .sort((a, b) => a.order - b.order)
                expect(roots.map((n) => n.id)).toEqual([second, first])
                yield* favorites.move(first, folder, 0)
                nodes = (yield* favorites.snapshot).nodes
                expect(nodes.find((n) => n.id === first)?.parentId).toBe(folder)
            }),
        ))

    it("never moves a folder into its own subtree", () =>
        runTest(
            Effect.gen(function* () {
                const { favorites } = yield* open()
                const parent = yield* favorites.createFolder({ name: "Parent", parentId: null })
                const child = yield* favorites.createFolder({ name: "Child", parentId: parent })
                yield* favorites.move(parent, child, 0)
                const nodes = (yield* favorites.snapshot).nodes
                expect(nodes.find((n) => n.id === parent)?.parentId).toBeNull()
            }),
        ))

    it("an unknown move target is a no-op", () =>
        runTest(
            Effect.gen(function* () {
                const { favorites } = yield* open()
                const id = yield* favorites.add({
                    name: "A",
                    url: "https://a.test/",
                    parentId: null,
                })
                yield* favorites.move(id, "favorite-missing", 0)
                // A bookmark is not a valid parent: also a no-op.
                yield* favorites.move(id, id, 0)
                const nodes = (yield* favorites.snapshot).nodes
                expect(nodes.find((n) => n.id === id)?.parentId).toBeNull()
            }),
        ))

    it("syncFavicon refreshes only bookmarks for that URL", () =>
        runTest(
            Effect.gen(function* () {
                const { favorites } = yield* open()
                const icon = "data:image/png;base64,AAA"
                const first = yield* favorites.add({
                    name: "A",
                    url: "https://a.test/",
                    parentId: null,
                })
                const second = yield* favorites.add({
                    name: "B",
                    url: "https://b.test/",
                    parentId: null,
                })
                yield* favorites.syncFavicon("https://a.test/", icon)
                yield* favorites.syncFavicon("https://a.test/", icon)
                const nodes = (yield* favorites.snapshot).nodes
                expect(nodes.find((n) => n.id === first)?.favicon).toBe(icon)
                expect(nodes.find((n) => n.id === second)?.favicon).toBeNull()
            }),
        ))

    it("the protected new-tab folder cannot be deleted or moved", () =>
        runTest(
            Effect.gen(function* () {
                const { favorites } = yield* open()
                const folder = yield* favorites.createFolder({ name: "Work", parentId: null })
                yield* favorites.remove(NEW_TAB_FAVORITES_FOLDER_ID)
                yield* favorites.move(NEW_TAB_FAVORITES_FOLDER_ID, folder, 0)
                yield* favorites.update(NEW_TAB_FAVORITES_FOLDER_ID, { name: "Renamed" })
                const nodes = (yield* favorites.snapshot).nodes
                const protectedFolder = nodes.find((n) => n.id === NEW_TAB_FAVORITES_FOLDER_ID)
                expect(protectedFolder?.parentId).toBeNull()
                expect(protectedFolder?.name).toBe("New Tab")
            }),
        ))

    it("bookmarks can be moved into the protected folder", () =>
        runTest(
            Effect.gen(function* () {
                const { favorites } = yield* open()
                const id = yield* favorites.add({
                    name: "A",
                    url: "https://a.test/",
                    parentId: null,
                })
                yield* favorites.move(id, NEW_TAB_FAVORITES_FOLDER_ID, 0)
                const nodes = (yield* favorites.snapshot).nodes
                expect(nodes.find((n) => n.id === id)?.parentId).toBe(NEW_TAB_FAVORITES_FOLDER_ID)
            }),
        ))
})
