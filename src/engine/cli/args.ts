import { IF_TYPES, splitIfName } from '../model/ifname'
import { ipv4ValidPrefix, parseIpv4 } from '../model/ipv4'
import type { IfName } from '../model/types'
import type { ArgSpec, MatchResult, NodeCtx } from './types'

/** Length of the longest common prefix between `text` and any candidate. */
function bestPrefix(text: string, candidates: string[]): number {
  let best = 0
  for (const c of candidates) {
    let i = 0
    while (i < text.length && i < c.length && text[i]!.toLowerCase() === c[i]!.toLowerCase()) i++
    best = Math.max(best, i)
  }
  return best
}

export const word = (label = 'WORD'): ArgSpec => ({
  label,
  match: (text) => ({ ok: true, value: text }),
})

export const line = (label = 'LINE'): ArgSpec => ({
  label,
  rest: true,
  match: (text) => ({ ok: true, value: text }),
})

export const int = (min: number, max: number): ArgSpec => ({
  label: `<${min}-${max}>`,
  match: (text) => {
    const bad = text.search(/\D/)
    if (bad !== -1) return { ok: false, offset: bad }
    const n = Number(text)
    return n >= min && n <= max ? { ok: true, value: n } : { ok: false, offset: 0 }
  },
})

export const ipv4 = (label = 'A.B.C.D'): ArgSpec => ({
  label,
  match: (text) =>
    parseIpv4(text) !== null ? { ok: true, value: text } : { ok: false, offset: ipv4ValidPrefix(text) },
})

/** Interfaces of the device (physical and virtual) whose name starts with `typeFull`. */
export function interfacesOfType(c: NodeCtx, typeFull: string): IfName[] {
  return Object.keys(c.device.running.interfaces).filter((n) => splitIfName(n).type.full === typeFull)
}

/** Interface number following a type keyword ("0/1" after "FastEthernet"). */
export const ifNumber = (typeFull: string): ArgSpec => ({
  label: (c) => {
    const slots = interfacesOfType(c, typeFull).map((n) => Number(splitIfName(n).number.split('/')[0]))
    return slots.length ? `<${Math.min(...slots)}-${Math.max(...slots)}>` : '<0-0>'
  },
  match: (text, c): MatchResult => {
    const numbers = interfacesOfType(c, typeFull).map((n) => splitIfName(n).number)
    return numbers.includes(text)
      ? { ok: true, value: typeFull + text }
      : { ok: false, offset: bestPrefix(text, numbers) }
  },
})

/** Interface types present on the device, in IOS order. */
export function deviceIfTypes(c: NodeCtx, includeVirtual: boolean) {
  const present = new Set(Object.keys(c.device.running.interfaces).map((n) => splitIfName(n).type.full))
  return IF_TYPES.filter((t) => present.has(t.full) && (includeVirtual || t.media !== 'virtual'))
}

/**
 * `interface range` list: "fa0/1 - 24", "g0/1-2", "fa0/1 - 2 , fa0/5".
 * Each item is a type prefix, a number and an optional end of range.
 */
export const ifRange = (): ArgSpec => ({
  label: 'LINE',
  rest: true,
  match: (text, c): MatchResult => {
    const names: IfName[] = []
    let offset = 0
    for (const item of text.split(',')) {
      const m = /^(\s*)([a-zA-Z]+)\s*((?:\d+\/)*)(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(item)
      const fail = { ok: false as const, offset: offset + (m?.[1]?.length ?? 0) }
      if (!m) return fail
      const [, , prefix = '', slot = '', firstText = '', lastText] = m
      const types = deviceIfTypes(c, false).filter((t) => t.full.toLowerCase().startsWith(prefix.toLowerCase()))
      if (types.length !== 1) return fail
      const type = types[0]!
      const first = Number(firstText)
      const last = lastText === undefined ? first : Number(lastText)
      if (last < first) return fail
      for (let i = first; i <= last; i++) {
        const name = `${type.full}${slot}${i}`
        if (!c.device.running.interfaces[name]) return fail
        if (!names.includes(name)) names.push(name)
      }
      offset += item.length + 1
    }
    return { ok: true, value: names }
  },
})
