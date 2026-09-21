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

export {}
