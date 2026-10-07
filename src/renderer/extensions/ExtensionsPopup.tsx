import { Show, createEffect, createSignal, onSettled } from "solid-js"

import { applyTheme, initSettings, useSettings } from "../shell/settings"
import { initState, useSnapshot } from "../shell/snapshot"

import "./ExtensionsPopup.css"

/**
 * The library's own right-click menu (and its `stopImmediatePropagation`)
 * lives on the `.action` button inside the open shadow root.
 * A capture listener on this ancestor runs first and stops the event before the target ever sees it.
 */
const actionFromEvent = (event: MouseEvent): HTMLElement | null => {
    for (const node of event.composedPath()) {
        if (node instanceof HTMLElement && node.classList.contains("action")) return node
    }
    return null
}

/** Rendered inside the frameless extensions popup window (?extensions query param). */
export const ExtensionsPopup = () => {
    void initState()
    void initSettings()
    const snapshot = useSnapshot()
    const settings = useSettings()
    createEffect(
        () => settings().theme,
        (theme) => applyTheme(theme),
    )
    const activePartition = () => {
        const id = snapshot()?.activeContainerId
        return id ? `persist:container-${id}` : ""
    }

    // The action list renders into an open shadow root;
    // watch it to show a hint when no extensions are installed.
    const [hasActions, setHasActions] = createSignal(false)
    const watchActions = (el: HTMLElement): void => {
        const shadow = el.shadowRoot
        if (!shadow) return
        const sync = (): void => {
            setHasActions(shadow.querySelectorAll(".action").length > 0)
        }
        sync()
        new MutationObserver(sync).observe(shadow, { childList: true })
    }

    // Must pass screen coords: the library's menu lands in the wrong place on viewport coords.
    const onContextMenu = (event: MouseEvent): void => {
        const action = actionFromEvent(event)
        if (!action || !action.id) return
        event.preventDefault()
        event.stopPropagation()
        window.arbor.extensionsMenu({
            extensionId: action.id,
            screenX: event.screenX,
            screenY: event.screenY,
        })
    }

    // The window is sized to its content, like the omnibox popup.
    let card: HTMLDivElement | undefined
    createEffect(
        () => hasActions(),
        () => {
            if (card) window.arbor.extensionsSetPopupHeight(card.offsetHeight + 12)
        },
    )

    onSettled(() => {
        card?.addEventListener("contextmenu", onContextMenu, { capture: true })
        return () => {
            card?.removeEventListener("contextmenu", onContextMenu, { capture: true })
        }
    })

    return (
        <div class="extensions-popup-root">
            <div class="extensions-card" ref={(el) => (card = el)}>
                <Show when={activePartition()}>
                    <browser-action-list
                        ref={watchActions}
                        class="extension-actions"
                        partition={activePartition()}
                        alignment="top right"
                        onClick={() => window.arbor.extensionsClose()}
                    />
                </Show>
                <Show when={!hasActions()}>
                    <div class="extensions-empty">No extensions installed</div>
                </Show>
            </div>
        </div>
    )
}
