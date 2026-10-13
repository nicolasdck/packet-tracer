/** IPv6 helpers. Addresses are handled as 128-bit bigints, and stored as text. */

const GROUPS = 8
const FULL = (1n << 128n) - 1n
const LINK_LOCAL = 0xfe80n << 112n

function parseGroups(text: string): bigint[] | null {
  if (text === '') return []
  const out: bigint[] = []
  for (const part of text.split(':')) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null
    out.push(BigInt(`0x${part}`))
  }
  return out
}

/** "2001:db8::1" → bigint, or null if the text is not an IPv6 address. */
export function parseIpv6(text: string): bigint | null {
  const halves = text.split('::')
  if (halves.length > 2) return null
  const head = parseGroups(halves[0]!)
  const tail = halves.length === 2 ? parseGroups(halves[1]!) : []
  if (!head || !tail) return null
  const missing = GROUPS - head.length - tail.length
  // "::" stands for at least one group of zeros; without it all 8 groups are required.
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null
  const groups = [...head, ...Array<bigint>(missing).fill(0n), ...tail]
  return groups.reduce((value, g) => (value << 16n) | g, 0n)
}

/** Canonical text, written the IOS way: upper case, longest run of zero groups as "::". */
export function formatIpv6(value: bigint): string {
  const groups: number[] = []
  for (let i = GROUPS - 1; i >= 0; i--) groups.push(Number((value >> BigInt(i * 16)) & 0xffffn))
  // Longest run of zeros (at least two groups), leftmost when tied.
  let bestStart = -1
  let bestLength = 1
  for (let i = 0; i < GROUPS; i++) {
    if (groups[i] !== 0) continue
    let j = i
    while (j < GROUPS && groups[j] === 0) j++
    if (j - i > bestLength) {
      bestStart = i
      bestLength = j - i
    }
    i = j
  }
  const hex = (g: number) => g.toString(16).toUpperCase()
  if (bestStart === -1) return groups.map(hex).join(':')
  const head = groups.slice(0, bestStart).map(hex).join(':')
  const tail = groups.slice(bestStart + bestLength).map(hex).join(':')
  return `${head}::${tail}`
}

/** "2001:db8:1::1/64" → address and prefix length, or null. */
export function parseIpv6Prefix(text: string): { address: bigint; length: number } | null {
  const slash = text.lastIndexOf('/')
  if (slash === -1) return null
  const address = parseIpv6(text.slice(0, slash))
  const lengthText = text.slice(slash + 1)
  if (address === null || !/^\d{1,3}$/.test(lengthText) || Number(lengthText) > 128) return null
  return { address, length: Number(lengthText) }
}

function mask(length: number): bigint {
  return length === 0 ? 0n : (FULL << BigInt(128 - length)) & FULL
}

/** Network part of an address. */
export function prefixOf(address: bigint, length: number): bigint {
  return address & mask(length)
}

export function inPrefix(address: bigint, prefix: bigint, length: number): boolean {
  return prefixOf(address, length) === prefixOf(prefix, length)
}

export function isLinkLocal(address: bigint): boolean {
  return inPrefix(address, LINK_LOCAL, 10)
}

/**
 * Modified EUI-64 interface identifier of a MAC ("00d0.ba00.0101"):
 * FF:FE inserted in the middle, universal/local bit flipped.
 */
export function eui64(mac: string): bigint {
  const value = BigInt(`0x${mac.replace(/\./g, '')}`)
  const high = (value >> 24n) ^ 0x020000n
  const low = value & 0xffffffn
  return (high << 40n) | (0xfffen << 24n) | low
}

/** Address made of a /64 prefix and the EUI-64 identifier of a MAC. */
export function eui64Address(prefix: bigint, mac: string): bigint {
  return prefixOf(prefix, 64) | eui64(mac)
}

/** Automatic link-local address of an interface: FE80::/64 + EUI-64. */
export function linkLocalOf(mac: string): bigint {
  return LINK_LOCAL | eui64(mac)
}
