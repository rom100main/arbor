import { For, Show, createSignal } from "solid-js"

import type { FavoriteId, FavoriteNode } from "../../shared/protocol"
import { Favicon } from "../ui/Favicon"
import { Icon } from "../ui/Icon"

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
        siblings.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
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

export const isDescendantOf = (
    nodes: ReadonlyArray<FavoriteNode>,
    ancestorId: FavoriteId,
    nodeId: FavoriteId,
): boolean => {
    const byId = new Map(nodes.map((n) => [n.id, n]))
    let current = byId.get(nodeId)
    while (current?.parentId) {
        if (current.parentId === ancestorId) return true
        current = byId.get(current.parentId)
    }
    return false
}

/** Index of the drop slot among the target's siblings, excluding the dragged node. */
export const siblingIndex = (
    nodes: ReadonlyArray<FavoriteNode>,
    draggedId: FavoriteId,
    targetId: FavoriteId,
    position: "before" | "after",
): number => {
    const target = nodes.find((n) => n.id === targetId)
    if (!target) return 0
    const siblings = nodes
        .filter((n) => n.parentId === target.parentId && n.id !== draggedId)
        .sort((a, b) => a.order - b.order)
    const targetIndex = siblings.findIndex((n) => n.id === targetId)
    return position === "before" ? targetIndex : targetIndex + 1
}

export type DropPosition = "before" | "after" | "child"

const dropPosition = (event: DragEvent): DropPosition | null => {
    const row = event.currentTarget
    if (!(row instanceof HTMLElement)) return null
    const rect = row.getBoundingClientRect()
    const ratio = (event.clientY - rect.top) / rect.height
    if (ratio < 0.28) return "before"
    if (ratio > 0.72) return "after"
    return "child"
}

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
    return (
        <div
            class={{
                "favorites-row": true,
                selected: props.selected,
                "is-folder": isFolder(node()),
                "drop-before": props.drop === "before",
                "drop-after": props.drop === "after",
                "drop-child": props.drop === "child",
            }}
            style={{ "--depth": props.depth }}
            draggable="true"
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
            <span class="favorites-row-leading">
                <Show when={isFolder(node()) && props.hasChildren}>
                    <button
                        class="favorites-chevron"
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
                <Show when={isFolder(node())} fallback={<Favicon url={node().favicon} size={12} />}>
                    <Icon name={props.collapsed ? "folder" : "folder-open"} size={12} />
                </Show>
            </span>
            <span class="favorites-row-name" title={node().url ?? node().name}>
                {node().name}
            </span>
            <Show when={!isFolder(node())}>
                <span class="favorites-row-url">{node().url}</span>
            </Show>
        </div>
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
                                    isDescendantOf(props.nodes, row.node.id, dragId))
                            )
                                return
                            event.preventDefault()
                            event.dataTransfer!.dropEffect = "move"
                            setDrop({ id: row.node.id, position })
                        }}
                        onDragLeave={(event) => {
                            if (drop()?.id !== row.node.id) return
                            const entering = event.relatedTarget
                            const el = event.currentTarget
                            if (
                                entering instanceof Node &&
                                el instanceof Node &&
                                el.contains(entering)
                            )
                                return
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
                                    siblingIndex(props.nodes, dragId, row.node.id, target.position),
                                )
                            }
                            clear()
                        }}
                        onDragEnd={clear}
                    />
                )}
            </For>
            <Show when={props.nodes.length === 0}>
                <div class="favorites-empty">No favorites yet.</div>
            </Show>
        </div>
    )
}
