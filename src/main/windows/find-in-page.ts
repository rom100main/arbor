/**
 * Find-in-page.
 *
 * Main collects matches by running a script inside the page.
 * The script walks text nodes, turns matches into `Range`s
 * and registers them with the CSS Custom Highlights API,
 * so every occurrence is painted without mutating the DOM.
 */
import type { WebContents, WebFrameMain } from "electron"

import type { FindQuery, FindStatus } from "../../shared/protocol"

/** The largest number of highlights one page keeps: a pathological page must not tank the renderer. */
export const MAX_HIGHLIGHTS = 10_000

/** `RegExp` metacharacters, escaped so a literal find never acts as a pattern. */
export const escapeRegExp = (literal: string): string =>
    literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Result of compiling a find: either a ready global `RegExp` or the error message. */
export type BuiltFindRegExp =
    | { readonly ok: true; readonly regExp: RegExp }
    | { readonly ok: false; readonly error: string }

/**
 * Compile a find query into a global `RegExp`.
 *
 * Case folding uses the `i` flag unless case is sensitive;
 * whole-word matches use lookaround,
 * so the check works even at the edges of a text node
 * (`\b` also would, but lookaround handles queries that begin or end with a non-word character).
 * An invalid pattern is an expected answer, not a throw.
 */
