import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"

import { isActive } from "../../shared/downloads"
import type { DownloadInfo, DownloadsSnapshot } from "../../shared/protocol"
import { Icon } from "../ui/Icon"
import { formatBytes, progressOf } from "./format"

import "./DownloadsPopup.css"

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i

const iconOf = (item: DownloadInfo): "alert-triangle" | "photo" | "file-download" =>
    item.state === "interrupted"
        ? "alert-triangle"
        : IMAGE_EXTENSION.test(item.filename)
          ? "photo"
          : "file-download"

const progressText = (item: DownloadInfo): string => {
    const progress = progressOf(item)
    if (progress === null) return formatBytes(item.receivedBytes)
    return `${Math.round(progress * 100)}% · ${formatBytes(item.receivedBytes)} of ${formatBytes(item.totalBytes)}`
}

const statusText = (item: DownloadInfo): string => {
    if (item.state === "progressing") return progressText(item)
    if (item.state === "completed") return `Completed · ${formatBytes(item.receivedBytes)}`
    if (item.state === "pending") return "Waiting for location…"
    return item.state === "cancelled" ? "Cancelled" : "Interrupted"
}

const DownloadRow = (props: { readonly item: DownloadInfo }) => {
    const item = () => props.item
    const indeterminate = () => progressOf(item()) === null

    const open = (): void => {
        if (item().state === "completed") void window.arbor.downloadOpen({ id: item().id })
    }

    return (
        <li
            class="download-row"
            data-state={item().state}
            data-indeterminate={indeterminate() ? "true" : "false"}
            onClick={open}
        >
            <span class="download-row-icon" aria-hidden="true">
                <Icon name={iconOf(item())} size={16} />
            </span>
            <div class="download-row-body">
                <div class="download-row-name" title={item().filename}>
                    {item().filename}
                </div>
                <div class="download-row-status">
                    <Show
                        when={item().state === "progressing"}
                        fallback={<span class="download-row-text">{statusText(item())}</span>}
                    >
                        <span class="download-row-track" aria-hidden="true">
                            <span
                                class="download-row-value"
                                style={{ transform: `scaleX(${progressOf(item()) ?? 0})` }}
                            />
                        </span>
                        <span class="download-row-text">{statusText(item())}</span>
                    </Show>
                </div>
            </div>
            <div class="download-row-actions">
                <Show when={item().savePath}>
                    <button
                        type="button"
                        class="download-row-action"
                        aria-label="Reveal in folder"
                        title="Reveal in folder"
                        onClick={(event) => {
                            event.stopPropagation()
                            void window.arbor.downloadReveal({ id: item().id })
                        }}
                    >
                        <Icon name="folder" size={14} />
                    </button>
                </Show>
                <Show
                    when={isActive(item())}
                    fallback={
                        <button
                            type="button"
                            class="download-row-action"
                            aria-label="Remove from list"
                            title="Remove from list"
                            onClick={(event) => {
                                event.stopPropagation()
                                void window.arbor.downloadRemove({ id: item().id })
                            }}
                        >
                            <Icon name="x" size={14} />
                        </button>
                    }
                >
                    <button
                        type="button"
                        class="download-row-action"
                        aria-label="Cancel download"
                        title="Cancel download"
                        onClick={(event) => {
                            event.stopPropagation()
                            void window.arbor.downloadCancel({ id: item().id })
                        }}
                    >
                        <Icon name="x" size={14} />
                    </button>
                </Show>
            </div>
        </li>
    )
}

/** Rendered inside the frameless downloads popup window (?downloads query param). */
export const DownloadsPopup = () => {
    const [snapshot, setSnapshot] = createSignal<DownloadsSnapshot | null>(null)

    // Subscribe before reading, so a push during the read is not lost.
    let pushed = false
    onCleanup(
        window.arbor.onDownloads((next) => {
            pushed = true
            setSnapshot(next)
        }),
    )
    const load = async (): Promise<void> => {
        const reply = await window.arbor.downloadsList()
        if (!pushed) setSnapshot(reply.value)
    }
    void load()

    // Newest first, so a download started while the popup is open appears at the top.
    const items = () => [...(snapshot()?.items ?? [])].reverse()
    const hasSettled = () => items().some((item) => !isActive(item))

    // Report the content height so the frameless window fits.
    // Depend on the row count, not the whole snapshot: progress ticks must not resize.
    let card: HTMLDivElement | undefined
    createEffect(
        () => snapshot()?.items.length ?? 0,
        () =>
            queueMicrotask(() => {
                if (card) {
                    window.arbor.downloadsSetPopupHeight(Math.min(card.scrollHeight + 12, 520))
                }
            }),
    )

    return (
        <div class="downloads-popup-root">
            <div class="downloads-card" ref={(el) => (card = el)}>
                <header class="downloads-header">
                    <span>Downloads</span>
                    <div class="downloads-header-actions">
                        <Show when={hasSettled()}>
                            <button type="button" onClick={() => void window.arbor.downloadClear()}>
                                Clear
                            </button>
                        </Show>
                        <button
                            type="button"
                            onClick={() => void window.arbor.downloadsOpenFolder()}
                        >
                            <Icon name="folder" size={14} /> Open folder
                        </button>
                    </div>
                </header>
                <Show
                    when={items().length > 0}
                    fallback={<div class="downloads-empty">No downloads yet</div>}
                >
                    <ul class="downloads-list">
                        <For each={items()}>{(item) => <DownloadRow item={item} />}</For>
                    </ul>
                </Show>
            </div>
        </div>
    )
}
