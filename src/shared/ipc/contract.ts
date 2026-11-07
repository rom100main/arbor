/**
 * What each Arbor IPC channel carries: a schema for the payload, and for requests the success and the error.
 * Main imports it at runtime to check and encode. Preload and renderer use `import type` only.
 * Keys match `channels.ts` one for one, or this file does not compile.
 */
import { Predicate, Schema } from "effect"

import {
    EmptyContainer,
    InvalidMove,
    LastTab,
    NoActionPopup,
    NoContainer,
    SettingsRejected,
    UnknownContainer,
    UnknownTab,
} from "../errors"
import {
    Anchor,
    BrowserSnapshot,
    ContainerIcon,
    ContainerId,
    ExtensionMenuRequest,
    OmniboxActivation,
    PermissionPromptRequest,
    PinnedActionInfo,
    Rect,
    RenameTarget,
    RevealEdge,
    TabId,
    UpdateStatus,
} from "../protocol"
import { Settings, type SettingsPatch } from "../settings-schema"
import type { EVENTS, PUSHES, REQUESTS } from "./channels"

type Codec = Schema.Codec<unknown, unknown>

export interface RequestDef<
    P extends Codec = Codec,
    S extends Codec = Codec,
    E extends Codec = Codec,
> {
    readonly payload: P
    readonly success: S
    readonly error: E
}

export interface EventDef<P extends Codec = Codec> {
    readonly payload: P
}

export interface PushDef<V extends Codec = Codec> {
    readonly value: V
}

/** The schema under `key` in `def`, or `fallback` when `def` leaves it out. */
type Field<Def, Key extends string, Fallback> = Def extends {
    readonly [K in Key]: infer S extends Codec
}
    ? S
    : Fallback

interface RequestSpec {
    readonly payload?: Codec
    readonly success?: Codec
    readonly error?: Codec
}

/** Left out, `payload` and `success` are void and `error` is never. */
export function request<const Spec extends RequestSpec>(
    spec: Spec,
): RequestDef<
    Field<Spec, "payload", Schema.Void>,
    Field<Spec, "success", Schema.Void>,
    Field<Spec, "error", Schema.Never>
>
export function request(spec: RequestSpec): RequestDef {
    return {
        payload: spec.payload ?? Schema.Void,
        success: spec.success ?? Schema.Void,
        error: spec.error ?? Schema.Never,
    }
}

export function event(): EventDef<Schema.Void>
export function event<P extends Codec>(payload: P): EventDef<P>
export function event(payload: Codec = Schema.Void): EventDef {
    return { payload }
}

export function push(): PushDef<Schema.Void>
export function push<V extends Codec>(value: V): PushDef<V>
export function push(value: Codec = Schema.Void): PushDef {
    return { value }
}

const Delta = Schema.Literals([1, -1])

/** Only checks for an object: the settings store decodes the fields, and says why it refuses one. */
const SettingsInput = Schema.declare((input: unknown): input is SettingsPatch =>
    Predicate.isObject(input),
)

