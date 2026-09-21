import { Show, createEffect, createSignal } from "solid-js"

import { initState, useSnapshot } from "../shell/snapshot"

import "./ExtensionsPopup.css"

/** Rendered inside the frameless extensions popup window (?extensions query param). */
export const ExtensionsPopup = () => {
    void initState()
    const snapshot = useSnapshot()
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

    // The window is sized to its content, like the omnibox popup.
    let card: HTMLDivElement | undefined
    createEffect(
        () => hasActions(),
        () => {
            if (card) window.arbor.extensionsSetPopupHeight(card.offsetHeight + 12)
        },
    )

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
