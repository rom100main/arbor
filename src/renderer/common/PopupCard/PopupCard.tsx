import type { JSX } from "@solidjs/web"

import "./PopupCard.css"

export const PopupCard = (props: {
    class?: string
    ref?: (el: HTMLDivElement) => void
    children?: JSX.Element
}) => (
    <div class={props.class ? `popup-card ${props.class}` : "popup-card"} ref={props.ref}>
        {props.children}
    </div>
)

export const PopupHeader = (props: { children?: JSX.Element }) => (
    <header class="popup-header">{props.children}</header>
)

export const PopupFooter = (props: { children?: JSX.Element }) => (
    <footer class="popup-footer">{props.children}</footer>
)
