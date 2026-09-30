import { For, Show, createEffect, createMemo, createSignal } from "solid-js"

import type { BrowserActionEntry, BrowserActionState } from "../../browser-action"
import { useSnapshot } from "../snapshot"

import "./PinnedActions.css"

/**
 * One toolbar button per pinned extension, between the URL input and the puzzle button.
 */
export const PinnedActions = () => {
    const snapshot = useSnapshot()
    const pinnedIds = () => snapshot()?.pinnedExtensionIds ?? []
    const activePartition = createMemo(() => {
        const id = snapshot()?.activeContainerId
        return id ? `persist:container-${id}` : ""
    })

    const [actions, setActions] = createSignal<BrowserActionState | null>(null)

    // Action state is per partition: pinning is global, the icon reflects the active container.
    createEffect(
        () => activePartition(),
        (partition) => {
            const api = window.browserAction
            if (!api || partition === "") {
                setActions(null)
                return () => undefined
            }
            const onUpdate = (state: BrowserActionState): void => {
                setActions(state)
            }
            const syncState = async (): Promise<void> => {
                try {
                    setActions(await api.getState(partition))
                } catch {
                    setActions(null)
                }
            }
            api.addEventListener("update", onUpdate)
            api.addObserver(partition)
            void syncState()
            return () => {
                api.removeEventListener("update", onUpdate)
                api.removeObserver(partition)
            }
        },
    )

    return (
        <div class="pinned-actions">
            <For each={pinnedIds()}>
                {(extensionId) => (
                    <PinnedAction
                        extensionId={extensionId}
                        partition={activePartition()}
                        tabId={actions()?.activeTabId ?? -1}
                        action={(actions()?.actions ?? []).find((item) => item.id === extensionId)}
                    />
                )}
            </For>
        </div>
    )
}

const PinnedAction = (props: {
    extensionId: string
    partition: string
    tabId: number
    action: BrowserActionEntry | undefined
}) => {
    let button: HTMLButtonElement | undefined
    const [iconFailed, setIconFailed] = createSignal(false)

    const iconUrl = (): string => {
        const params = new URLSearchParams({
            tabId: String(props.tabId),
            partition: props.partition,
        })
        const modified = props.action?.iconModified
        if (typeof modified === "number") params.append("t", String(modified))
        return `crx://extension-icon/${props.extensionId}/32/2?${params.toString()}`
    }

    const activate = async (): Promise<void> => {
        if (!button) return
        const bounds = button.getBoundingClientRect()
        const rect = {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
        }
        // Anchor first: the popup positions itself from this rect, not from the puzzle button.
        await window.arbor.extensionsAnchor({ extensionId: props.extensionId, rect })
        await window.browserAction?.activate(props.partition, {
            eventType: "click",
            extensionId: props.extensionId,
            tabId: props.tabId,
            alignment: "top right",
            anchorRect: rect,
        })
    }

    const onContextMenu = (event: MouseEvent): void => {
        event.preventDefault()
        event.stopPropagation()
        window.arbor.extensionsMenu({
            extensionId: props.extensionId,
            screenX: event.screenX,
            screenY: event.screenY,
        })
    }

    // Defensive: a pinned extension without an action would render an empty button.
    return (
        <Show when={props.action}>
            <button
                type="button"
                class="pinned-action"
                ref={(el) => (button = el)}
                aria-label={props.action?.title || props.extensionId}
                title={props.action?.title || props.extensionId}
                onClick={() => void activate()}
                onContextMenu={onContextMenu}
            >
                {iconFailed() ? (
                    <span class="pinned-action-fallback" aria-hidden="true">
                        {(props.action?.title?.charAt(0) || "?").toUpperCase()}
                    </span>
                ) : (
                    <img
                        class="pinned-action-icon"
                        src={iconUrl()}
                        alt=""
                        aria-hidden="true"
                        onError={() => setIconFailed(true)}
                    />
                )}
                <Show when={props.action?.text}>
                    <span
                        class="pinned-action-badge"
                        style={{ "background-color": props.action?.color ?? "var(--color-accent)" }}
                    >
                        {props.action?.text}
                    </span>
                </Show>
            </button>
        </Show>
    )
}
