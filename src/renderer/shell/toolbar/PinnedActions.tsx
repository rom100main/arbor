import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"

import type { PinnedActionInfo } from "../../../shared/protocol"
import { useSettings } from "../settings"

import "./PinnedActions.css"

/**
 * One toolbar button per pinned extension, between the URL input and the puzzle button.
 */
export const PinnedActions = () => {
    const settings = useSettings()
    const pinnedIds = () => settings().pinnedExtensionIds

    return (
        <div class="pinned-actions">
            <For each={pinnedIds()}>
                {(extensionId) => <PinnedAction extensionId={extensionId} />}
            </For>
        </div>
    )
}

/**
 * Runs `task`, discarding its result and logging a failure.
 * The effect itself has to stay synchronous, so async work is spawned rather than awaited.
 */
const spawn = (label: string, task: () => Promise<void>): void => {
    const run = async (): Promise<void> => {
        try {
            await task()
        } catch (error) {
            console.error(`[arbor] ${label}:`, error)
        }
    }
    void run()
}

const PinnedAction = (props: { extensionId: string }) => {
    const settings = useSettings()
    const [info, setInfo] = createSignal<PinnedActionInfo | null>(null)

    // Re-read whenever the pinned list is rewritten, so an extension updated on disk is picked up without polling.
    // Main caches the icon per file.
    createEffect(
        () => [props.extensionId, settings().pinnedExtensionIds] as const,
        ([extensionId]) => {
            let live = true
            onCleanup(() => {
                live = false
            })
            spawn("failed to read extension action", async () => {
                const reply = await window.arbor.extensionActionInfo({ extensionId })
                if (live) setInfo(reply.value)
            })
        },
    )

    let button: HTMLButtonElement | undefined
    const label = () => info()?.title || props.extensionId
    const hasPopup = () => (info()?.popupUrl ?? null) !== null

    const activate = (): void => {
        if (!hasPopup()) return
        const bounds = button?.getBoundingClientRect()
        const anchor = bounds
            ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
            : null
        spawn("failed to open the action popup", async () => {
            await window.arbor.openExtensionActionPopup({ extensionId: props.extensionId, anchor })
        })
    }

    const onContextMenu = (event: MouseEvent): void => {
        event.preventDefault()
        event.stopPropagation()
        spawn("failed to open the extension menu", async () => {
            window.arbor.extensionsMenu({
                extensionId: props.extensionId,
                screenX: event.screenX,
                screenY: event.screenY,
            })
        })
    }

    return (
        <button
            type="button"
            class="pinned-action"
            ref={(el) => (button = el)}
            aria-label={label()}
            title={label()}
            onClick={activate}
            onContextMenu={onContextMenu}
        >
            <Show
                when={info()?.iconDataUrl}
                fallback={
                    <span class="pinned-action-fallback" aria-hidden="true">
                        {label().charAt(0).toUpperCase()}
                    </span>
                }
            >
                {(url) => <img class="pinned-action-icon" src={url()} alt="" aria-hidden="true" />}
            </Show>
        </button>
    )
}
