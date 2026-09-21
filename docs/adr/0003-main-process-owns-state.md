# Main process owns container/tab state

The container list and tab trees live exclusively in the main process (as an Effect-managed domain core). The Solid renderer never mutates state directly, it calls a typed IPC API exposed by the preload bridge and receives state updates as pushed events. Rejected renderer-owned state: the main process must drive sessions, WebContentsViews, and extension APIs anyway, so a renderer-owned copy would immediately desync.