export const buildFindRegExp = (find: FindQuery): BuiltFindRegExp => {
    const source = find.regex ? find.query : escapeRegExp(find.query)
    if (source.length === 0) return { ok: false, error: "" }
    const pattern = find.wholeWord ? `(?<!\\w)(?:${source})(?!\\w)` : source
    const flags = find.caseSensitive ? "g" : "gi"
    try {
        return { ok: true, regExp: new RegExp(pattern, flags) }
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
}

/**
 * The in-page script.
 * It is a function taking `(args)` so the query travels as JSON, never as embedded source.
 * State lives on `window.__arborFind` per frame.
 */
const FIND_IMPL = `
(function (args) {
  const state = window.__arborFind = window.__arborFind || { ranges: [], active: -1 }
  const HIGHLIGHT = "arbor-find"
  const ACTIVE = "arbor-find-active"

  const clearHighlights = () => {
    try { CSS.highlights.delete(HIGHLIGHT) } catch (e) {}
    try { CSS.highlights.delete(ACTIVE) } catch (e) {}
  }

  const ensureStyles = () => {
    if (document.getElementById("arbor-find-style")) return
    const style = document.createElement("style")
    style.id = "arbor-find-style"
    style.textContent =
      "::highlight(arbor-find) { background: #fff176; color: inherit; }" +
      "::highlight(arbor-find-active) { background: #ff9800; color: #111; }"
    document.head.appendChild(style)
  }

  const scrollTo = (range) => {
    try {
      const el = range.startContainer.parentElement
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" })
      }
    } catch (e) {}
  }

  if (args.op === "clear") {
    clearHighlights()
    state.ranges = []
    state.active = -1
    return { total: 0, error: null }
  }

  if (args.op === "info") {
    return { total: state.ranges.length, error: null }
  }

  if (args.op === "activate") {
    const local = args.localActive
    if (local < 0 || local >= state.ranges.length) {
      try { CSS.highlights.delete(ACTIVE) } catch (e) {}
      state.active = -1
    } else {
      ensureStyles()
      try { CSS.highlights.set(ACTIVE, new Highlight(state.ranges[local])) } catch (e) {}
      state.active = local
      if (args.scroll) scrollTo(state.ranges[local])
    }
    return { total: state.ranges.length, error: null }
  }

  // op: "search"
  clearHighlights()
  state.ranges = []
  state.active = -1
  if (!args.query) return { total: 0, error: null }

  const escapeRe = (s) => s.replace(/[.*+?^$\\{\\}()|[\\]\\\\]/g, "\\\\$&")
  const source = args.regex ? String(args.query) : escapeRe(String(args.query))
  const pattern = args.wholeWord ? "(?<!\\\\w)(?:" + source + ")(?!\\\\w)" : source
  const flags = args.caseSensitive ? "g" : "gi"
  let re
  try {
    re = new RegExp(pattern, flags)
  } catch (e) {
    return { total: 0, error: e && e.message ? String(e.message) : String(e) }
  }

  ensureStyles()
  const MAX = args.max || 10000
  const walker = document.createTreeWalker(
    document.documentElement,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const parent = node.parentElement
        if (!parent) return NodeFilter.FILTER_REJECT
        const tag = parent.tagName
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "IFRAME" || tag === "TEMPLATE") {
          return NodeFilter.FILTER_REJECT
        }
        return node.nodeValue && node.nodeValue.length > 0
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT
      },
    },
  )

  let node
  while ((node = walker.nextNode()) && state.ranges.length < MAX) {
    const text = node.nodeValue
    re.lastIndex = 0
    let match
    while ((match = re.exec(text)) !== null) {
      if (state.ranges.length >= MAX) break
      const at = match.index
      const length = match[0].length
      if (length === 0) {
        re.lastIndex = at + 1
        continue
      }
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + length)
      // Hidden text (display: none and friends) has no boxes: Chrome does not count it either.
      if (range.getClientRects().length === 0) continue
      state.ranges.push(range)
    }
  }

  if (state.ranges.length > 0) {
    try { CSS.highlights.set(HIGHLIGHT, new Highlight(...state.ranges)) } catch (e) {}
  }
  return { total: state.ranges.length, error: null }
})`

interface FrameResult {
    readonly total: number
    readonly error: string | null
}

/** Every frame of a page, main frame first. */
export const framesOf = (webContents: WebContents): WebFrameMain[] =>
    webContents.mainFrame.framesInSubtree

const runInFrame = async (
    frame: WebFrameMain,
    args: Record<string, unknown>,
): Promise<FrameResult> => {
    try {
        const value = await frame.executeJavaScript(`${FIND_IMPL}(${JSON.stringify(args)})`, false)
        if (typeof value !== "object" || value === null) return { total: 0, error: null }
        const result = value as { total?: unknown; error?: unknown }
        return {
            total: typeof result.total === "number" ? result.total : 0,
            error: typeof result.error === "string" ? result.error : null,
        }
    } catch {
        return { total: 0, error: null }
    }
}

const EMPTY_STATUS: FindStatus = { total: 0, activeIndex: -1, error: null }

/** Run the page script over every frame, summing totals (a dead frame counts as zero). */
const runInAllFrames = async (
    webContents: WebContents,
    args: Record<string, unknown>,
): Promise<FrameResult[]> => {
    if (webContents.isDestroyed()) return []
    return Promise.all(framesOf(webContents).map((frame) => runInFrame(frame, args)))
}

/** Highlight every match of `query` and report the first one as active. */
export const runFindSearch = async (
    webContents: WebContents,
    find: FindQuery,
): Promise<FindStatus> => {
    if (find.query.length === 0) {
        await runFindClear(webContents)
        return EMPTY_STATUS
    }
    const compiled = buildFindRegExp(find)
    if (!compiled.ok) {
        await runFindClear(webContents)
        return { total: 0, activeIndex: -1, error: compiled.error }
    }
    const args = {
        op: "search",
        query: find.query,
        caseSensitive: find.caseSensitive,
        wholeWord: find.wholeWord,
        regex: find.regex,
        max: MAX_HIGHLIGHTS,
    }
    const results = await runInAllFrames(webContents, args)
    const error = results.find((result) => result.error !== null)?.error ?? null
    if (error !== null) {
        await runFindClear(webContents)
        return { total: 0, activeIndex: -1, error }
    }
    const total = results.reduce((sum, result) => sum + result.total, 0)
    if (total === 0) return { ...EMPTY_STATUS }
    // The first match over all frames is the active one: activate only its frame.
    const activeIndex = 0
    await activateGlobal(
        webContents,
        results.map((result) => result.total),
        activeIndex,
    )
    return { total, activeIndex, error: null }
}

/** Move the active match forward (or backward) and scroll to it. */
export const runFindStep = async (
    webContents: WebContents,
    current: FindStatus,
    forward: boolean,
): Promise<FindStatus> => {
    if (current.total <= 0 || current.activeIndex < 0) return current
    const next = forward
        ? (current.activeIndex + 1) % current.total
        : (current.activeIndex - 1 + current.total) % current.total
    const infos = await runInAllFrames(webContents, { op: "info" })
    if (infos.length === 0) return { ...current, activeIndex: next }
    const totals = infos.map((info) => info.total)
    const total = totals.reduce((sum, entry) => sum + entry, 0)
    if (total === 0) return EMPTY_STATUS
    // The caller stepped against the old total: clamp when the page shrank meanwhile.
    const activeIndex = next % total
    await activateGlobal(webContents, totals, activeIndex)
    return { total, activeIndex, error: null }
}

/** Remove every highlight in every frame. */
export const runFindClear = async (webContents: WebContents): Promise<void> => {
    await runInAllFrames(webContents, { op: "clear" })
}

const activateGlobal = async (
    webContents: WebContents,
    totals: ReadonlyArray<number>,
    activeIndex: number,
): Promise<void> => {
    if (webContents.isDestroyed()) return
    const frames = framesOf(webContents)
    let offset = 0
    const activations = frames.map((frame, index) => {
        const frameTotal = totals[index] ?? 0
        const localActive =
            activeIndex >= offset && activeIndex < offset + frameTotal ? activeIndex - offset : -1
        offset += frameTotal
        return runInFrame(frame, { op: "activate", localActive, scroll: localActive >= 0 })
    })
    await Promise.all(activations)
}
