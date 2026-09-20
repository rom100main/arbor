import { Show, createEffect, createSignal } from "solid-js"

import { Icon } from "./Icon"

import "./Favicon.css"

export const Favicon = (props: { url: string | null; size?: number }) => {
    const [failed, setFailed] = createSignal(false)
    createEffect(
        () => props.url,
        () => {
            setFailed(false)
        },
    )

    return (
        <Show
            when={props.url !== null && !failed()}
            fallback={
                <span class="favicon placeholder">
                    <Icon name="world" size={props.size ?? 11} />
                </span>
            }
        >
            <img
                class="favicon"
                src={props.url!}
                alt=""
                draggable="false"
                onError={() => setFailed(true)}
            />
        </Show>
    )
}
