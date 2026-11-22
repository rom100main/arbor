/** Host portion of a URL, or null when it cannot be parsed. */
export const hostOf = (url: string): string | null => {
    try {
        return new URL(url).hostname.toLowerCase()
    } catch {
        return null
    }
}
