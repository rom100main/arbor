import { For, Show, createSignal } from "solid-js"

import { isProtectedFavoritesFolderId } from "../../../shared/constants"
import type { FavoriteId, FavoriteNode } from "../../../shared/protocol"
import {
    dropPosition,
    isDescendantOfNodes,
    leftRow,
    siblingIndexNodes,
    type DropPosition,
} from "../../common/dnd"
import { EmptyState } from "../../common/EmptyState/EmptyState"
import { Favicon } from "../../common/Favicon/Favicon"
import { Icon } from "../../common/Icon/Icon"
import { TreeRow } from "../../common/TreeRow/TreeRow"

import "./FavoritesTree.css"

export interface DisplayFavorite {
    readonly node: FavoriteNode
    readonly depth: number
    readonly hasChildren: boolean
}

/** Depth-first display order, pruning collapsed folders. */
export const displayFavorites = (
    nodes: ReadonlyArray<FavoriteNode>,
    collapsed: ReadonlySet<FavoriteId>,
): DisplayFavorite[] => {
    const childrenByParent = new Map<FavoriteId | null, FavoriteNode[]>()
    for (const node of nodes) {
        const key = node.parentId ?? null
        const bucket = childrenByParent.get(key) ?? []
        bucket.push(node)
        childrenByParent.set(key, bucket)
    }
    for (const siblings of childrenByParent.values()) {
        // Protected folders is pinned first among its siblings.
        siblings.sort(
            (a, b) =>
                Number(isProtectedFavoritesFolderId(b.id)) -
                    Number(isProtectedFavoritesFolderId(a.id)) ||
                a.order - b.order ||
                a.name.localeCompare(b.name),
        )
    }
    const out: DisplayFavorite[] = []
    const walk = (parentId: FavoriteId | null, depth: number): void => {
        for (const node of childrenByParent.get(parentId) ?? []) {
            out.push({
                node,
                depth,
                hasChildren: (childrenByParent.get(node.id) ?? []).length > 0,
            })
            if (node.url !== null || !collapsed.has(node.id)) walk(node.id, depth + 1)
        }
    }
    walk(null, 0)
    return out
}

export const isFolder = (node: FavoriteNode): boolean => node.url === null

/** Folders for a folder picker, in tree order, indentable by depth. */
export const folderOptions = (
    nodes: ReadonlyArray<FavoriteNode>,
): ReadonlyArray<{ id: FavoriteId; name: string; depth: number }> => {
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const depthOf = (node: FavoriteNode): number => {
        let depth = 0
        let current = byId.get(node.id)
        while (current?.parentId) {
            depth += 1
            current = byId.get(current.parentId)
            if (!current) break
        }
        return depth
    }
    return displayFavorites(nodes, new Set())
        .filter(({ node }) => isFolder(node))
        .map(({ node }) => ({ id: node.id, name: node.name, depth: depthOf(node) }))
}

export const FavoriteRow = (props: {
    node: FavoriteNode
    depth: number
    hasChildren: boolean
    selected: boolean
    collapsed: boolean
    drop: DropPosition | null
    onSelect: () => void
    onToggle: () => void
    onOpen: (node: FavoriteNode, event: MouseEvent) => void
    onDragStart: (event: DragEvent) => void
    onDragOver: (event: DragEvent) => void
    onDragLeave: (event: DragEvent) => void
    onDrop: (event: DragEvent) => void
    onDragEnd: () => void
}) => {
    const node = () => props.node
    const protectedFolder = () => isProtectedFavoritesFolderId(node().id)
    return (
        <TreeRow
            class={{
                "favorites-row": true,
                "is-folder": isFolder(node()),
                "is-protected": protectedFolder(),
            }}
            depth={props.depth}
            active={props.selected}
            drop={props.drop}
            draggable={!protectedFolder()}
            onClick={(event) => {
                event.stopPropagation()
                if (!isFolder(node()) && (event.metaKey || event.ctrlKey)) {
                    props.onOpen(node(), event)
                    return
                }
                props.onSelect()
            }}
            onDblClick={(event) => {
                event.stopPropagation()
                if (isFolder(node())) props.onToggle()
                else props.onOpen(node(), event)
            }}
            onDragStart={props.onDragStart}
            onDragOver={props.onDragOver}
            onDragLeave={props.onDragLeave}
            onDrop={props.onDrop}
            onDragEnd={props.onDragEnd}
        >
            <span
                class={{
                    "row-leading": true,
                    "has-children": isFolder(node()) && props.hasChildren,
                }}
            >
                <Show when={isFolder(node())} fallback={<Favicon url={node().favicon} size={12} />}>
                    <Icon
                        name={
                            protectedFolder() ? "home" : props.collapsed ? "folder" : "folder-open"
                        }
                        size={12}
                    />
                </Show>
                <Show when={isFolder(node()) && props.hasChildren}>
                    <button
                        class="chevron overlay"
                        type="button"
                        aria-label={props.collapsed ? "Expand folder" : "Collapse folder"}
                        onClick={(event) => {
                            event.stopPropagation()
                            props.onToggle()
                        }}
                    >
                        <Icon name={props.collapsed ? "chevron-right" : "chevron-down"} size={12} />
                    </button>
                </Show>
            </span>
            <span class="favorites-row-name" title={node().url ?? node().name}>
                {node().name}
            </span>
            <Show when={!isFolder(node())}>
                <span class="favorites-row-url">{node().url}</span>
            </Show>
        </TreeRow>
    )
}

