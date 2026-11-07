# Store

The store holds the whole browser state: containers, tabs, tab tree and closed tabs.

# Why One Store

Tab pages, menus, popups and the sidebar all depend on the same data. One store in the main process keeps them in sync. The UI only holds a read-only copy.

```mermaid
flowchart LR
    Store["Store (main)"] -->|"copy"| UI["UI"]
    UI -->|"actions"| Store
```

# How a Change Works

```mermaid
flowchart LR
    Action["Action<br/>(close tab, move tab...)"] --> Op["Pure function<br/>old state to new state"]
    Op -->|"ok"| Save["Save new state"]
    Op -->|"error"| Fail["Return the error<br/>state unchanged"]
    Save --> Changes["Publish the change"]
    Changes --> Sync["Window sync"]
    Changes --> UI["Push to UI"]
    Changes --> Menu["Menu"]
    Changes --> Disk["Save to disk"]
```

- Each change is a pure function: it takes the state and returns a new state or an error.
- Pure functions do not read the clock or make IDs. The store passes those in.
- A change that changes nothing publishes nothing.
- Each real change is published once.

# Full Example

```mermaid
sequenceDiagram
    participant R as UI
    participant M as Main
    participant S as Store
    participant W as Window manager
    R->>M: closeTab(tabId)
    M->>S: closeTab(tabId)
    S->>S: Apply the change
    S-->>R: { ok: true }
    S->>W: State changed
    W->>R: Push new state
```

# UI Copy

```mermaid
flowchart LR
    Start["UI starts"] --> Get["Ask for the state"]
    Get --> Signal["Store it in a signal"]
    Push["Each push"] --> Signal
    Signal --> Components["Components read it"]
```

- Tab rows are reused when nothing visible changed. _For example to not make favicons blink._

# Adding a New Action

```mermaid
flowchart LR
    A["1. Pure function"] --> B["2. Store method"]
    B --> C["3. Contract entry"]
    C --> D["4. Handler"]
```

- Keep the function pure. Return errors as values.
- Side effects, like loading a page, stay outside the store.
