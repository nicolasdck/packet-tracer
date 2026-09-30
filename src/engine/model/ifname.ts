import type { IfName } from './types'

export type IfMedia = 'ethernet' | 'serial' | 'virtual'

interface IfType {
  full: string
  short: string
  media: IfMedia
}

export const IF_TYPES: readonly IfType[] = [
  { full: 'GigabitEthernet', short: 'Gi', media: 'ethernet' },
  { full: 'FastEthernet', short: 'Fa', media: 'ethernet' },
  { full: 'Serial', short: 'Se', media: 'serial' },
  { full: 'Vlan', short: 'Vl', media: 'virtual' },
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
