import type { Acl, AclAddress, AclEntry, IosDevice } from '../../model/types'

/** Well-known ports IOS prints (and accepts) by name. */
export const PORT_NAMES: Record<string, number> = {
  'ftp-data': 20,
  ftp: 21,
  telnet: 23,
  smtp: 25,
  domain: 53,
  tftp: 69,
  www: 80,
  pop3: 110,
}

const portName = (port: number) => Object.keys(PORT_NAMES).find((n) => PORT_NAMES[n] === port) ?? String(port)

const isAny = (a: AclAddress) => a.wildcard === '255.255.255.255'
const isHost = (a: AclAddress) => a.wildcard === '0.0.0.0'

/** Address as written in a command: "any", "host A", "A W". */
function address(a: AclAddress): string {
  if (isAny(a)) return 'any'
  return isHost(a) ? `host ${a.address}` : `${a.address} ${a.wildcard}`
}

/** Entry as typed (and as shown in the running-config), without sequence number. */
export function entryText(entry: AclEntry): string {
  if (entry.proto === undefined) {
    // Standard lists write a host without the keyword.
    return `${entry.action} ${isHost(entry.src) ? entry.src.address : address(entry.src)}`
  }
  const port = (p?: number) => (p === undefined ? '' : ` eq ${portName(p)}`)
  const icmp = entry.icmpType ? ` ${entry.icmpType}` : ''
  return `${entry.action} ${entry.proto} ${address(entry.src)}${port(entry.srcPort)} ${address(entry.dst!)}${port(entry.dstPort)}${icmp}`
}

/** Entry as listed by `show access-lists`. */
function entryListing(entry: AclEntry): string {
  if (entry.proto === undefined && !isAny(entry.src) && !isHost(entry.src)) {
    return `${entry.action} ${entry.src.address}, wildcard bits ${entry.src.wildcard}`
  }
  return entryText(entry)
}

const sorted = (acl: Acl) => [...acl.entries].sort((a, b) => a.seq - b.seq)
/** Numbered lists come first, in numeric order, then named lists alphabetically. */
export function orderedAcls(device: IosDevice): Acl[] {
  const isNumber = (a: Acl) => /^\d+$/.test(a.name)
  return Object.values(device.running.acls).sort((a, b) =>
    isNumber(a) && isNumber(b)
      ? Number(a.name) - Number(b.name)
      : isNumber(a) !== isNumber(b)
        ? Number(isNumber(b)) - Number(isNumber(a))
        : a.name.localeCompare(b.name),
  )
}

export function showAccessLists(device: IosDevice, only?: string): string[] {
  const out: string[] = []
  for (const acl of orderedAcls(device)) {
    if (only !== undefined && acl.name !== only) continue
    out.push(`${acl.type === 'standard' ? 'Standard' : 'Extended'} IP access list ${acl.name}`)
    for (const entry of sorted(acl)) {
      const hits = device.runtime.aclHits[`${acl.name}|${entry.seq}`] ?? 0
      const count = hits ? ` (${hits} ${hits === 1 ? 'match' : 'matches'})` : ''
      out.push(`    ${entry.seq} ${entryListing(entry)}${count}`)
    }
  }
  return out
}

/** Access lists as they appear in the running-config. */
export function aclConfigLines(acls: Acl[]): string[] {
  const out: string[] = []
  for (const acl of acls) {
    if (/^\d+$/.test(acl.name)) {
      for (const entry of sorted(acl)) out.push(`access-list ${acl.name} ${entryText(entry)}`)
    } else {
      out.push(`ip access-list ${acl.type} ${acl.name}`)
      for (const entry of sorted(acl)) out.push(` ${entryText(entry)}`)
    }
  }
  return out
}
