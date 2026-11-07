import { createSignal } from "solid-js"

const [focusRequest, setFocusRequest] = createSignal(0)
const [treeFocusRequest, setTreeFocusRequest] = createSignal(0)

export const requestOmniboxFocus = (): void => {
    setFocusRequest((n) => n + 1)
}

export const useOmniboxFocus = (): (() => number) => focusRequest

/** Focus the active tab in the tab tree (Cmd/Ctrl+0). */
export const requestTabTreeFocus = (): void => {
    setTreeFocusRequest((n) => n + 1)
}

export const useTabTreeFocus = (): (() => number) => treeFocusRequest
