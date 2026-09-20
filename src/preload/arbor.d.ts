import type { ArborApi } from "./index"

declare global {
    interface Window {
        arbor: ArborApi
    }
}

export {}
