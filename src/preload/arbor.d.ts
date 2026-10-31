import type { ArborApi } from "../shared/ipc/contract"

declare global {
    interface Window {
        arbor: ArborApi
    }
}

export {}
