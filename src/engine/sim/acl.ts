import { parseIpv4 } from '../model/ipv4'
import type { AclAddress, AclEntry, IosDevice } from '../model/types'
import type { Packet } from './packet'

function addressMatches(ip: number, spec: AclAddress): boolean {
  const address = parseIpv4(spec.address) ?? 0
  const wildcard = parseIpv4(spec.wildcard) ?? 0
  return ((ip & ~wildcard) >>> 0) === ((address & ~wildcard) >>> 0)
}

function entryMatches(entry: AclEntry, packet: Packet): boolean {
  if (!addressMatches(packet.src, entry.src)) return false
  // Standard lists only look at the source address.
  if (entry.proto === undefined) return true
  if (entry.proto !== 'ip' && entry.proto !== packet.proto) return false
  if (entry.dst && !addressMatches(packet.dst, entry.dst)) return false
  if (entry.srcPort !== undefined && entry.srcPort !== packet.id) return false
  if (entry.dstPort !== undefined && entry.dstPort !== packet.dstPort) return false
  if (entry.icmpType !== undefined && entry.icmpType !== packet.icmpType) return false
  return true
}

/**
 * Evaluates a packet against an access list: first matching entry wins, and a
 * list ends with an implicit deny. A list that does not exist (or is empty)
 * permits everything, like IOS. Counts the match on the device (mutates it).
 */
export function aclPermits(device: IosDevice, name: string | undefined, packet: Packet): boolean {
  if (name === undefined) return true
  const acl = device.running.acls[name]
  if (!acl || !acl.entries.length) return true
  for (const entry of [...acl.entries].sort((a, b) => a.seq - b.seq)) {
    if (!entryMatches(entry, packet)) continue
    const key = `${name}|${entry.seq}`
    device.runtime.aclHits[key] = (device.runtime.aclHits[key] ?? 0) + 1
    return entry.action === 'permit'
  }
  return false
}
