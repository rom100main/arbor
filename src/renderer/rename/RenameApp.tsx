import { createSignal } from "solid-js"

import type { RenameTarget } from "../../shared/protocol"
import { RenamePopup } from "./RenamePopup"

/** Rendered inside the transparent modal child window (?rename). */
export const RenameApp = () => {
    const [target, setTarget] = createSignal<RenameTarget | null>(null)
    window.arbor.onRenameTarget((next) => setTarget(next))
    return <>{target() !== null && <RenamePopup target={target()!} />}</>
}
