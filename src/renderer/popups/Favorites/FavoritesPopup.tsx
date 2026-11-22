import { Show, createEffect, createSignal, onCleanup } from "solid-js"

import type {
    FavoriteId,
    FavoriteNode,
    FavoritesContext,
    FavoritesMode,
} from "../../../shared/protocol"
import { Button } from "../../common/Button/Button"
import { Field } from "../../common/Field/Field"
import { PopupCard, PopupFooter, PopupHeader } from "../../common/PopupCard/PopupCard"
import { initFavorites, useFavorites } from "../../common/store/favorites"
import { FavoritesTree, isFolder } from "./FavoritesTree"

import "./FavoritesPopup.css"
/** Rendered inside the frameless favorites popup window (?favorites query param). */
export const FavoritesPopup = () => {
    void initFavorites()
    const favorites = useFavorites()
    const [context, setContext] = createSignal<FavoritesContext>({ mode: "list", favoriteId: null })
    const [selectedId, setSelectedId] = createSignal<FavoriteId | null>(null)
    const [collapsed, setCollapsed] = createSignal<ReadonlySet<FavoriteId>>(new Set())

    onCleanup(
        window.arbor.onFavoritesContext((next) => {
            setContext(next)
            setSelectedId(next.favoriteId)
        }),
    )

    const mode = (): FavoritesMode => context().mode
    const nodes = () => favorites().nodes
    const selected = () => nodes().find((n) => n.id === selectedId()) ?? null

    const toggle = (id: FavoriteId): void => {
        setCollapsed((current) => {
            const next = new Set(current)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    // A bookmark removed while the popup is open leaves nothing selected.
    createEffect(
        () => [nodes(), selectedId()] as const,
        ([current, id]) => {
            if (id !== null && !current.some((n) => n.id === id)) setSelectedId(null)
        },
    )

    const expandAncestors = (id: FavoriteId | null): void => {
        if (id === null) return
        const byId = new Map(nodes().map((n) => [n.id, n]))
        setCollapsed((current) => {
            const next = new Set(current)
            let cur = byId.get(id)
            while (cur?.parentId) {
                next.delete(cur.parentId)
                cur = byId.get(cur.parentId)
            }
            return next
        })
    }

    const createFolder = async (): Promise<void> => {
        const sel = selected()
        const parentId = sel ? (isFolder(sel) ? sel.id : sel.parentId) : null
        const reply = await window.arbor.favoritesCreateFolder({ name: "New folder", parentId })
        expandAncestors(parentId)
        setSelectedId(reply.value)
    }

    const openBookmark = (node: { url: string | null }, event: MouseEvent): void => {
        if (node.url === null) return
        // Only the list mode opens pages; add mode edits them.
        if (mode() !== "list") return
        void window.arbor.favoritesOpen({ url: node.url, newTab: event.metaKey || event.ctrlKey })
    }

    let card: HTMLDivElement | undefined
    createEffect(
        () => [nodes().length, selectedId(), mode()] as const,
        () =>
            queueMicrotask(() => {
                if (card) {
                    window.arbor.favoritesSetPopupHeight(Math.min(card.scrollHeight + 12, 720))
                }
            }),
    )

    return (
        <div class="favorites-popup-root">
            <PopupCard ref={(el) => (card = el)}>
                <PopupHeader>
                    <span>{mode() === "add" ? "Add favorite" : "Favorites"}</span>
                </PopupHeader>
                <Show when={selected()}>{(sel) => <FavoriteEditor node={sel()} />}</Show>
                <FavoritesTree
                    nodes={nodes()}
                    selectedId={selectedId()}
                    collapsed={collapsed()}
                    onSelect={setSelectedId}
                    onToggle={toggle}
                    onOpen={openBookmark}
                    onMove={(id, parentId, index) =>
                        void window.arbor.favoritesMove({ id, parentId, index })
                    }
                />
                <PopupFooter>
                    <Button
                        icon="folder"
                        iconSize={14}
                        size="sm"
                        type="button"
                        onClick={() => void createFolder()}
                    >
                        New folder
                    </Button>
                    <Button
                        icon="trash"
                        iconSize={13}
                        size="sm"
                        variant="danger"
                        type="button"
                        disabled={selected() === null}
                        onClick={() => {
                            const target = selected()
                            if (target === null) return
                            setSelectedId(null)
                            void window.arbor.favoritesRemove({ id: target.id })
                        }}
                    >
                        Delete
                    </Button>
                </PopupFooter>
            </PopupCard>
        </div>
    )
}

const FavoriteEditor = (props: { node: FavoriteNode }) => {
    const [name, setName] = createSignal(props.node.name)
    const [url, setUrl] = createSignal(props.node.url ?? "")
    createEffect(
        () => props.node.id,
        () => {
            setName(props.node.name)
            setUrl(props.node.url ?? "")
        },
    )

    const saveName = (): void => {
        const next = name().trim()
        if (next && next !== props.node.name) {
            void window.arbor.favoritesUpdate({ id: props.node.id, name: next })
        }
    }
    const saveUrl = (): void => {
        const next = url().trim()
        if (next && next !== props.node.url) {
            void window.arbor.favoritesUpdate({ id: props.node.id, url: next })
        }
    }
    const isFolderNode = () => props.node.url === null

    return (
        <div class="favorites-editor">
            <label class="favorites-field">
                <span>Name</span>
                <Field
                    value={name()}
                    spellcheck={false}
                    autocomplete="off"
                    onInput={(event) => setName(event.currentTarget.value)}
                    onChange={saveName}
                    onKeyDown={(event) => {
                        if (
                            event.key === "Enter" &&
                            event.currentTarget instanceof HTMLInputElement
                        ) {
                            event.currentTarget.blur()
                        }
                    }}
                />
            </label>
            <Show when={!isFolderNode()}>
                <label class="favorites-field">
                    <span>URL</span>
                    <Field
                        value={url()}
                        spellcheck={false}
                        autocomplete="off"
                        onInput={(event) => setUrl(event.currentTarget.value)}
                        onChange={saveUrl}
                        onKeyDown={(event) => {
                            if (
                                event.key === "Enter" &&
                                event.currentTarget instanceof HTMLInputElement
                            ) {
                                event.currentTarget.blur()
                            }
                        }}
                    />
                </label>
            </Show>
        </div>
    )
}
