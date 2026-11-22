import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"

import { isActive } from "../../../shared/downloads"
import type { DownloadInfo, DownloadsSnapshot } from "../../../shared/protocol"
import { Button } from "../../common/Button/Button"
import { EmptyState } from "../../common/EmptyState/EmptyState"
import { Icon } from "../../common/Icon/Icon"
import { PopupCard, PopupHeader } from "../../common/PopupCard/PopupCard"
import { ProgressBar } from "../../common/ProgressBar/ProgressBar"
import { formatBytes, progressOf } from "../../common/url/progress"

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

    const open = (): void => {
        if (item().state === "completed") void window.arbor.downloadOpen({ id: item().id })
    }

    return (
        <li class="download-row" data-state={item().state} onClick={open}>
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
                        <ProgressBar class="download-row-track" value={progressOf(item())} />
                        <span class="download-row-text">{statusText(item())}</span>
                    </Show>
                </div>
            </div>
            <div class="download-row-actions">
                <Show when={item().savePath}>
                    <Button
                        type="button"
                        icon="folder"
                        iconSize={14}
                        size="sm"
                        class="download-row-action"
                        aria-label="Reveal in folder"
                        title="Reveal in folder"
                        onClick={(event) => {
                            event.stopPropagation()
                            void window.arbor.downloadReveal({ id: item().id })
                        }}
                    />
                </Show>
                <Show
                    when={isActive(item())}
                    fallback={
                        <Button
                            type="button"
                            icon="x"
                            iconSize={14}
                            size="sm"
                            class="download-row-action"
                            aria-label="Remove from list"
                            title="Remove from list"
                            onClick={(event) => {
                                event.stopPropagation()
                                void window.arbor.downloadRemove({ id: item().id })
                            }}
                        />
                    }
                >
                    <Button
                        type="button"
                        icon="x"
                        iconSize={14}
                        size="sm"
                        class="download-row-action"
                        aria-label="Cancel download"
                        title="Cancel download"
                        onClick={(event) => {
                            event.stopPropagation()
                            void window.arbor.downloadCancel({ id: item().id })
                        }}
                    />
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
            <PopupCard ref={(el) => (card = el)}>
                <PopupHeader>
                    <span>Downloads</span>
                    <div class="downloads-header-actions">
                        <Show when={hasSettled()}>
                            <Button
                                size="sm"
                                variant="danger"
                                type="button"
                                onClick={() => void window.arbor.downloadClear()}
                            >
                                Clear
                            </Button>
                        </Show>
                        <Button
                            icon="folder"
                            iconSize={14}
                            size="sm"
                            type="button"
                            onClick={() => void window.arbor.downloadsOpenFolder()}
                        >
                            Open folder
                        </Button>
                    </div>
                </PopupHeader>
                <Show
                    when={items().length > 0}
                    fallback={<EmptyState>No downloads yet</EmptyState>}
                >
                    <ul class="downloads-list">
                        <For each={items()}>{(item) => <DownloadRow item={item} />}</For>
                    </ul>
                </Show>
            </PopupCard>
        </div>
    )
}
