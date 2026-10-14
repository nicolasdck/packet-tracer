import type { IfName } from './types'

export type IfMedia = 'ethernet' | 'serial' | 'virtual' | 'console' | 'wireless'

export interface IfType {
  full: string
  short: string
  media: IfMedia
  /** Default bandwidth (Kbit/s), as shown by show interfaces and used for OSPF cost. */
  bandwidthKbps: number
}

export const IF_TYPES: readonly IfType[] = [
  { full: 'GigabitEthernet', short: 'Gi', media: 'ethernet', bandwidthKbps: 1_000_000 },
  { full: 'FastEthernet', short: 'Fa', media: 'ethernet', bandwidthKbps: 100_000 },
  { full: 'Serial', short: 'Se', media: 'serial', bandwidthKbps: 1544 },
  { full: 'Vlan', short: 'Vl', media: 'virtual', bandwidthKbps: 100_000 },
  // Management ports for the console cable: no data traffic, no interface configuration.
  { full: 'Console', short: 'Con', media: 'console', bandwidthKbps: 0 },
  { full: 'RS232', short: 'RS232', media: 'console', bandwidthKbps: 0 },
  // Home Wi-Fi router: LAN switch ports, Internet (WAN) port, radio slots (one per client).
  { full: 'Ethernet', short: 'Eth', media: 'ethernet', bandwidthKbps: 100_000 },
  { full: 'Internet', short: 'Internet', media: 'ethernet', bandwidthKbps: 100_000 },
  { full: 'Wireless', short: 'Wl', media: 'wireless', bandwidthKbps: 54_000 },
]

/** Splits "GigabitEthernet0/0" into its type and number ("0/0"). */
export function splitIfName(name: IfName): { type: IfType; number: string } {
  for (const type of IF_TYPES) {
    if (name.startsWith(type.full)) return { type, number: name.slice(type.full.length) }
  }
  throw new Error(`Unknown interface name: ${name}`)
}

/** "GigabitEthernet0/0" → "Gi0/0" */
export function shortIfName(name: IfName): string {
  const { type, number } = splitIfName(name)
  return type.short + number
}

export function ifMedia(name: IfName): IfMedia {
  return splitIfName(name).type.media
}

/** "GigabitEthernet0/0.10" → "GigabitEthernet0/0"; physical names are returned unchanged. */
export function parentIf(name: IfName): IfName {
  const dot = name.indexOf('.')
  return dot === -1 ? name : name.slice(0, dot)
}

export function isSubinterface(name: IfName): boolean {
  return name.includes('.')
}

/** "Vlan10" → 10, null for other interfaces. */
export function sviVlan(name: IfName): number | null {
  const m = /^Vlan(\d+)$/.exec(name)
  return m ? Number(m[1]) : null
}