export const FavoritesTree = (props: {
    nodes: ReadonlyArray<FavoriteNode>
    selectedId: FavoriteId | null
    collapsed: ReadonlySet<FavoriteId>
    onSelect: (id: FavoriteId) => void
    onToggle: (id: FavoriteId) => void
    onOpen: (node: FavoriteNode, event: MouseEvent) => void
    onMove: (id: FavoriteId, parentId: FavoriteId | null, index: number) => void
}) => {
    const [draggedId, setDraggedId] = createSignal<FavoriteId | null>(null)
    const [drop, setDrop] = createSignal<{ id: FavoriteId; position: DropPosition } | null>(null)

    const clear = (): void => {
        setDraggedId(null)
        setDrop(null)
    }

    return (
        <div class="favorites-tree" onDragEnd={clear} onDragLeave={() => setDrop(null)}>
            <For each={displayFavorites(props.nodes, props.collapsed)}>
                {(row) => (
                    <FavoriteRow
                        node={row.node}
                        depth={row.depth}
                        hasChildren={row.hasChildren}
                        selected={props.selectedId === row.node.id}
                        collapsed={props.collapsed.has(row.node.id)}
                        drop={drop()?.id === row.node.id ? (drop()?.position ?? null) : null}
                        onSelect={() => props.onSelect(row.node.id)}
                        onToggle={() => props.onToggle(row.node.id)}
                        onOpen={props.onOpen}
                        onDragStart={(event) => {
                            setDraggedId(row.node.id)
                            event.dataTransfer!.effectAllowed = "move"
                            event.dataTransfer!.setData("text/plain", row.node.id)
                        }}
                        onDragOver={(event) => {
                            const dragId = draggedId()
                            if (!dragId || dragId === row.node.id) return
                            const position = dropPosition(event)
                            if (!position) return
                            if (
                                position === "child" &&
                                (!isFolder(row.node) ||
                                    isDescendantOfNodes(props.nodes, row.node.id, dragId))
                            )
                                return
                            event.preventDefault()
                            event.dataTransfer!.dropEffect = "move"
                            setDrop({ id: row.node.id, position })
                        }}
                        onDragLeave={(event) => {
                            if (drop()?.id !== row.node.id) return
                            if (!leftRow(event)) return
                            setDrop(null)
                        }}
                        onDrop={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            const dragId = draggedId()
                            const target = drop()
                            if (!dragId || !target) return
                            if (target.position === "child") {
                                const siblings = props.nodes.filter(
                                    (n) => n.parentId === row.node.id && n.id !== dragId,
                                )
                                props.onMove(dragId, row.node.id, siblings.length)
                            } else {
                                props.onMove(
                                    dragId,
                                    row.node.parentId,
                                    siblingIndexNodes(
                                        props.nodes,
                                        dragId,
                                        row.node.id,
                                        target.position,
                                    ),
                                )
                            }
                            clear()
                        }}
                        onDragEnd={clear}
                    />
                )}
            </For>
            <Show when={props.nodes.length === 0}>
                <EmptyState>No favorites yet.</EmptyState>
            </Show>
        </div>
    )
}
