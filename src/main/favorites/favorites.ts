/**
 * What survives a restart: the favorites tree (bookmarks and folders).
 *
 * Stored as a flat JSON array in `favorites.json`, beside `history.json`.
 * Bad entries are skipped, orphans reparented to the root.
 */

import {
    FavoriteNode,
    type FavoriteId,
    type FavoriteNode as FavoriteNodeType,
} from "../../shared/protocol"
import { decodeOr } from "../persistence/decode"

const decodeNode = decodeOr(FavoriteNode)

export const isFolder = (node: FavoriteNodeType): boolean => node.url === null
export const isBookmark = (node: FavoriteNodeType): boolean => node.url !== null

/** Ids of `id` followed by every descendant, parents before children. */
export const subtreeIds = (
    nodes: ReadonlyArray<FavoriteNodeType>,
    id: FavoriteId,
): FavoriteId[] => {
    const childrenByParent = new Map<FavoriteId | null, FavoriteNodeType[]>()
    for (const node of nodes) {
        const bucket = childrenByParent.get(node.parentId) ?? []
        bucket.push(node)
        childrenByParent.set(node.parentId, bucket)
    }
    const out: FavoriteId[] = []
    const walk = (current: FavoriteId): void => {
        out.push(current)
        for (const child of childrenByParent.get(current) ?? []) walk(child.id)
    }
    if (nodes.some((n) => n.id === id)) walk(id)
    return out
}

export const decodeFavorites = (data: unknown): ReadonlyArray<FavoriteNodeType> | null => {
    if (!Array.isArray(data)) return null
    const seen = new Set<FavoriteId>()
    const nodes: FavoriteNodeType[] = []
    for (const raw of data) {
        const parsed = decodeNode(raw)
        if (!parsed || seen.has(parsed.id)) continue
        seen.add(parsed.id)
        nodes.push(parsed)
    }
    // Break parent cycles: walk each chain and cut the first repeated id to root.
    const byId = new Map(nodes.map((n) => [n.id, n]))
    for (const node of nodes) {
        const chain = new Set<FavoriteId>([node.id])
        let current: FavoriteNodeType | undefined = node
        while (current?.parentId) {
            if (chain.has(current.parentId)) {
                current = { ...current, parentId: null }
                byId.set(current.id, current)
                Object.assign(node, current)
                break
            }
            chain.add(current.parentId)
            current = byId.get(current.parentId)
        }
    }
    // Orphans and bookmarks used as parents become roots.
    const repaired = nodes.map((node) => {
        if (node.parentId === null) return node
        const parent = byId.get(node.parentId)
        if (!parent || !isFolder(parent)) return { ...node, parentId: null }
        return node
    })
    // Deterministic sibling order: by order, then name, then id.
    repaired.sort(
        (a, b) =>
            (a.parentId ?? "").localeCompare(b.parentId ?? "") ||
            a.order - b.order ||
            a.name.localeCompare(b.name) ||
            a.id.localeCompare(b.id),
    )
    return repaired
}
