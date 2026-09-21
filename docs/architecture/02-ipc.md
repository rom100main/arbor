# Definition

- **IPC**: inter-process communication. Mechanism for renderer <-> main message passing across OS processes.
- **Need**: renderer and main run in separate processes with separate memory. No shared variables. Only serialized messages over channels.
- **Transport**: Electron `ipcMain` <-> `ipcRenderer`. Payloads: structured-cloneable values only. No functions, no class instances.

> Electron IPC: `ipcRenderer.invoke` + `ipcMain.handle` for two-way, `ipcRenderer.send` + `ipcMain.on` for one-way, `webContents.send` for main->renderer push.
> Source: _Electron docs -> ipcMain / ipcRenderer / webContents_.

# Patterns

## 1. Request/response

- **Use**: mutations + initial read. Caller awaits result or error.
- **Primitives**: `ipcRenderer.invoke(channel, ...args)` -> `ipcMain.handle(channel, fn)`.
- **Error path**: handler throws -> `invoke` promise rejects.

```mermaid
sequenceDiagram
    participant R as renderer:Sidebar.tsx
    participant P as preload:api
    participant M as main:handlers.ts
    participant S as StoreService
    R->>P: arbor.createTab()
    P->>M: invoke("arbor:tab:create")
    M->>S: createTab()
    S-->>M: TabId | DomainError
    M-->>P: resolve | throw Error(message)
    P-->>R: Promise<TabId>
```

- **Channels**: `arbor:get-snapshot`, `arbor:container:*`, `arbor:tab:*` except navigation helpers.

## 2. Fire-and-forget

- **Use**: high-frequency or no-result events. No await.
- **Primitives**: `ipcRenderer.send(channel, payload)` -> `ipcMain.on(channel, fn)`.
- **Property**: lossy by design. Sender continues. No return value: `void`.

```mermaid
sequenceDiagram
    participant R as renderer:OmniboxInput
    participant P as preload
    participant M as main:events.ts
    participant W as popup window
    R->>P: omniboxUpdate({query, rect})
    P->>M: send("arbor:omnibox:update")
    M->>M: rect == null ∨ query == ∅ ? hide : showOmniboxPopup()
    M->>W: send("arbor:omnibox:query", query)
```

- **Channels**: `arbor:omnibox:update`, `arbor:omnibox:popup-height`, `arbor:omnibox:activate`, `arbor:omnibox:move-selection`, `arbor:omnibox:activate-selected`, `arbor:rename-modal:open`, `arbor:rename-modal:close`.

## 3. Push

- **Use**: main -> renderer broadcast. State commits, focus requests, popup navigation.
- **Primitives**: `win.webContents.send(channel, payload)` -> `ipcRenderer.on(channel, cb)` wrapped in preload.
- **Fan-out**: `for (w of getAllWindows()) w.send("arbor:state", snapshot)`. Popup and modal stay in sync without extra fetch.

```mermaid
flowchart LR
    Commit["onCommit(next)"] --> Snap["snapshot(next)"]
    Snap --> All["for each window"]
    All --> W1["main: arbor:state"]
    All --> W2["omnibox popup: arbor:state"]
    All --> W3["rename modal: arbor:state"]
    Commit --> Menu["rebuildMenu()"]
    Commit --> Views["ensureView / showTab / destroyView"]
```

# Renderer <-> Main

```mermaid
flowchart TB
    subgraph Ren["renderer"]
        C["click new tab"]
        S2["snapshot signal"]
    end
    subgraph Pre["preload"]
        I["invoke"]
        SN["send"]
        ON["on"]
    end
    subgraph Mn["main"]
        H["handle"]
        O["on"]
        ST["store"]
        WB["webContents.send"]
    end
    C --> I
    I --> H
    H --> ST
    ST --> WB
    WB --> ON
    ON --> S2
    C -.->|"typing, no await"| SN
    SN --> O
```

# Rules

1. Add channel in 3 places: `handlers.ts` or `events.ts` + `preload/index.ts` + call site in renderer.
2. Prefer `invoke` for state changes. Prefer `send` for input streams: `query_t` at 60Hz must not block on `await`.
3. Never send `DomainState` (`Map` inside). Send `BrowserSnapshot` (plain arrays). Relation: `snapshot = project(DomainState)`.
