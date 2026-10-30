/**
 * Chrome extension match-pattern subsumption for `permissions.contains({ origins })`.
 *
 * electron-chrome-extensions compares origin patterns with exact string equality,
 * so a granted https star-slash-star pattern does not count as covering https://some.com/* (Chrome does).
 * This is that broader-covers-narrower check.
 */

// Should be Effect free

export interface MatchPattern {
    scheme: string
    host: string
    path: string
}

/** Parse a Chrome match pattern or `<all_urls>`. Returns null if invalid. */
export const parseMatchPattern = (pattern: string): MatchPattern | null => {
    if (pattern === "<all_urls>")
        return { scheme: "<all_urls>", host: "<all_urls>", path: "<all_urls>" }

    const match = /^(\*|https?|file|ftp):\/\/([^/]+)(\/.*)$/.exec(pattern)
    if (!match) return null
    return { scheme: match[1], host: match[2], path: match[3] }
}

const schemeCovers = (granted: string, requested: string): boolean => {
    if (granted === "<all_urls>") return true
    if (granted === "*") return requested === "http" || requested === "https"
    return granted === requested
}

const hostCovers = (granted: string, requested: string): boolean => {
    if (granted === "<all_urls>" || granted === "*") return true
    if (granted === requested) return true
    // `*.example.com` covers `example.com` and any subdomain (and nested `*.example.com`).
    if (granted.startsWith("*.")) {
        const base = granted.slice(2)
        if (requested === base) return true
        if (requested === granted) return true
        if (requested.endsWith(`.${base}`)) return true
        if (requested.startsWith(`*.${base}`) || requested.startsWith(`*.`)) {
            // `*.sub.example.com` is under `*.example.com` only if sub is under example.com
            const requestedBase = requested.replace(/^\*/, "")
            return requestedBase.endsWith(`.${base}`) || requestedBase === `.${base}`
        }
        return false
    }
    return false
}

/** True when every path matching `requested` also matches `granted`. */
const pathCovers = (granted: string, requested: string): boolean => {
    if (granted === "<all_urls>" || granted === "/*") return true
    if (granted === requested) return true
    // `/prefix/*` covers anything under `/prefix/`, plus `/prefix` itself.
    if (granted.endsWith("/*")) {
        const prefix = granted.slice(0, -1) // keep trailing `/`
        const bare = granted.slice(0, -2)
        if (requested === bare || requested === prefix) return true
        if (requested.startsWith(prefix)) return true
        // Requested narrower trailing-star under the same prefix:
        // `/foo/*` under `/foo/bar/*` is not covered;
        // `/foo/bar/*` under `/foo/*` is, handled by startsWith above.
        if (requested.endsWith("/*") && requested.startsWith(prefix)) return true
    }
    return false
}

/** True when granted pattern covers requested (every URL matching requested matches granted). */
export const matchPatternCovers = (granted: string, requested: string): boolean => {
    if (granted === requested) return true
    const g = parseMatchPattern(granted)
    const r = parseMatchPattern(requested)
    if (!g || !r) return false
    if (!schemeCovers(g.scheme, r.scheme)) return false
    if (!hostCovers(g.host, r.host)) return false
    if (!pathCovers(g.path, r.path)) return false
    return true
}

/** True when every requested origin is covered by at least one granted origin. */
export const originsCoveredBy = (
    granted: readonly string[],
    requested: readonly string[],
): boolean =>
    requested.every((origin) => granted.some((pattern) => matchPatternCovers(pattern, origin)))
