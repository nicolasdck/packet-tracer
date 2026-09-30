import { isHostDevice, isIosDevice } from '../model/catalog'
import { ifMedia, sviVlan } from '../model/ifname'
import { formatIpv4, parseIpv4 } from '../model/ipv4'
import type { ArpEntry, IfName, IosDevice, LinkEnd, MacEntry, Project } from '../model/types'
import { l2Reach, type L2Hop } from './l2'
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
  const reached = l2Reach(project, out.deviceId, out.iface)
  // Only the interface that received the ARP request answers for its own address.
  const target = reached.find((t) =>
    l3Interfaces(project, t.deviceId).some((i) => i.iface === t.iface && i.ip === nextHop),
  )
  const owner = target && l3Interfaces(project, target.deviceId).find((i) => i.iface === target.iface)
  if (!target || !owner) {
    // The broadcast request still teaches every switch where the sender is.
    for (const t of reached) learnPath(project, t.path, out.mac, 'in')
    return { ok: false, reason: 'arp-failed' }
  }
  const to = { deviceId: owner.deviceId, port: owner.iface }

  // Point-to-point serial links need no address resolution.
  if (ifMedia(out.iface) === 'serial') return { ok: true, to }

  const ip = formatIpv4(nextHop)
  const cached = arpTable(project, out.deviceId).find((e) => e.ip === ip)
  if (cached && cached.mac === owner.mac && cached.iface === out.iface) {
    // Unicast frame: switches on the path learn the sender.
    learnPath(project, target.path, out.mac, 'in')
    return { ok: true, to }
  }

  // ARP request (flooded) and reply (unicast back): both ends and the switches learn.
  for (const t of reached) learnPath(project, t.path, out.mac, 'in')
  learnPath(project, target.path, owner.mac, 'out')
  learn(project, out.deviceId, { ip, mac: owner.mac, iface: out.iface })
  learn(project, owner.deviceId, { ip: formatIpv4(out.ip), mac: out.mac, iface: owner.iface })
  const device = project.devices[out.deviceId]!
  return isIosDevice(device) ? { ok: false, reason: 'pending' } : { ok: true, to }
}

/**
 * MAC learning along a layer 2 path: each switch records `mac` on the port the
 * frame came in on (`in` for frames from the source, `out` for frames going back).
 */
function learnPath(project: Project, path: L2Hop[], mac: string, side: 'in' | 'out') {
  for (const hop of path) {
    const port = side === 'in' ? hop.inPort : hop.outPort
    if (sviVlan(port) !== null) continue
    const table: MacEntry[] = (project.devices[hop.deviceId] as IosDevice).runtime.mac
    const entry = { vlan: hop.vlan, mac, port }
    const i = table.findIndex((e) => e.vlan === hop.vlan && e.mac === mac)
    if (i === -1) table.push(entry)
    else table[i] = entry
  }
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
      // Transit: only devices with IP routing forward (not hosts, not a 2960, not a 3560
      // without `ip routing`); they decrement the TTL.
      const device = project.devices[at]!
      if (!isIosDevice(device) || !device.running.ipRouting) return { kind: 'dropped' }
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
