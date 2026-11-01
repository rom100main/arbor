# One window, one process

Arbor runs one main window per process, and one process per user. Closing the window quits the app, on every platform, macOS included. Launching Arbor again while it runs quits the new process at once and the running one brings its window forward.

The single-instance lock is needed regardless of platform: two processes share `state.json`, `settings.json` and `extension-storage.json`, and each would overwrite the other's writes. 

Quitting goes one way. Closing the window ends `WindowManager.start`, and `index.ts` then calls `app.quit()`. A quit from the menu interrupts `start` instead, so it never quits twice. For the same reason `window-all-closed` has a listener that does nothing, which stops Electron's own quit on Windows and Linux from firing while the app scope is still closing.
