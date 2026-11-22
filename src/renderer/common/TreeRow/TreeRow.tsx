import type { JSX } from "@solidjs/web"

import type { DropPosition } from "../dnd"

import "./TreeRow.css"

export const TreeRow = (props: {
    depth: number
    active?: boolean
    drop?: DropPosition | null
    class?: string | Record<string, boolean | undefined>
    tabbable?: boolean
    ref?: (el: HTMLDivElement | undefined) => void
    draggable?: boolean
    onClick?: (event: MouseEvent) => void
    onAuxClick?: (event: MouseEvent) => void
    onDblClick?: (event: MouseEvent) => void
    onFocus?: (event: FocusEvent) => void
    onContextMenu?: (event: MouseEvent) => void
    onDragStart?: (event: DragEvent) => void
    onDragOver?: (event: DragEvent) => void
    onDragLeave?: (event: DragEvent) => void
    onDrop?: (event: DragEvent) => void
    onDragEnd?: (event: DragEvent) => void
    children?: JSX.Element
}) => {
    const extra = (): Record<string, boolean | undefined> =>
        typeof props.class === "string" ? { [props.class]: true } : (props.class ?? {})
    return (
        <div
            class={{
                "tree-row": true,
                active: props.active,
                "drop-before": props.drop === "before",
                "drop-after": props.drop === "after",
                "drop-child": props.drop === "child",
                ...extra(),
            }}
            style={{ "--depth": props.depth }}
            tabindex={props.tabbable === undefined ? undefined : props.tabbable ? 0 : -1}
            ref={props.ref}
            draggable={props.draggable ? "true" : undefined}
            onClick={props.onClick}
            onAuxClick={props.onAuxClick}
            onDblClick={props.onDblClick}
            onFocus={props.onFocus}
            onContextMenu={props.onContextMenu}
            onDragStart={props.onDragStart}
            onDragOver={props.onDragOver}
            onDragLeave={props.onDragLeave}
            onDrop={props.onDrop}
            onDragEnd={props.onDragEnd}
        >
            {props.children}
        </div>
    )
}
