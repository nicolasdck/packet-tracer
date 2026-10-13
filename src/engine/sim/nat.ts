import { formatIpv4, parseIpv4 } from '../model/ipv4'
import type { IosDevice, NatEntry } from '../model/types'
import { aclPermits } from './acl'
import type { Packet } from './packet'

/** First port tried when the original one is already taken on the global address. */
const FIRST_DYNAMIC_PORT = 1024
/** Upper bound on the addresses of a pool (keeps ARP and allocation cheap). */
const MAX_POOL_SIZE = 1024

function poolAddresses(device: IosDevice, name: string): number[] {
  const pool = device.running.nat.pools.find((p) => p.name === name)
  const start = pool ? parseIpv4(pool.start) : null
  const end = pool ? parseIpv4(pool.end) : null
  if (start === null || end === null || end < start) return []
  const out: number[] = []
  for (let ip = start; ip <= end && out.length < MAX_POOL_SIZE; ip++) out.push(ip)
  return out
}

/** Global addresses the router translates to, and therefore answers ARP for. */
export function natGlobals(device: IosDevice): number[] {
  const { nat } = device.running
  const out = nat.statics.flatMap((s) => parseIpv4(s.global) ?? [])
  for (const rule of nat.dynamic) {
    if (rule.pool) out.push(...poolAddresses(device, rule.pool))
  }
  return out
}

/**
 * Inside → outside: rewrites the source address (and the id/port with PAT).
 * Returns false when the packet must be dropped (address pool exhausted).
 */
export function translateOutbound(device: IosDevice, packet: Packet): boolean {
  const { nat } = device.running
  const local = formatIpv4(packet.src)

  const fixed = nat.statics.find((s) => s.local === local)
  if (fixed) {
    packet.src = parseIpv4(fixed.global)!
    return true
  }

  for (const rule of nat.dynamic) {
    if (!aclPermits(device, rule.acl, packet)) continue
    const table = device.runtime.natTranslations
    const candidates = rule.pool
      ? poolAddresses(device, rule.pool)
      : [parseIpv4(device.running.interfaces[rule.iface ?? '']?.ip?.address ?? '') ?? -1].filter((ip) => ip >= 0)
    if (!candidates.length) return false

    if (!rule.overload) {
      // Dynamic NAT: one global address per inside host.
      let entry = table.find((e) => e.proto === undefined && e.insideLocal === local)
      if (!entry) {
        const used = new Set([...table.map((e) => e.insideGlobal), ...nat.statics.map((s) => s.global)])
        const free = candidates.find((ip) => !used.has(formatIpv4(ip)))
        if (free === undefined) return false
        entry = { insideLocal: local, insideGlobal: formatIpv4(free) }
        table.push(entry)
      }
      packet.src = parseIpv4(entry.insideGlobal)!
      return true
    }

    // PAT: many inside hosts share one global address, told apart by id/port.
    const outside = formatIpv4(packet.dst)
    let entry = table.find(
      (e) => e.proto === packet.proto && e.insideLocal === local && e.localId === packet.id && e.outside === outside,
    )
    if (!entry) {
      const insideGlobal = formatIpv4(candidates[0]!)
      const taken = (id: number) =>
        table.some((e) => e.proto === packet.proto && e.insideGlobal === insideGlobal && e.globalId === id)
      let globalId = packet.id
      if (taken(globalId)) {
        globalId = FIRST_DYNAMIC_PORT
        while (taken(globalId)) globalId++
      }
      entry = {
        proto: packet.proto,
        insideLocal: local,
        insideGlobal,
        localId: packet.id,
        globalId,
        outside,
        outsideId: packet.dstPort ?? packet.id,
      }
      table.push(entry)
    }
    packet.src = parseIpv4(entry.insideGlobal)!
    packet.id = entry.globalId!
    return true
  }
  return true
}

function restore(packet: Packet, entry: NatEntry) {
  packet.dst = parseIpv4(entry.insideLocal)!
  if (entry.localId === undefined) return
  if (packet.related) packet.related.id = entry.localId
  else packet.id = entry.localId
}

/** Outside → inside: rewrites the destination back to the inside local address. */
export function translateInbound(device: IosDevice, packet: Packet) {
  const { nat } = device.running
  const global = formatIpv4(packet.dst)

  const fixed = nat.statics.find((s) => s.global === global)
  if (fixed) {
    packet.dst = parseIpv4(fixed.local)!
    return
  }
  // An ICMP error is matched on the flow it reports about.
  const flow = packet.related ?? { proto: packet.proto, id: packet.id }
  const table = device.runtime.natTranslations
  const entry =
    table.find((e) => e.proto === flow.proto && e.insideGlobal === global && e.globalId === flow.id) ??
    table.find((e) => e.proto === undefined && e.insideGlobal === global)
  if (entry) restore(packet, entry)
}
