import { createSignal } from "solid-js"

import type { PermissionPromptRequest } from "../../shared/protocol"
import { PermissionPrompt } from "./PermissionPrompt"

/** Rendered inside the transparent modal child window (?permission query param). */
export const PermissionApp = () => {
    const [request, setRequest] = createSignal<PermissionPromptRequest | null>(null)
    window.arbor.onPermissionRequest((next) => setRequest(next))
    return <>{request() !== null && <PermissionPrompt request={request()!} />}</>
}
