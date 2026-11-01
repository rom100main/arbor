import { Context, Effect, Exit, Layer, Scope } from "effect"
import { app } from "electron"

import { AppServices } from "./app-services"
import { filterBenignExtensionLoadWarnings } from "./extension/load-warnings"
import { AppRuntime } from "./runtime"
import { registerInternalScheme } from "./windows/internal-pages"
import { WindowManager } from "./windows/window-manager"

/**
 * One Arbor process, one window.
 * Closing the window quits, on every platform.
 * A second launch quits at once: the first instance gets `second-instance` and brings its window forward.
 */
const run = (): void => {
    // Must precede app.whenReady(): arbor:// needs a real origin for the bundle's module script.
    registerInternalScheme()
    filterBenignExtensionLoadWarnings()

    /** Holds every app service. Closing it writes pending changes and closes the window. */
    const appScope = AppRuntime.runSync(Scope.make())

    const start = async (): Promise<void> => {
        await app.whenReady()
        const services = await AppRuntime.runPromise(
            Layer.buildWithScope(AppServices(app.getPath("userData")), appScope),
        )
        AppRuntime.runFork(
            Effect.forkIn(
                Effect.andThen(
                    Context.get(services, WindowManager).start,
                    Effect.sync(() => app.quit()),
                ),
                appScope,
            ),
        )
    }

    void start()

    // Quitting closes the app scope: every persisted service writes its pending change in a finalizer.
    // The runtime itself stays up, so events fired while windows close still run.
    app.once("before-quit", (event) => {
        event.preventDefault()
        void (async () => {
            // Finalizers write synchronously, the timeout only guards against a hung one.
            await Promise.race([
                AppRuntime.runPromise(Scope.close(appScope, Exit.void)),
                new Promise((resolve) => setTimeout(resolve, 2_000)),
            ])
            app.quit()
        })()
    })

    // Listening replaces Electron's own quit on Windows and Linux:
    // the window closing during a quit already in progress must not quit a second time, before the app scope has closed.
    app.on("window-all-closed", () => undefined)
}

if (app.requestSingleInstanceLock()) run()
else app.quit()
