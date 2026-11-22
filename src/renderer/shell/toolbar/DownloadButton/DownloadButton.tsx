import { createMemo, createSignal, onCleanup } from "solid-js"

import { isActive } from "../../../../shared/downloads"
import type { DownloadId, DownloadsSnapshot } from "../../../../shared/protocol"
import { Button } from "../../../common/Button/Button"
import { Icon } from "../../../common/Icon/Icon"
import { ProgressBar } from "../../../common/ProgressBar/ProgressBar"
import { overallProgress } from "../../../common/url/progress"

import "./DownloadButton.css"

/**
 * The toolbar's download entry point:
 * a glyph that bobs while anything downloads,
 * a bar under it for the aggregate progress,
 * and a dot for a finish not yet seen.
 */
export const DownloadButton = () => {
    const [snapshot, setSnapshot] = createSignal<DownloadsSnapshot | null>(null)
    // In memory only: the dot means "finished while you were using Arbor".
    const [seen, setSeen] = createSignal<ReadonlySet<DownloadId>>(new Set())
    // Restored downloads finished while Arbor was closed: they are not news.
    let seeded = false

    const apply = (next: DownloadsSnapshot): void => {
        setSnapshot(next)
        if (seeded) return
        seeded = true
        setSeen(
            new Set(next.items.filter((item) => item.state === "completed").map((item) => item.id)),
        )
    }

    // Subscribe before reading, so a push during the read is not lost.
    let pushed = false
    onCleanup(
        window.arbor.onDownloads((next) => {
            pushed = true
            apply(next)
        }),
    )
    const load = async (): Promise<void> => {
        const reply = await window.arbor.downloadsList()
        if (!pushed) apply(reply.value)
    }
    void load()

    const items = () => snapshot()?.items ?? []
    const active = createMemo(() => items().filter(isActive))
    const progress = createMemo(() => overallProgress(items()))
    const unseen = createMemo(() =>
        items().some((item) => item.state === "completed" && !seen().has(item.id)),
    )

    const label = (): string => {
        const running = active()
        if (running.length === 0) return "Downloads"
        if (running.length > 1) return `Downloading ${running.length} files`
        const only = running[0]
        return only.state === "pending" ? "Downloading…" : `Downloading ${only.filename}`
    }

    let button: HTMLButtonElement | undefined

    const toggle = (): void => {
        if (!button) return
        // Opening the list counts every finished item as seen.
        setSeen((current) => {
            const next = new Set(current)
            for (const item of items()) {
                if (item.state === "completed") next.add(item.id)
            }
            return next
        })
        const rect = button.getBoundingClientRect()
        window.arbor.downloadsToggle({ x: rect.x, y: rect.y, width: rect.width })
    }

    return (
        <Button
            square
            class="download-button"
            ariaLabel={label()}
            title={label()}
            dataActive={active().length > 0 ? "true" : "false"}
            dataUnseen={unseen() ? "true" : "false"}
            ref={(el) => (button = el)}
            onClick={toggle}
        >
            <span class="download-glyph" aria-hidden="true">
                <Icon name="download" />
            </span>
            <ProgressBar
                class="download-progress"
                thin
                value={active().length > 0 ? progress() : 0}
            />
        </Button>
    )
}
