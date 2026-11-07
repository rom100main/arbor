/**
 * Arbor's page context menu, in Chrome's order:
 * link and media actions first, then editing, then the page actions.
 */

import {
    Menu,
    app,
    clipboard,
    type ContextMenuParams,
    type MenuItemConstructorOptions,
    type WebContents,
} from "electron"

export interface ContextMenuActions {
    readonly openLink: (
        url: string,
        disposition: "default" | "foreground-tab" | "background-tab",
    ) => void
    /** Start a download of `url` through the page's session. */
    readonly download: (url: string) => void
}

type Item = MenuItemConstructorOptions

const SEPARATOR: Item = { type: "separator" }

/** Empty groups drop out; the rest are separated by one rule each. */
const joinGroups = (groups: ReadonlyArray<ReadonlyArray<Item>>): Item[] => {
    const kept = groups.filter((group) => group.length > 0)
    return kept.flatMap((group, index) => (index === 0 ? [...group] : [SEPARATOR, ...group]))
}

const linkGroup = (params: ContextMenuParams, actions: ContextMenuActions): Item[] => {
    if (params.linkURL.length === 0) return []
    return [
        {
            label: "Open link in new tab",
            click: () => actions.openLink(params.linkURL, "default"),
        },
        {
            label: "Open link in background tab",
            click: () => actions.openLink(params.linkURL, "background-tab"),
        },
        { label: "Copy link address", click: () => clipboard.writeText(params.linkURL) },
    ]
}

const imageGroup = (
    params: ContextMenuParams,
    webContents: WebContents,
    actions: ContextMenuActions,
): Item[] => {
    if (params.mediaType !== "image") return []
    const items: Item[] = []
    // A canvas or CSS background has no URL, but still has pixels to copy.
    if (params.srcURL.length > 0) {
        items.push({ label: "Download image", click: () => actions.download(params.srcURL) })
    }
    items.push({ label: "Copy image", click: () => webContents.copyImageAt(params.x, params.y) })
    if (params.srcURL.length > 0) {
        items.push({ label: "Copy image link", click: () => clipboard.writeText(params.srcURL) })
        items.push({
            label: "Open image in new tab",
            click: () => actions.openLink(params.srcURL, "default"),
        })
    }
    return items
}

const mediaGroup = (params: ContextMenuParams, actions: ContextMenuActions): Item[] => {
    if (params.mediaType !== "audio" && params.mediaType !== "video") return []
    if (params.srcURL.length === 0) return []
    return [
        { label: "Download media", click: () => actions.download(params.srcURL) },
        { label: "Copy media address", click: () => clipboard.writeText(params.srcURL) },
        {
            label: "Open media in new tab",
            click: () => actions.openLink(params.srcURL, "default"),
        },
    ]
}

const canvasGroup = (params: ContextMenuParams, webContents: WebContents): Item[] =>
    params.mediaType === "canvas"
        ? [{ label: "Copy image", click: () => webContents.copyImageAt(params.x, params.y) }]
        : []

/** Electron exposes the control type, not the old `inputFieldType`. */
const NON_TEXT_CONTROLS = new Set(["input-number", "input-telephone"])

const spellcheckGroup = (params: ContextMenuParams, webContents: WebContents): Item[] => {
    if (params.misspelledWord.length === 0) return []
    return [
        ...params.dictionarySuggestions.map((suggestion) => ({
            label: suggestion,
            click: () => webContents.replaceMisspelling(suggestion),
        })),
        {
            label: "Add to dictionary",
            click: () => webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
        },
    ]
}

const emojiGroup = (params: ContextMenuParams): Item[] =>
    process.platform === "darwin" &&
    app.isEmojiPanelSupported() &&
    !NON_TEXT_CONTROLS.has(params.formControlType)
        ? [{ label: "Emoji", click: () => app.showEmojiPanel() }]
        : []

const editableGroups = (params: ContextMenuParams, webContents: WebContents): Item[][] => {
    if (!params.isEditable) return []
    const first =
        params.misspelledWord.length > 0 ? spellcheckGroup(params, webContents) : emojiGroup(params)
    return [
        first,
        [
            { label: "Undo", enabled: params.editFlags.canUndo, click: () => webContents.undo() },
            { label: "Redo", enabled: params.editFlags.canRedo, click: () => webContents.redo() },
        ],
        [
            { label: "Cut", enabled: params.editFlags.canCut, click: () => webContents.cut() },
            { label: "Copy", enabled: params.editFlags.canCopy, click: () => webContents.copy() },
            {
                label: "Paste",
                enabled: params.editFlags.canPaste,
                click: () => webContents.paste(),
            },
            {
                label: "Delete",
                enabled: params.editFlags.canDelete,
                click: () => webContents.delete(),
            },
        ],
        params.editFlags.canSelectAll
            ? [{ label: "Select All", click: () => webContents.selectAll() }]
            : [],
    ]
}

const selectionGroup = (params: ContextMenuParams): Item[] =>
    !params.isEditable && params.selectionText.length > 0
        ? [{ label: "Copy", click: () => clipboard.writeText(params.selectionText) }]
        : []

const pageGroups = (params: ContextMenuParams, webContents: WebContents): Item[][] => [
    [
        {
            label: "Back",
            enabled: webContents.navigationHistory.canGoBack(),
            click: () => webContents.navigationHistory.goBack(),
        },
        {
            label: "Forward",
            enabled: webContents.navigationHistory.canGoForward(),
            click: () => webContents.navigationHistory.goForward(),
        },
        { label: "Reload", click: () => webContents.reload() },
    ],
    [
        {
            label: "Inspect element",
            click: () => webContents.inspectElement(params.x, params.y),
        },
    ],
]

export const buildContextMenu = (
    params: ContextMenuParams,
    webContents: WebContents,
    actions: ContextMenuActions,
): Menu =>
    Menu.buildFromTemplate(
        joinGroups([
            linkGroup(params, actions),
            imageGroup(params, webContents, actions),
            mediaGroup(params, actions),
            canvasGroup(params, webContents),
            ...editableGroups(params, webContents),
            selectionGroup(params),
            ...pageGroups(params, webContents),
        ]),
    )
