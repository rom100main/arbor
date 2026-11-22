/** The Favorites module: the bookmark tree, persisted across restarts. */

import { Context, Effect, FiberSet, Layer, Option, Stream, SubscriptionRef } from "effect"

import type { FavoriteId, FavoriteNode, FavoritesSnapshot } from "../../shared/protocol"
import { readJson } from "../persistence/json-file"
import * as PersistedRef from "../persistence/persisted-ref"
import { decodeFavorites, isFolder, subtreeIds } from "./favorites"

export interface FavoritesService {
    /** The tree now. */
    readonly snapshot: Effect.Effect<FavoritesSnapshot>
    /** The tree now, then on every change. */
    readonly changes: Stream.Stream<FavoritesSnapshot>
    /** Add a bookmark, returns its id. */
    readonly add: (input: {
        name: string
        url: string
        favicon?: string | null
        parentId: FavoriteId | null
    }) => Effect.Effect<FavoriteId>
    /** Rename / retarget a bookmark. Unknown ids are no-ops. */
    readonly update: (
        id: FavoriteId,
        patch: { name?: string; url?: string; favicon?: string | null },
    ) => Effect.Effect<void>
    /** Remove a node and, for a folder, its whole subtree. */
    readonly remove: (id: FavoriteId) => Effect.Effect<void>
    /** Create a folder, returns its id. */
    readonly createFolder: (input: {
        name: string
        parentId: FavoriteId | null
    }) => Effect.Effect<FavoriteId>
    /** Move a node under `parentId` at `index` among its new siblings. */
    readonly move: (
        id: FavoriteId,
        parentId: FavoriteId | null,
        index: number,
    ) => Effect.Effect<void>
}

export interface FavoritesOptions {
    /** Where the tree is remembered across restarts. */
    readonly favoritesPath: string
}

const toSnapshot = (nodes: ReadonlyArray<FavoriteNode>): FavoritesSnapshot => ({
    nodes: [...nodes],
})

const nextOrder = (nodes: ReadonlyArray<FavoriteNode>, parentId: FavoriteId | null): number => {
    const siblings = nodes.filter((n) => n.parentId === parentId)
    return siblings.reduce((max, n) => Math.max(max, n.order), -1) + 1
}

const resolveParent = (
    nodes: ReadonlyArray<FavoriteNode>,
    parentId: FavoriteId | null,
): FavoriteId | null => {
    if (parentId === null) return null
    const parent = nodes.find((n) => n.id === parentId)
    return parent && isFolder(parent) ? parentId : null
}

