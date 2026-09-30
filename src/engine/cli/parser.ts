import type { ArgValue, Args, CmdNode, Handler, NodeCtx } from './types'

export interface Token {
  text: string
  /** Column of the first character in the input line. */
  start: number
}

export function tokenize(line: string): Token[] {
  const tokens: Token[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) tokens.push({ text: m[0], start: m.index })
  return tokens
}

// --- node availability --------------------------------------------------------

const positiveCache = new WeakMap<CmdNode, boolean>()
const negativeCache = new WeakMap<CmdNode, boolean>()

/** True if some command below this node can run in its positive form. */
function leadsToRun(node: CmdNode): boolean {
  let v = positiveCache.get(node)
  if (v === undefined) {
    positiveCache.set(node, false) // guards against cycles (do/no reuse subtrees)
    v = !!node.run || (node.children ?? []).some(leadsToRun)
    positiveCache.set(node, v)
  }
  return v
}

/** True if some command below this node supports the `no` form. */
function leadsToNo(node: CmdNode): boolean {
  let v = negativeCache.get(node)
  if (v === undefined) {
    negativeCache.set(node, false)
    v = !!node.noRun || (node.children ?? []).some(leadsToNo)
    negativeCache.set(node, v)
  }
  return v
}

/** Marker used by the synthetic `no` node. */
export const NEGATE = Symbol('negate')
type NegatingNode = CmdNode & { [NEGATE]?: true }

function available(children: CmdNode[], c: NodeCtx, negate: boolean): CmdNode[] {
  return children.filter(
    (n) => (!n.when || n.when(c)) && ((n as NegatingNode)[NEGATE] || (negate ? leadsToNo(n) : leadsToRun(n))),
  )
}

// --- token matching -----------------------------------------------------------

function commonPrefix(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i]!.toLowerCase() === b[i]!.toLowerCase()) i++
  return i
}

/** For glue keywords: "g0/0" → key "g", remainder "0/0". */
function splitGlue(text: string): { key: string; rest: string } | null {
  const m = /^([a-zA-Z-]+)(\d.*)$/.exec(text)
  return m ? { key: m[1]!, rest: m[2]! } : null
}

type TokenMatch =
  | { kind: 'match'; node: CmdNode; value?: ArgValue; split?: Token }
  | { kind: 'ambiguous' }
  | { kind: 'none'; offset: number }

function matchToken(nodes: CmdNode[], tok: Token, line: string, c: NodeCtx): TokenMatch {
  const exact: TokenMatch[] = []
  const prefix: TokenMatch[] = []
  let offset = 0

  for (const node of nodes) {
    if (!node.kw) continue
    const kw = node.kw.toLowerCase()
    const glued = node.glue ? splitGlue(tok.text) : null
    const key = (glued?.key ?? tok.text).toLowerCase()
    const split = glued ? { text: glued.rest, start: tok.start + glued.key.length } : undefined
    if (kw === key) exact.push({ kind: 'match', node, split })
    else if (kw.startsWith(key)) prefix.push({ kind: 'match', node, split })
    else offset = Math.max(offset, commonPrefix(kw, key))
  }
  if (exact.length) return exact[0]!
  if (prefix.length === 1) return prefix[0]!
  if (prefix.length > 1) return { kind: 'ambiguous' }

  for (const node of nodes) {
    if (!node.arg) continue
    const text = node.arg.rest ? line.slice(tok.start).trimEnd() : tok.text
    const r = node.arg.match(text, c)
    if (r.ok) return { kind: 'match', node, value: r.value }
    offset = Math.max(offset, r.offset)
  }
  return { kind: 'none', offset }
}

// --- walking ------------------------------------------------------------------

export type WalkError =
  | { error: 'invalid'; col: number; index: number }
  | { error: 'ambiguous'; text: string; index: number }

interface WalkState {
  /** Last matched node, null if no token was consumed. */
  node: CmdNode | null
  /** Children available after the last node. */
  children: CmdNode[]
  args: Args
  negate: boolean
  /** The last node consumed the rest of the line. */
  rest: boolean
}

