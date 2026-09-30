import { isHostDevice, isIosDevice } from '../model/catalog'
import { ifMedia } from '../model/ifname'
import { formatIpv4, parseIpv4 } from '../model/ipv4'
import type { ArpEntry, IfName, LinkEnd, Project } from '../model/types'
import { l2Domain } from './l2'
import { inSubnet, interfaceWithIp, l3Interfaces, type L3Interface } from './l3'
import { buildRib, lookupRoute } from './rib'

/**
 * Packet forwarding. Functions here take a *mutable* project (an Immer draft):
 * sending packets fills ARP caches, like on real devices.
 */

export interface NextHop {
  out: L3Interface
  nextHop: number
}

/** Where a device sends a packet for `dst`, or null if it has no route. */
export function nextHopFor(project: Project, deviceId: string, dst: number): NextHop | null {
  const device = project.devices[deviceId]
  if (!device) return null
  const ifs = l3Interfaces(project, deviceId)

  if (isHostDevice(device)) {
    const nic = ifs[0]
    if (!nic) return null
    if (inSubnet(dst, nic)) return { out: nic, nextHop: dst }
    const gateway = device.net.gateway ? parseIpv4(device.net.gateway) : null
    return gateway !== null && inSubnet(gateway, nic) ? { out: nic, nextHop: gateway } : null
  }

  const route = lookupRoute(buildRib(project, deviceId), dst)
  const out = route && ifs.find((i) => i.iface === route.iface)
  if (!route || !out) return null
  return { out, nextHop: route.nextHop ?? dst }
}

function arpTable(project: Project, deviceId: string): ArpEntry[] {
  const device = project.devices[deviceId]!
  return device.runtime.arp
}

function learn(project: Project, deviceId: string, entry: ArpEntry) {
  const table = arpTable(project, deviceId)
  const i = table.findIndex((e) => e.ip === entry.ip)
  if (i === -1) table.push(entry)
  else table[i] = entry
}

export type Resolution =
  | { ok: true; to: LinkEnd }
  /** `pending`: ARP succeeded but this packet was dropped while resolving. */
  | { ok: false; reason: 'arp-failed' | 'pending' }

/**
 * Finds the neighbor owning `nextHop` on the segment of `out` (ARP).
 * IOS drops the packet that triggers an ARP request; hosts queue it.
 */
export function resolve(project: Project, out: L3Interface, nextHop: number): Resolution {
  const candidates = l2Domain(project, out.deviceId, out.iface)
  // Only the interface that received the ARP request answers for its own address.
  const owner = candidates
    .map((c) => l3Interfaces(project, c.deviceId).find((i) => i.iface === c.port && i.ip === nextHop))
    .find((i) => i !== undefined)
  if (!owner) return { ok: false, reason: 'arp-failed' }
  const to = { deviceId: owner.deviceId, port: owner.iface }

  // Point-to-point serial links need no address resolution.
  if (ifMedia(out.iface) === 'serial') return { ok: true, to }

  const ip = formatIpv4(nextHop)
  const cached = arpTable(project, out.deviceId).find((e) => e.ip === ip)
  if (cached && cached.mac === owner.mac && cached.iface === out.iface) return { ok: true, to }

  // ARP request/reply: both ends learn each other.
  learn(project, out.deviceId, { ip, mac: owner.mac, iface: out.iface })
  learn(project, owner.deviceId, { ip: formatIpv4(out.ip), mac: out.mac, iface: owner.iface })
  const device = project.devices[out.deviceId]!
  return isIosDevice(device) ? { ok: false, reason: 'pending' } : { ok: true, to }
}

export interface Packet {
  src: number
  dst: number
  ttl: number
}

export type Delivery =
  | { kind: 'delivered'; deviceId: string; ttl: number }
  | { kind: 'dropped' }
  /** A router had no route and answers with ICMP unreachable. */
  | { kind: 'unreachable'; deviceId: string; from: number }
  /** TTL expired at a router, which answers with ICMP time exceeded. */
  | { kind: 'ttl-expired'; deviceId: string; from: number }

const MAX_STEPS = 64

/** Forwards a packet originated by `originId` until it is delivered or lost. */
export function forward(project: Project, originId: string, packet: Packet): Delivery {
  let at = originId
  let ingress: IfName | null = null
  let ttl = packet.ttl
  for (let step = 0; step < MAX_STEPS; step++) {
    if (interfaceWithIp(project, at, packet.dst)) return { kind: 'delivered', deviceId: at, ttl }
    // Address of the interface the packet came in on (source of ICMP errors).
    let from: number | undefined
    if (ingress !== null) {
      // Transit: hosts never forward, routers decrement the TTL.
      if (!isIosDevice(project.devices[at]!)) return { kind: 'dropped' }
      from = l3Interfaces(project, at).find((i) => i.iface === ingress)?.ip
      if (from === undefined) return { kind: 'dropped' }
      if (ttl <= 1) return { kind: 'ttl-expired', deviceId: at, from }
      ttl--
    }
    const hop = nextHopFor(project, at, packet.dst)
    if (!hop) return from === undefined ? { kind: 'dropped' } : { kind: 'unreachable', deviceId: at, from }
    const r = resolve(project, hop.out, hop.nextHop)
    if (!r.ok) return { kind: 'dropped' }
    at = r.to.deviceId
    ingress = r.to.port
  }
  return { kind: 'dropped' }
}
