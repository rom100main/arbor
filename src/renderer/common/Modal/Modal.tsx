import type { JSX } from "@solidjs/web"

import "./Modal.css"

export const Modal = (props: {
    label: string
    onCancel: () => void
    size?: "sm" | "md"
    onKeyDown?: (event: KeyboardEvent) => void
    children?: JSX.Element
}) => (
    <div class="modal-overlay" onMouseDown={() => props.onCancel()}>
        <div
            class={{ "modal-popup": true, "modal-popup-sm": props.size === "sm" }}
            role="dialog"
            aria-modal="true"
            aria-label={props.label}
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={props.onKeyDown}
        >
            {props.children}
        </div>
    </div>
)

export const ModalActions = (props: { children?: JSX.Element }) => (
    <div class="modal-actions">{props.children}</div>
)
