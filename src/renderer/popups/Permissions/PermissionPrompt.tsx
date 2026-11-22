import { For, Show, onSettled } from "solid-js"

import type { PermissionPromptRequest } from "../../../shared/protocol"
import { Button } from "../../common/Button/Button"
import { Modal, ModalActions } from "../../common/Modal/Modal"

import "./PermissionPrompt.css"

const iconFor = (request: PermissionPromptRequest): string | null => {
    if (request.icon) return request.icon
    if (request.kind === "request") return `crx://extension-icon/${request.id}/32/2`
    return null
}

/** Allow / Deny dialog for extension installs and `chrome.permissions.request`. */
export const PermissionPrompt = (props: { request: PermissionPromptRequest }) => {
    const install = () => props.request.kind === "install"
    const respond = (allowed: boolean): void => {
        window.arbor.permissionRespond(allowed)
    }

    // Enter accepts, Escape refuses; the dialog itself has no input to catch keys.
    onSettled(() => {
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === "Enter") {
                event.preventDefault()
                respond(true)
            } else if (event.key === "Escape") {
                event.preventDefault()
                respond(false)
            }
        }
        window.addEventListener("keydown", onKeyDown)
        return () => {
            window.removeEventListener("keydown", onKeyDown)
        }
    })

    return (
        <Modal
            label={install() ? "Add extension" : "Additional permissions"}
            onCancel={() => respond(false)}
        >
            <div class="permission-header">
                {iconFor(props.request) !== null ? (
                    <img
                        class="permission-icon"
                        src={iconFor(props.request)!}
                        alt=""
                        aria-hidden="true"
                    />
                ) : (
                    <div class="permission-icon fallback" aria-hidden="true">
                        {(props.request.name.charAt(0) || "?").toUpperCase()}
                    </div>
                )}
                <div class="permission-heading">
                    <div class="permission-title">
                        {install()
                            ? `Add “${props.request.name}”?`
                            : `“${props.request.name}” wants additional permissions`}
                    </div>
                    <div class="permission-summary">
                        {install()
                            ? "It will be able to do everything listed below."
                            : "Granting these is up to you."}
                    </div>
                </div>
            </div>
            <Show when={props.request.permissions.length > 0}>
                <div class="permission-group">
                    <div class="permission-label">Permissions</div>
                    <ul class="permission-list">
                        <For each={props.request.permissions}>
                            {(permission) => <li>{permission}</li>}
                        </For>
                    </ul>
                </div>
            </Show>
            <Show when={props.request.origins.length > 0}>
                <div class="permission-group">
                    <div class="permission-label">Sites</div>
                    <ul class="permission-list">
                        <For each={props.request.origins}>{(origin) => <li>{origin}</li>}</For>
                    </ul>
                </div>
            </Show>
            <ModalActions>
                <Button variant="stealth" size="sm" type="button" onClick={() => respond(false)}>
                    {install() ? "Cancel" : "Deny"}
                </Button>
                <Button variant="primary" size="sm" type="button" onClick={() => respond(true)}>
                    {install() ? "Add extension" : "Allow"}
                </Button>
            </ModalActions>
        </Modal>
    )
}
