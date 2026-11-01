# Architecture

**Language**
English

# Index

1. **Processes**: `01-processes.md` -> definitions: main, preload, renderer, shared.
2. **IPC**: `02-ipc.md` -> channels, patterns, direction.
3. **Store**: `03-store.md` -> `StoreService`, Effect, snapshot flow.

# Topology

- **Rule**: main owns state + views. Renderer owns pixels. Preload owns bridge. Shared owns both-process code.
- **Constraint**: renderer -> main only via `window.arbor`. No direct `require("electron")` in renderer.

```mermaid
flowchart LR
    subgraph Main["main process : Node + Electron"]
        Store["StoreService<br/>SubscriptionRef(DomainState)"]
        subgraph MW["WindowManager module: the one window"]
            IPC["window channels<br/>ipc/window-channels.ts"]
            Rec["reconcile"]
            Host["electron-host.ts<br/>window, shell view, tab views"]
        end
    end
    subgraph Pre["preload : contextBridge"]
        API["window.arbor"]
    end
    subgraph Ren["renderer : SolidJS 2.0"]
        Shell["MainShell"]
        Omni["OmniboxPopup<br/>?omnibox"]
        Rename["RenameApp<br/>?rename"]
    end
    Shared["shared/<br/>both-process code"]

    Shell -->|"invoke / send"| API
    Omni -->|"send"| API
    Rename -->|"send"| API
    API -->|"IPC"| IPC
    IPC --> Store
    Store -->|"changes"| Rec
    Rec -->|"push state"| Shell
    Rec -->|"create / show / close views"| Host
    Shared -.->|"import"| Main
    Shared -.->|"import"| Pre
    Shared -.->|"import"| Ren
```

# Data Laws

- **Single writer**: `state_{t+1} = op(state_t)` in main only. Renderer holds `snapshot_t`, read-only.
- **Fan-out**: 1 commit -> _n_ windows: `send(arbor:state)` to all `BrowserWindow.getAllWindows()`.
- **Isolation**: `session(container_id) = containerPartition(id)` = `persist:container-{id}`. Cross-container move -> destroy + recreate view.
- **Stacking**: the shell renders in its own transparent `WebContentsView` (`main/windows/shell-view.ts`), a sibling of the tab views, never in the window's own webContents (which always paints beneath child views). At rest: shell below the active tab, tab bounds = window minus `chromeInsets(settings)`. While a hidden/compact bar is revealed: renderer sends `arbor:shell:raise` -> shell above the tab, bar slides over the page. Main reports the pointer reaching a hidden bar's edge over a page as `arbor:shell:edge` (the shell cannot see it there).