export const Requests = {
    getSnapshot: request({ success: BrowserSnapshot }),
    getSettings: request({ success: Settings }),
    setSettings: request({ payload: SettingsInput, success: Settings, error: SettingsRejected }),

    // The toolbar reads action metadata straight from the extension's manifest:
    // electron-chrome-extensions cannot serve it,
    // because it keeps extensions and tabs in one session and Arbor does not.
    extensionActionInfo: request({
        payload: Schema.Struct({ extensionId: Schema.String }),
        success: PinnedActionInfo,
    }),
    // Main reads the popup URL from the manifest: the renderer only names the extension.
    openExtensionActionPopup: request({
        payload: Schema.Struct({ extensionId: Schema.String, anchor: Schema.NullOr(Rect) }),
        error: NoActionPopup,
    }),

    createContainer: request({
        payload: Schema.Struct({
            name: Schema.optionalKey(Schema.String),
            color: Schema.optionalKey(Schema.String),
        }),
        success: ContainerId,
        error: Schema.Union([UnknownContainer, NoContainer]),
    }),
    switchContainer: request({
        payload: Schema.Struct({ containerId: ContainerId }),
        error: Schema.Union([UnknownContainer, EmptyContainer]),
    }),
    renameContainer: request({
        payload: Schema.Struct({ containerId: ContainerId, name: Schema.String }),
        error: UnknownContainer,
    }),
    setContainerColor: request({
        payload: Schema.Struct({ containerId: ContainerId, color: Schema.String }),
        error: UnknownContainer,
    }),
    setContainerIcon: request({
        payload: Schema.Struct({ containerId: ContainerId, icon: ContainerIcon }),
        error: UnknownContainer,
    }),
    reorderContainer: request({
        payload: Schema.Struct({ containerId: ContainerId, toIndex: Schema.Int }),
        error: UnknownContainer,
    }),

    createTab: request({
        payload: Schema.Struct({ url: Schema.optionalKey(Schema.String) }),
        success: TabId,
        error: Schema.Union([UnknownContainer, NoContainer]),
    }),
    selectTab: request({ payload: Schema.Struct({ tabId: TabId }), error: UnknownTab }),
    setCollapsed: request({
        payload: Schema.Struct({ tabId: TabId, collapsed: Schema.Boolean }),
        error: UnknownTab,
    }),
    closeTab: request({
        payload: Schema.Struct({ tabId: TabId }),
        error: Schema.Union([UnknownTab, UnknownContainer, LastTab]),
    }),
    renameTab: request({
        payload: Schema.Struct({ tabId: TabId, label: Schema.NullOr(Schema.String) }),
        error: UnknownTab,
    }),
    moveTab: request({
        payload: Schema.Struct({
            tabId: TabId,
            parentId: Schema.NullOr(TabId),
            index: Schema.Int,
        }),
        error: Schema.Union([UnknownTab, InvalidMove]),
    }),
    moveToContainer: request({
        payload: Schema.Struct({ tabId: TabId, containerId: ContainerId }),
        error: Schema.Union([UnknownTab, UnknownContainer]),
    }),
    goBack: request({ payload: Schema.Struct({ tabId: TabId }) }),
    goForward: request({ payload: Schema.Struct({ tabId: TabId }) }),
    reload: request({ payload: Schema.Struct({ tabId: TabId }) }),

    getUpdateStatus: request({ success: UpdateStatus }),
    installUpdate: request({}),
} satisfies { readonly [K in keyof typeof REQUESTS]: RequestDef }

export const Events = {
    omniboxUpdate: event(Schema.Struct({ query: Schema.String, rect: Schema.NullOr(Anchor) })),
    omniboxSetPopupHeight: event(Schema.Finite),
    omniboxActivate: event(OmniboxActivation),
    omniboxMoveSelection: event(Delta),
    omniboxActivateSelected: event(),
    // Ids, not objects: main reads the current name and color from the store.
    openRenameModal: event(
        Schema.Union([
            Schema.Struct({ kind: Schema.Literal("container"), containerId: ContainerId }),
            Schema.Struct({ kind: Schema.Literal("tab"), tabId: TabId }),
        ]),
    ),
    closeRenameModal: event(),
    extensionsToggle: event(Anchor),
    extensionsClose: event(),
    extensionsSetPopupHeight: event(Schema.Finite),
    extensionsMenu: event(ExtensionMenuRequest),
    permissionRespond: event(Schema.Boolean),
    // A revealed bar floats over the page, so the shell rises above it for as long as one is out.
    shellRaise: event(Schema.Boolean),
} satisfies { readonly [K in keyof typeof EVENTS]: EventDef }

export const Pushes = {
    state: push(BrowserSnapshot),
    settings: push(Settings),
    focusOmnibox: push(),
    omniboxQuery: push(Schema.String),
    omniboxMoveSelection: push(Delta),
    omniboxActivateSelected: push(),
    omniboxActivated: push(),
    renameTarget: push(RenameTarget),
    permissionRequest: push(PermissionPromptRequest),
    shellEdge: push(RevealEdge),
    updateStatus: push(UpdateStatus),
} satisfies { readonly [K in keyof typeof PUSHES]: PushDef }

export type RequestKey = keyof typeof Requests
export type EventKey = keyof typeof Events
export type PushKey = keyof typeof Pushes

/**
 * A request's answer, as it crosses the wire.
 * An expected failure is `ok: false`, never a rejection. A request that cannot fail is always `ok: true`.
 * A rejected promise means a bug: a bad payload or a handler defect, logged in main.
 */
export type Reply<D extends RequestDef> =
    | { readonly ok: true; readonly value: D["success"]["Encoded"] }
    | ([D["error"]["Type"]] extends [never]
          ? never
          : { readonly ok: false; readonly error: D["error"]["Encoded"] })

type Call<P, R> = [P] extends [void] ? () => R : (payload: P) => R

/** `window.arbor`: one method per request and event, one `on<Key>` per push. */
export type ArborApi = {
    readonly [K in RequestKey]: Call<
        (typeof Requests)[K]["payload"]["Encoded"],
        Promise<Reply<(typeof Requests)[K]>>
    >
} & {
    readonly [K in EventKey]: Call<(typeof Events)[K]["payload"]["Encoded"], void>
} & {
    readonly [K in PushKey as `on${Capitalize<K>}`]: (
        callback: (value: (typeof Pushes)[K]["value"]["Encoded"]) => void,
    ) => () => void
}
