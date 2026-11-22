import { Show, onSettled } from "solid-js"

import type { CloseContainerConfirmation } from "../../../shared/protocol"
import { Button } from "../../common/Button/Button"
import { Modal, ModalActions } from "../../common/Modal/Modal"

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
                <Modal label="Close container" onCancel={() => props.onCancel()}>
                    <div class="confirm-title">Close container “{request().containerName}”?</div>
                    <div class="confirm-summary">
                        Its last tab will be closed and the container itself removed.
                    </div>
                    <ModalActions>
                        <Button variant="stealth" type="button" onClick={() => props.onCancel()}>
                            Cancel
                        </Button>
                        <Button variant="primary" type="button" onClick={() => props.onConfirm()}>
                            Close container
                        </Button>
                    </ModalActions>
                </Modal>
            )}
        </Show>
    )
}
