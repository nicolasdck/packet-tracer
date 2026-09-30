/** VLAN helpers. */

export const MIN_VLAN = 1
export const MAX_VLAN = 4094
/** Reserved legacy VLANs shown by `show vlan brief`, that cannot be deleted. */
export const DEFAULT_VLANS: readonly [number, string][] = [
  [1002, 'fddi-default'],
  [1003, 'token-ring-default'],
  [1004, 'fddinet-default'],
  [1005, 'trnet-default'],
]

export function defaultVlanName(id: number): string {
  return `VLAN${String(id).padStart(4, '0')}`
}

/** "10,20,30-32" → [10, 20, 30, 31, 32]; null if invalid. */
export function parseVlanList(text: string): number[] | null {
  const out = new Set<number>()
  for (const item of text.split(',')) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(item.trim())
    if (!m) return null
    const from = Number(m[1])
    const to = m[2] === undefined ? from : Number(m[2])
    if (from < MIN_VLAN || to > MAX_VLAN || to < from) return null
    for (let v = from; v <= to; v++) out.add(v)
  }
  return [...out].sort((a, b) => a - b)
}

/** [1, 10, 11, 12, 20] → "1,10-12,20" (IOS style). */
export function formatVlanList(vlans: readonly number[]): string {
  const sorted = [...new Set(vlans)].sort((a, b) => a - b)
  const parts: string[] = []
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i]!
    let end = start
    while (sorted[i + 1] === end + 1) end = sorted[++i]!
    parts.push(end > start ? `${start}-${end}` : `${start}`)
  }
  return parts.join(',')
}

export function allVlans(): number[] {
  return Array.from({ length: MAX_VLAN }, (_, i) => i + 1)
}
