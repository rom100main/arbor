import type { JSX } from "@solidjs/web"

import "./EmptyState.css"

export const EmptyState = (props: { children?: JSX.Element }) => (
    <div class="empty-state">{props.children}</div>
)
