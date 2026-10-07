import type {
    BrowserSnapshot,
    ClosedSubtree,
    ContainerId,
    ContainerMeta,
    ExtensionGrant,
    TabId,
    TabNode,
} from "../../shared/protocol"

export interface DomainState {
    containers: ContainerMeta[]
    tabs: Map<TabId, TabNode>
    closeHistory: ClosedSubtree[]
    activeContainerId: ContainerId | null
    /**
     * Per-extension consent ledger: install consent plus runtime-granted permissions.
     * Presence of a key means the user accepted that scope; not part of the snapshot.
     * Keyed by extension id (unpacked dev installs also key on their source path).
     */
    extensionConsent: Record<string, ExtensionGrant>
}

export class DomainError extends Error {}

export const initialState = (): DomainState => ({
    containers: [],
    tabs: new Map(),
    closeHistory: [],
    activeContainerId: null,
    extensionConsent: {},
})

// --- shared helpers

export const childrenOf = (
    state: DomainState,
    containerId: ContainerId,
    parentId: TabId | null,
): TabNode[] =>
    [...state.tabs.values()]
        .filter((tab) => tab.containerId === containerId && tab.parentId === parentId)
        .sort((a, b) => a.order - b.order)

export const siblingsOf = (state: DomainState, tab: TabNode): TabNode[] =>
    childrenOf(state, tab.containerId, tab.parentId)

export const reindex = (siblings: TabNode[]): TabNode[] =>
    siblings.map((tab, index) => ({ ...tab, order: index }))

export const withTabs = (state: DomainState, tabs: Map<TabId, TabNode>): DomainState => ({
    ...state,
    tabs,
})

export const containerOf = (state: DomainState, containerId: ContainerId): ContainerMeta => {
    const container = state.containers.find((c) => c.id === containerId)
    if (!container) throw new DomainError(`Unknown container: ${containerId}`)
    return container
}

export const removeContainer = (state: DomainState, containerId: ContainerId): DomainState => {
    const remaining = state.containers.filter((c) => c.id !== containerId)
    return { ...state, containers: remaining }
}

export const tabCount = (state: DomainState, containerId: ContainerId): number =>
    [...state.tabs.values()].filter((t) => t.containerId === containerId).length

const now = (): number => Date.now()

export const touch = (tab: TabNode): TabNode => ({ ...tab, lastActiveAt: now() })

export const descendantsOf = (state: DomainState, tabId: TabId): TabNode[] => {
    const root = state.tabs.get(tabId)
    if (!root) throw new DomainError(`Unknown tab: ${tabId}`)
    const result: TabNode[] = []
    const walk = (parentId: TabId): void => {
        for (const child of childrenOf(state, root.containerId, parentId)) {
            result.push(child)
            walk(child.id)
        }
    }
    walk(tabId)
    return result
}

export const subtreeOf = (state: DomainState, tabId: TabId): TabNode[] => {
    const root = state.tabs.get(tabId)
    if (!root) throw new DomainError(`Unknown tab: ${tabId}`)
    return [root, ...descendantsOf(state, tabId)]
}

// --- derived

export const snapshot = (state: DomainState): BrowserSnapshot => {
    const active = state.activeContainerId
        ? state.containers.find((c) => c.id === state.activeContainerId)
        : undefined
    return {
        containers: [...state.containers],
        tabs: [...state.tabs.values()],
        activeContainerId: state.activeContainerId,
        activeTabId: active?.activeTabId ?? null,
    }
}
