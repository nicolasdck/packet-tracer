/** IPv4 helpers. Addresses are handled as unsigned 32-bit numbers. */

export function parseIpv4(text: string): number | null {
  const parts = text.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n > 255) return null
    value = value * 256 + n
  }
  return value
}

export function formatIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join('.')
}

/**
 * Length of the longest prefix of `text` that can still become a valid IPv4
 * address — used to place IOS's `^` marker.
 */
export function ipv4ValidPrefix(text: string): number {
  let octets = 0
  let digits = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (c >= '0' && c <= '9') {
      digits += c
      if (digits.length > 3 || Number(digits) > 255) return i
    } else if (c === '.') {
      if (!digits || octets === 3) return i
      octets++
      digits = ''
    } else {
      return i
    }
  }
  return text.length
}

/** Prefix length of a contiguous mask, or null if the mask is not contiguous. */
export function maskToPrefix(mask: number): number | null {
  let prefix = 0
  while (prefix < 32 && Math.floor(mask / 2 ** (31 - prefix)) % 2 === 1) prefix++
  return prefixToMask(prefix) === mask ? prefix : null
}

export function prefixToMask(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff - (2 ** (32 - prefix) - 1))
}

export function networkOf(ip: number, prefix: number): number {
  const size = 2 ** (32 - prefix)
  return ip - (ip % size)
}

export function broadcastOf(ip: number, prefix: number): number {
  return networkOf(ip, prefix) + 2 ** (32 - prefix) - 1
}

/** True if the two prefixes share at least one address. */
export function overlaps(ipA: number, prefixA: number, ipB: number, prefixB: number): boolean {
  const p = Math.min(prefixA, prefixB)
  return networkOf(ipA, p) === networkOf(ipB, p)
}

/** "0xFFFFFF00" as printed by IOS in "Bad mask" errors. */
export function maskHex(mask: number): string {
  return '0x' + mask.toString(16).toUpperCase().padStart(8, '0')
}
