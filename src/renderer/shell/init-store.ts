/**
 * Subscribe before fetching so a push during the initial read is not lost.
 * A late initial response never overwrites a newer push.
 * Failed initialization resets so retry is possible.
 */
export const createInit = <T>(options: {
    subscribe: (callback: (value: T) => void) => void
    fetch: () => Promise<T>
    apply: (value: T) => void
}): (() => Promise<void>) => {
    let initPromise: Promise<void> | null = null

    const doInit = async (): Promise<void> => {
        let pushed = false
        options.subscribe((next) => {
            pushed = true
            options.apply(next)
        })
        try {
            const initial = await options.fetch()
            if (!pushed) options.apply(initial)
        } catch (error) {
            initPromise = null
            throw error
        }
    }

    return () => {
        if (!initPromise) initPromise = doInit()
        return initPromise
    }
}
