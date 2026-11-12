/**
 * The channel name of every Arbor IPC message, one table per direction.
 * Imports nothing: the sandboxed preload loads it at runtime, and can only load `electron`.
 * The schemas live in `contract.ts`, with the same keys.
 */

/** Renderer asks, main answers. */
export const REQUESTS = {
    getSnapshot: "arbor:get-snapshot",
    getSettings: "arbor:settings:get",
    setSettings: "arbor:settings:set",

    extensionActionInfo: "arbor:extensions:action-info",
    openExtensionActionPopup: "arbor:extensions:action-popup",

    createContainer: "arbor:container:create",
    switchContainer: "arbor:container:switch",
    renameContainer: "arbor:container:rename",
    setContainerColor: "arbor:container:set-color",
    setContainerIcon: "arbor:container:set-icon",
    reorderContainer: "arbor:container:reorder",

    createTab: "arbor:tab:create",
    selectTab: "arbor:tab:select",
    setCollapsed: "arbor:tab:set-collapsed",
    closeTab: "arbor:tab:close",
    renameTab: "arbor:tab:rename",
    moveTab: "arbor:tab:move",
    moveToContainer: "arbor:tab:move-to-container",
    goBack: "arbor:tab:back",
    goForward: "arbor:tab:forward",
    reload: "arbor:tab:reload",

    downloadsList: "arbor:downloads:list",
    downloadCancel: "arbor:downloads:cancel",
    downloadRemove: "arbor:downloads:remove",
    downloadClear: "arbor:downloads:clear",
    downloadReveal: "arbor:downloads:reveal",
    downloadOpen: "arbor:downloads:open",
    downloadsOpenFolder: "arbor:downloads:open-folder",

    historyList: "arbor:history:list",
    historyRemove: "arbor:history:remove",
    historyClearBefore: "arbor:history:clear-before",
    historyClearAfter: "arbor:history:clear-after",
    historyClearAll: "arbor:history:clear-all",

    getUpdateStatus: "arbor:update:get-status",
    installUpdate: "arbor:update:install",
} as const

/** Renderer tells main, no answer. */
export const EVENTS = {
    omniboxUpdate: "arbor:omnibox:update",
    omniboxSetPopupHeight: "arbor:omnibox:popup-height",
    omniboxActivate: "arbor:omnibox:activate",
    omniboxMoveSelection: "arbor:omnibox:move-selection",
    omniboxActivateSelected: "arbor:omnibox:activate-selected",
    openRenameModal: "arbor:rename-modal:open",
    closeRenameModal: "arbor:rename-modal:close",
    extensionsToggle: "arbor:extensions:toggle",
    extensionsClose: "arbor:extensions:close",
    extensionsSetPopupHeight: "arbor:extensions:popup-height",
    extensionsMenu: "arbor:extensions:menu",
    downloadsToggle: "arbor:downloads:toggle",
    downloadsClose: "arbor:downloads:close",
    downloadsSetPopupHeight: "arbor:downloads:popup-height",
    permissionRespond: "arbor:permission:respond",
    shellRaise: "arbor:shell:raise",
    titlebarReveal: "arbor:titlebar:reveal",
} as const

/** Main tells renderers. The preload exposes each as `on<Key>`. */
export const PUSHES = {
    state: "arbor:state",
    settings: "arbor:settings:changed",
    focusOmnibox: "arbor:focus-omnibox",
    focusTabTree: "arbor:focus-tab-tree",
    toolbarPopup: "arbor:toolbar:popup",
    omniboxQuery: "arbor:omnibox:query",
    omniboxMoveSelection: "arbor:omnibox:popup:move-selection",
    omniboxActivateSelected: "arbor:omnibox:popup:activate-selected",
    omniboxActivated: "arbor:omnibox:activated",
    renameTarget: "arbor:rename:target",
    permissionRequest: "arbor:permission:request",
    shellEdge: "arbor:shell:edge",
    updateStatus: "arbor:update:status",
    downloads: "arbor:downloads:changed",
    history: "arbor:history:changed",
} as const
