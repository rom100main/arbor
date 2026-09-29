# Definitions

## 1. Main

- **Location**: `src/main/`
- **Runtime**: Node + Electron. Full OS access: windows, sessions, filesystem, menus.
- **Entry**: `src/main/index.ts` -> `start()`.
- **Owns**:
    - `BrowserStore`: sole mutable state.
    - `BrowserWindow` instances.
    - `WebContentsView` instances: 1 per tab.
    - `ipcMain` handlers.
- **Never**: renders sidebar DOM. No SolidJS here.

## 2. Preload

- **Location**: `src/preload/index.ts`
- **Runtime**: isolated bridge. Runs before renderer. Access to both `electron` and `window`.
- **Exposes**: `contextBridge.exposeInMainWorld("arbor", api)` -> `window.arbor: ArborApi`.
- **Contains**: no state, no logic. Thin wrappers only:
    - `invoke(channel, ...args)` for request/response.
    - `send(channel, ...args)` for fire-and-forget.
    - `on(channel, cb)` for subscriptions.
- **Type contract**: `src/preload/arbor.d.ts` -> `Window.arbor`.

## 3. Renderer

- **Location**: `src/renderer/`
- **Runtime**: Chromium sandbox. No Node, no `ipcRenderer` import.
- **Stack**: SolidJS 2.0. Reactive signals from snapshots.
- **Entry**: `src/renderer/App.tsx` -> 3 modes by query string.
- **Access**: `window.arbor` only.

## 4. Shared

- **Location**: `src/shared/`
- **Runtime**: none. Pure logic + types, no `electron` import.
- **Membership**: only code loaded into **both** processes, main and renderer (the latter directly or through a preload). Code a single process uses belongs in that process's tree.
- **Contents**:
    - `protocol.ts`: `ContainerId`, `TabId`, `BrowserSnapshot`, `RenameTarget`, `OmniboxActivation`, `CONTAINER_COLORS`, `CONTAINER_ICONS`.
    - `url.ts`: `omniboxTarget()`, `isUrlLike()`.
    - `tree-display.ts`: `displayTabs()` -> flat rows + `depth`.
    - `match-patterns.ts`: `originsCoveredBy()` -> Chrome match-pattern subsumption.
    - `decode.ts`: `orDefault()`, `decodeOr()` -> lenient Effect Schema reads of untrusted JSON.
    - `extension-storage.ts`: `ExtStorageOp` wire types + pure `chrome.storage` semantics over plain objects.

# Process Map

```mermaid
flowchart TB
    subgraph M["main"]
        S["index.ts:start()"]
        H["ipc/handlers.ts"]
        E["ipc/events.ts"]
        ST["state/store.ts"]
        W["windows/*"]
    end
    subgraph P["preload"]
        B["index.ts:api<br/>exposeInMainWorld"]
    end
    subgraph R["renderer"]
        A["App.tsx"]
        SH["shell/MainShell.tsx"]
        OM["omnibox/OmniboxPopup.tsx"]
        RN["rename/RenameApp.tsx"]
        SN["shell/snapshot.ts"]
    end
    subgraph SHR["shared"]
        PR["protocol.ts"]
        URL["url.ts"]
        TD["tree-display.ts"]
        MP["match-patterns.ts"]
        DEC["decode.ts"]
        ES["extension-storage.ts"]
    end

    S --> H
    S --> E
    S --> ST
    S --> W
    A --> SH
    A --> OM
    A --> RN
    SH --> SN
    B -->|"window.arbor"| SH
    B -->|"window.arbor"| OM
    B -->|"window.arbor"| RN
    PR -.-> M
    PR -.-> P
    PR -.-> R
    URL -.-> M
    URL -.-> R
    TD -.-> M
    TD -.-> R
    MP -.-> M
    MP -.-> P
    DEC -.-> M
    DEC -.-> P
    ES -.-> M
    ES -.-> P
```

# Startup Sequence

```mermaid
sequenceDiagram
    participant M as main:index.ts
    participant W as BrowserWindow
    participant P as preload
    participant R as renderer:MainShell
    M->>M: app.whenReady()
    M->>M: makeStoreLayer(onCommit)
    M->>M: registerIpc(store)
    M->>W: createWindow() + preloadPath
    W->>P: load preload/index.cjs
    P->>W: expose window.arbor
    W->>R: loadRenderer() -> index.html
    R->>P: getSnapshot()
    P->>M: invoke arbor:get-snapshot
    M-->>R: BrowserSnapshot
    R->>P: onState(cb)
    M->>M: createContainer() -> onCommit -> send arbor:state
```

# Rules

- **Import direction**: main -> shared, preload -> shared, renderer -> shared. Never shared -> main.
- **Shared membership**: `src/shared/` holds only code loaded into both processes. Single-process code lives in `src/main/`, `src/preload/`, or `src/renderer/`.
- **No bypass**: renderer `import { ipcRenderer } from "electron"` -> forbidden. Use `window.arbor`.
- **Modes**: `loadRenderer(win)` = main shell. `loadRenderer(win, "omnibox")` = popup. `loadRenderer(win, "rename")` = modal. Same bundle, 3 roots.
