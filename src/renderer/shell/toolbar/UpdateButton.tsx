import { Show, createSignal, onCleanup } from "solid-js"

import type { UpdateStatus } from "../../../shared/protocol"
import { Icon } from "../../ui/Icon"

import "./UpdateButton.css"

const labelOf = (status: UpdateStatus): string | null =>
    status.kind === "ready"
        ? `Update to v${status.version}`
        : status.kind === "manual"
          ? `Download v${status.version}`
          : null

/**
 * Shown once an update is downloaded (one click relaunches into it),
 * or found on a build that cannot install it (the click opens the release page).
 */
export const UpdateButton = () => {
    const [status, setStatus] = createSignal<UpdateStatus>({ kind: "idle" })

    // Subscribe before reading, so a push during the read is not lost.
    let pushed = false
    onCleanup(
        window.arbor.onUpdateStatus((next) => {
            pushed = true
            setStatus(next)
        }),
    )
    const load = async (): Promise<void> => {
        const reply = await window.arbor.getUpdateStatus()
        if (!pushed) setStatus(reply.value)
    }
    void load()

    return (
        <Show when={labelOf(status())}>
            {(label) => (
                <button
                    type="button"
                    class="update-button"
                    onClick={() => void window.arbor.installUpdate()}
                >
                    <Icon name="download" />
                    <span>{label()}</span>
                </button>
            )}
        </Show>
    )
}
