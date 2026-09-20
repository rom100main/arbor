import { createSignal } from "solid-js"

const [focusRequest, setFocusRequest] = createSignal(0)

export const requestOmniboxFocus = (): void => {
    setFocusRequest((n) => n + 1)
}

export const useOmniboxFocus = (): (() => number) => focusRequest