const make = (options: FavoritesOptions) =>
    Effect.gen(function* () {
        const persisted = yield* PersistedRef.make({
            path: options.favoritesPath,
            read: readJson(options.favoritesPath, decodeFavorites),
            encode: (nodes: ReadonlyArray<FavoriteNode>) => nodes,
            empty: () => [],
        })
        const stored = yield* persisted.get
        const items = yield* SubscriptionRef.make<ReadonlyArray<FavoriteNode>>(stored)
        const run = yield* FiberSet.makeRuntime()

        let records: ReadonlyArray<FavoriteNode> = stored

        const publish = (next: ReadonlyArray<FavoriteNode>): void => {
            records = next
            run(SubscriptionRef.set(items, next))
        }

        const persist = (next: ReadonlyArray<FavoriteNode>) =>
            persisted.modifySome(() => [undefined, Option.some(next)] as const)

        const update = (next: ReadonlyArray<FavoriteNode>): Effect.Effect<void> => {
            publish(next)
            return persist(next)
        }

        const add = (input: {
            name: string
            url: string
            favicon?: string | null
            parentId: FavoriteId | null
        }) =>
            Effect.gen(function* () {
                const id: FavoriteId = `favorite-${crypto.randomUUID()}`
                const name = input.name.trim() || input.url
                const parentId = resolveParent(records, input.parentId)
                const node: FavoriteNode = {
                    id,
                    parentId,
                    order: nextOrder(records, parentId),
                    name,
                    url: input.url,
                    favicon: input.favicon ?? null,
                }
                yield* update([...records, node])
                return id
            })

        const updateNode = (
            id: FavoriteId,
            patch: { name?: string; url?: string; favicon?: string | null },
        ) =>
            Effect.gen(function* () {
                const existing = records.find((n) => n.id === id)
                if (!existing) return
                const nextName =
                    patch.name !== undefined && patch.name.trim().length > 0
                        ? patch.name.trim()
                        : existing.name
                // Folders have no URL: a url patch only applies to bookmarks.
                const nextUrl =
                    isFolder(existing) || patch.url === undefined ? existing.url : patch.url
                const nextFavicon = patch.favicon !== undefined ? patch.favicon : existing.favicon
                if (
                    nextName === existing.name &&
                    nextUrl === existing.url &&
                    nextFavicon === existing.favicon
                )
                    return
                yield* update(
                    records.map((n) =>
                        n.id === id
                            ? { ...n, name: nextName, url: nextUrl, favicon: nextFavicon }
                            : n,
                    ),
                )
            })

        const remove = (id: FavoriteId) =>
            Effect.gen(function* () {
                if (!records.some((n) => n.id === id)) return
                const drop = new Set(subtreeIds(records, id))
                const rest = records.filter((n) => !drop.has(n.id))
                // Reindex the removed node's old siblings so no gap is left.
                const removed = records.find((n) => n.id === id)!
                const siblings = rest
                    .filter((n) => n.parentId === removed.parentId)
                    .sort((a, b) => a.order - b.order)
                const reindexed = new Map(
                    siblings.map((n, index) => [n.id, { ...n, order: index }]),
                )
                yield* update(rest.map((n) => reindexed.get(n.id) ?? n))
            })

        const createFolder = (input: { name: string; parentId: FavoriteId | null }) =>
            Effect.gen(function* () {
                const id: FavoriteId = `favorite-${crypto.randomUUID()}`
                const name = input.name.trim() || "New folder"
                const parentId = resolveParent(records, input.parentId)
                const node: FavoriteNode = {
                    id,
                    parentId,
                    order: nextOrder(records, parentId),
                    name,
                    url: null,
                    favicon: null,
                }
                yield* update([...records, node])
                return id
            })

        const move = (id: FavoriteId, parentId: FavoriteId | null, index: number) =>
            Effect.gen(function* () {
                const node = records.find((n) => n.id === id)
                if (!node) return
                if (parentId !== null) {
                    const parent = records.find((n) => n.id === parentId)
                    if (!parent || !isFolder(parent)) return
                    // Never move a folder into its own subtree.
                    if (subtreeIds(records, id).includes(parentId)) return
                }
                const without = records.filter((n) => n.id !== id)
                const newSiblings = without
                    .filter((n) => n.parentId === parentId)
                    .sort((a, b) => a.order - b.order)
                const clamped = Math.max(0, Math.min(index, newSiblings.length))
                newSiblings.splice(clamped, 0, { ...node, parentId })
                const reindexedSiblings = newSiblings.map((n, order) => ({ ...n, order }))
                const byId = new Map(reindexedSiblings.map((n) => [n.id, n]))
                // The moved node keeps its subtree untouched, only its order changed.
                yield* update([...without.filter((n) => !byId.has(n.id)), ...reindexedSiblings])
            })

        return Favorites.of({
            snapshot: Effect.sync(() => toSnapshot(records)),
            changes: SubscriptionRef.changes(items).pipe(Stream.map(toSnapshot)),
            add,
            update: updateNode,
            remove,
            createFolder,
            move,
        })
    })

export class Favorites extends Context.Service<Favorites, FavoritesService>()("arbor.Favorites") {
    static readonly layer = (options: FavoritesOptions): Layer.Layer<Favorites> =>
        Layer.effect(Favorites, make(options))
}
