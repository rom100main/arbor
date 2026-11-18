import { Show, onSettled } from "solid-js"

import type { CloseContainerConfirmation } from "../../shared/protocol"

import "./ConfirmCloseContainer.css"

export const ConfirmCloseContainer = (props: {
    request: CloseContainerConfirmation | null
    onConfirm: () => void
    onCancel: () => void
}) => {
    onSettled(() => {
        const onKeyDown = (event: KeyboardEvent): void => {
            if (props.request === null) return
            if (event.key === "Escape") {
                event.preventDefault()
                props.onCancel()
            }
        }
        window.addEventListener("keydown", onKeyDown)
        return () => {
            window.removeEventListener("keydown", onKeyDown)
        }
    })

    return (
        <Show when={props.request}>
            {(request) => (
                <div class="confirm-overlay" onMouseDown={() => props.onCancel()}>
                    <div
                        class="confirm-popup"
                        onMouseDown={(event) => event.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Close container"
                    >
                        <div class="confirm-title">
                            Close container “{request().containerName}”?
                        </div>
                        <div class="confirm-summary">
                            Its last tab will be closed and the container itself removed.
                        </div>
                        <div class="confirm-actions">
                            <button type="button" onClick={() => props.onCancel()}>
                                Cancel
                            </button>
                            <button class="primary" type="button" onClick={() => props.onConfirm()}>
                                Close container
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </Show>
    )
}
