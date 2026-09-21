# Architecture

**Language**
English

# Index

1. **Processes**: `01-processes.md` -> definitions: main, preload, renderer, shared.
2. **IPC**: `02-ipc.md` -> channels, patterns, direction.
3. **Store**: `03-store.md` -> `StoreService`, Effect, snapshot flow.

# Topology

- **Rule**: main owns state + views. Renderer owns pixels. Preload owns bridge. Shared owns types.
- **Constraint**: renderer -> main only via `window.arbor`. No direct `require("electron")` in renderer.

```mermaid
flowchart LR
    subgraph Main["main process : Node + Electron"]
        Store["StoreService<br/>Ref(DomainState)"]
        IPC_H["ipcMain.handle<br/>handlers.ts"]
        IPC_E["ipcMain.on<br/>events.ts"]
        Views["WebContentsViews<br/>1 per tab"]
        Win["BrowserWindow<br/>sidebar + toolbar"]
    end
    subgraph Pre["preload : contextBridge"]
        API["window.arbor"]
    end
    subgraph Ren["renderer : SolidJS 2.0"]
        Shell["MainShell"]
        Omni["OmniboxPopup<br/>?omnibox"]
        Rename["RenameApp<br/>?rename"]
    end
    Shared["shared/<br/>protocol.ts + url.ts"]

    Shell -->|"invoke / send"| API
    Omni -->|"send"| API
    Rename -->|"send"| API
    API -->|"IPC"| IPC_H
    API -->|"IPC"| IPC_E
    IPC_H --> Store
    IPC_E --> Views
    Store -->|"onCommit -> send arbor:state"| Shell
    Store -->|"ensureView / showTab / destroyView"| Views
    Win -.->|"embeds"| Views
    Shared -.->|"import"| Main
    Shared -.->|"import"| Pre
    Shared -.->|"import"| Ren
```

# Data Laws

- **Single writer**: `state_{t+1} = op(state_t)` in main only. Renderer holds `snapshot_t`, read-only.
- **Fan-out**: 1 commit -> *n* windows: `send(arbor:state)` to all `BrowserWindow.getAllWindows()`.
- **Isolation**: `session(container_id) = persist:container-{id}`. Cross-container move -> destroy + recreate view.
