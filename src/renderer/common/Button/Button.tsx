import type { JSX } from "@solidjs/web"
import { Show } from "solid-js"

import { Icon, type IconName } from "../Icon/Icon"

import "./Button.css"

export type ButtonVariant = "stealth" | "outline" | "primary" | "danger"
export type ButtonSize = "sm" | "md"

export interface ButtonProps {
    variant?: ButtonVariant
    size?: ButtonSize
    icon?: IconName
    iconSize?: number
    square?: boolean
    active?: boolean
    disabled?: boolean
    pressed?: boolean
    badge?: JSX.Element
    class?: string | Record<string, boolean | undefined>
    title?: string
    ariaLabel?: string
    "aria-label"?: string
    type?: "button" | "submit"
    ref?: (el: HTMLButtonElement) => void
    onClick?: (event: MouseEvent) => void
    onAuxClick?: (event: MouseEvent) => void
    onContextMenu?: (event: MouseEvent) => void
    dataActive?: string
    dataIndeterminate?: string
    dataUnseen?: string
    style?: JSX.CSSProperties
    children?: JSX.Element
}

export const Button = (props: ButtonProps) => {
    const size = () => props.size ?? "md"
    const isIconOnly = () =>
        props.square ?? (props.icon !== undefined && props.children === undefined)
    const variant = () => props.variant ?? (isIconOnly() ? "stealth" : "outline")
    const classes = (): string => {
        const extra =
            typeof props.class === "string"
                ? props.class
                : props.class
                  ? Object.entries(props.class)
                        .filter(([, v]) => v)
                        .map(([k]) => k)
                        .join(" ")
                  : ""
        return [
            "btn",
            `btn-${variant()}`,
            `btn-${size()}`,
            isIconOnly() ? "btn-icon-only" : "",
            props.active ? "is-active" : "",
            extra,
        ]
            .filter(Boolean)
            .join(" ")
    }

    const pressedAttr = () =>
        props.pressed === undefined ? undefined : props.pressed ? "true" : "false"
    return (
        <button
            type={props.type ?? "button"}
            class={classes()}
            ref={props.ref}
            aria-label={props.ariaLabel ?? props["aria-label"]}
            aria-pressed={pressedAttr()}
            title={props.title}
            disabled={props.disabled}
            onClick={props.onClick}
            onAuxClick={props.onAuxClick}
            onContextMenu={props.onContextMenu}
            data-active={props.dataActive}
            data-indeterminate={props.dataIndeterminate}
            data-unseen={props.dataUnseen}
            style={props.style}
        >
            <Show when={props.icon}>
                <span class="btn-icon" aria-hidden="true">
                    <Icon name={props.icon!} size={props.iconSize ?? (size() === "sm" ? 14 : 16)} />
                </span>
            </Show>
            {props.children}
            <Show when={props.badge}>
                <span class="btn-badge" aria-hidden="true">
                    {props.badge}
                </span>
            </Show>
        </button>
    )
}