function walkTokens(roots: CmdNode[], tokens: Token[], line: string, c: NodeCtx): WalkState | WalkError {
  const toks = [...tokens]
  const state: WalkState = { node: null, children: roots, args: {}, negate: false, rest: false }
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i]!
    if (state.rest) break
    const m = matchToken(available(state.children, c, state.negate), tok, line, c)
    if (m.kind === 'none') return { error: 'invalid', col: tok.start + m.offset, index: i }
    if (m.kind === 'ambiguous') {
      return { error: 'ambiguous', text: line.slice(0, tok.start + tok.text.length), index: i }
    }
    const node = m.node
    state.node = node
    if ((node as NegatingNode)[NEGATE]) state.negate = true
    if (m.split) toks.splice(i + 1, 0, m.split)
    if (node.name !== undefined && m.value !== undefined) state.args[node.name] = m.value
    state.rest = !!node.arg?.rest
    state.children = node.children ?? []
  }
  return state
}

function isError(r: WalkState | WalkError): r is WalkError {
  return 'error' in r
}

function handlerOf(state: WalkState): Handler | undefined {
  return state.node ? (state.negate ? state.node.noRun : state.node.run) : undefined
}

export type ParseResult =
  | { ok: true; handler: Handler; args: Args }
  | { ok: false; error: 'incomplete' }
  | ({ ok: false } & WalkError)

export function parse(roots: CmdNode[], line: string, c: NodeCtx): ParseResult {
  const r = walkTokens(roots, tokenize(line), line, c)
  if (isError(r)) return { ok: false, ...r }
  const handler = handlerOf(r)
  return handler ? { ok: true, handler, args: r.args } : { ok: false, error: 'incomplete' }
}

// --- help (?) and completion (Tab) ------------------------------------------------

export type HelpResult =
  | { ok: true; lines: string[] }
  | ({ ok: false } & WalkError)
  | { ok: false; error: 'unrecognized' }

function label(node: CmdNode, c: NodeCtx): string {
  if (node.kw) return node.kw
  const l = node.arg!.label
  return typeof l === 'function' ? l(c) : l
}

function formatHelp(entries: [string, string][]): string[] {
  const width = Math.max(...entries.map(([name]) => name.length))
  return entries.map(([name, help]) => (help ? `  ${name.padEnd(width)}  ${help}` : `  ${name}`))
}

/** Context help for the line typed before `?`. */
export function help(roots: CmdNode[], line: string, c: NodeCtx): HelpResult {
  const tokens = tokenize(line)
  const partial = /\S$/.test(line) ? tokens.pop() : undefined
  const r = walkTokens(roots, tokens, line, c)
  if (isError(r)) return r.index === 0 ? { ok: false, error: 'unrecognized' } : { ok: false, ...r }

  if (r.rest) return { ok: true, lines: formatHelp([['<cr>', '']]) }
  const nodes = available(r.children, c, r.negate)

  if (partial) {
    const text = partial.text.toLowerCase()
    const words = nodes
      .filter((n) => n.kw?.toLowerCase().startsWith(text))
      .map((n) => n.kw!)
      .sort((a, b) => a.localeCompare(b))
    const args = nodes.filter((n) => n.arg && n.arg.match(n.arg.rest ? line.slice(partial.start) : partial.text, c).ok)
    const all = [...args.map((n) => label(n, c)), ...words]
    if (!all.length) {
      return tokens.length === 0
        ? { ok: false, error: 'unrecognized' }
        : { ok: false, error: 'invalid', col: partial.start, index: tokens.length }
    }
    return { ok: true, lines: [all.join('  ')] }
  }

  const args = nodes.filter((n) => n.arg).map((n): [string, string] => [label(n, c), n.help])
  const words = nodes
    .filter((n) => n.kw)
    .map((n): [string, string] => [n.kw!, n.help])
    .sort(([a], [b]) => a.localeCompare(b))
  const entries = [...args, ...words]
  if (handlerOf(r)) entries.push(['<cr>', ''])
  return { ok: true, lines: entries.length ? formatHelp(entries) : [] }
}

/** Tab completion: completes the last keyword if unambiguous, else returns null. */
export function complete(roots: CmdNode[], line: string, c: NodeCtx): string | null {
  if (!/\S$/.test(line)) return null
  const tokens = tokenize(line)
  const partial = tokens.pop()!
  const r = walkTokens(roots, tokens, line, c)
  if (isError(r) || r.rest) return null
  const text = partial.text.toLowerCase()
  const nodes = available(r.children, c, r.negate).filter((n) => n.kw?.toLowerCase().startsWith(text))
  const exact = nodes.find((n) => n.kw!.toLowerCase() === text)
  const pick = exact ?? (nodes.length === 1 ? nodes[0] : undefined)
  return pick ? line.slice(0, partial.start) + pick.kw + ' ' : null
}
