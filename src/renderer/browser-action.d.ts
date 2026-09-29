declare module "@solidjs/web/jsx-runtime" {
    export namespace JSX {
        interface IntrinsicElements {
            "browser-action-list": HTMLAttributes<HTMLElement> & {
                partition?: string | undefined
                alignment?: string | undefined
            }
        }
    }
}

/** Per-tab overrides of an extension's browser action. */
export interface BrowserActionTabState {
    title?: string
    /** Badge text. */
    text?: string
    /** Badge background. */
    color?: string
    popup?: string
    iconModified?: number
}

export interface BrowserActionEntry extends BrowserActionTabState {
    id: string
    tabs: Record<string, BrowserActionTabState>
}

export interface BrowserActionState {
    /** The library's numeric tab id, not a domain `TabId`. */
    activeTabId?: number
    actions: BrowserActionEntry[]
}

export interface BrowserActionActivateDetails {
    eventType: "click" | "contextmenu"
    extensionId: string
    tabId: number
    alignment?: string
    anchorRect: { x: number; y: number; width: number; height: number }
}

/** `window.browserAction`, injected by `electron-chrome-extensions`' `injectBrowserAction`. */
export interface BrowserActionApi {
    addEventListener(name: "update", listener: (state: BrowserActionState) => void): void
    removeEventListener(name: "update", listener: (state: BrowserActionState) => void): void
    getAction(extensionId: string): BrowserActionEntry | undefined
    getState(partition: string): Promise<BrowserActionState>
    activate(partition: string, details: BrowserActionActivateDetails): Promise<void>
    addObserver(partition: string): void
    removeObserver(partition: string): void
}

declare global {
    interface Window {
        browserAction?: BrowserActionApi
    }
}

export {}
