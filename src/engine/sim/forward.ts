import { isHostDevice, isIosDevice } from '../model/catalog'
import { ifMedia, sviVlan } from '../model/ifname'
import { formatIpv4, parseIpv4 } from '../model/ipv4'
import type { ArpEntry, IfName, IosDevice, LinkEnd, MacEntry, Project } from '../model/types'
import { aclPermits } from './acl'
import { l2Reach, type L2Hop } from './l2'
import { hostAddress, inSubnet, interfaceWithIp, l3Interfaces, type L3Interface } from './l3'
import { natGlobals, translateInbound, translateOutbound } from './nat'
import type { Packet } from './packet'
import { createRouting, resolveRoute, type Routing } from './rib'

/**
 * Packet forwarding. Functions here take a *mutable* project (an Immer draft):
 * sending packets fills ARP caches, like on real devices.
 */

export interface NextHop {
  out: L3Interface
  nextHop: number
}

/** Where a device sends a packet for `dst`, or null if it has no route. */
export function nextHopFor(
  project: Project,
  deviceId: string,
  dst: number,
  routing: Routing = createRouting(project),
): NextHop | null {
  const device = project.devices[deviceId]
  if (!device) return null
  const ifs = l3Interfaces(project, deviceId)

  if (isHostDevice(device)) {
    const nic = ifs[0]
    if (!nic) return null
    if (inSubnet(dst, nic)) return { out: nic, nextHop: dst }
    const gw = hostAddress(device).gateway
    const gateway = gw ? parseIpv4(gw) : null
    return gateway !== null && inSubnet(gateway, nic) ? { out: nic, nextHop: gateway } : null
  }

  const route = resolveRoute(routing.rib(deviceId), dst)
  const out = route && ifs.find((i) => i.iface === route.iface)
  if (!route || !out) return null
  return { out, nextHop: route.nextHop }
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
  // Point-to-point serial link: no address resolution, everything goes to the other end.
  if (ifMedia(out.iface) === 'serial') {
    const peer = reached[0]
    return peer ? { ok: true, to: { deviceId: peer.deviceId, port: peer.iface } } : { ok: false, reason: 'arp-failed' }
  }
  // Only the interface that received the ARP request answers: for its own address,
  // or for a NAT global address when it is an outside interface.
  const target = reached.find((t) => {
    if (!l3Interfaces(project, t.deviceId).some((i) => i.iface === t.iface)) return false
    if (interfaceWithIp(project, t.deviceId, nextHop)?.iface === t.iface) return true
    const device = project.devices[t.deviceId]!
    return (
      isIosDevice(device) &&
      device.running.interfaces[t.iface]?.nat === 'outside' &&
      natGlobals(device).includes(nextHop)
    )
  })
  const owner = target && l3Interfaces(project, target.deviceId).find((i) => i.iface === target.iface)
  if (!target || !owner) {
    // The broadcast request still teaches every switch where the sender is.
    for (const t of reached) learnPath(project, t.path, out.mac, 'in')
    return { ok: false, reason: 'arp-failed' }
  }
  const to = { deviceId: owner.deviceId, port: owner.iface }

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
export function learnPath(project: Project, path: L2Hop[], mac: string, side: 'in' | 'out') {
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

/**
 * An ICMP error a router sends back: `from` is its address on the interface the
 * packet came in on, `to` the sender as the router saw it, `packet` the packet
 * at that point.
 */
interface IcmpError {
  deviceId: string
  from: number
  to: number
  packet: Packet
}

export type Delivery =
  /** `packet` is the packet as received (after any NAT on the way). */
  | { kind: 'delivered'; deviceId: string; packet: Packet }
  | { kind: 'dropped' }
  /** A router had no route, or an access list denied the packet: ICMP unreachable. */
  | ({ kind: 'unreachable' } & IcmpError)
  /** TTL expired at a router: ICMP time exceeded. */
  | ({ kind: 'ttl-expired' } & IcmpError)

const MAX_STEPS = 64

/**
 * Forwards a packet originated by `originId` until it is delivered or lost.
 * Each router applies, in IOS order: inbound ACL, NAT outside→inside, routing,
 * NAT inside→outside, outbound ACL. Locally originated packets skip ACL and NAT.
 */
export function forward(
  project: Project,
  originId: string,
  original: Packet,
  routing: Routing = createRouting(project),
): Delivery {
  const packet: Packet = { ...original, related: original.related && { ...original.related } }
  let at = originId
  let ingress: IfName | null = null
  for (let step = 0; step < MAX_STEPS; step++) {
    const device = project.devices[at]!
    const ios = isIosDevice(device) ? device : null
    // Interface the packet came in on; its address is the source of ICMP errors.
    const inIf = ingress === null ? undefined : l3Interfaces(project, at).find((i) => i.iface === ingress)
    if (ingress !== null && !inIf) return { kind: 'dropped' }
    const error = (to: number): IcmpError => ({ deviceId: at, from: inIf!.ip, to, packet: { ...packet } })

    if (inIf && ios) {
      const cfg = ios.running.interfaces[inIf.iface]
      if (!aclPermits(ios, cfg?.accessGroup?.in, packet)) return { kind: 'unreachable', ...error(packet.src) }
      if (cfg?.nat === 'outside') translateInbound(ios, packet)
    }

    if (interfaceWithIp(project, at, packet.dst)) return { kind: 'delivered', deviceId: at, packet }

    if (inIf) {
      // Transit: only devices with IP routing forward (not hosts, not a 2960, not a 3560
      // without `ip routing`); they decrement the TTL.
      if (!ios || !ios.running.ipRouting) return { kind: 'dropped' }
      if (packet.ttl <= 1) return { kind: 'ttl-expired', ...error(packet.src) }
      packet.ttl--
    }

    const hop = nextHopFor(project, at, packet.dst, routing)
    if (!hop) return inIf ? { kind: 'unreachable', ...error(packet.src) } : { kind: 'dropped' }

    if (inIf && ios) {
      const sender = packet.src
      const inCfg = ios.running.interfaces[inIf.iface]
      const outCfg = ios.running.interfaces[hop.out.iface]
      if (inCfg?.nat === 'inside' && outCfg?.nat === 'outside' && !translateOutbound(ios, packet)) {
        return { kind: 'dropped' }
      }
      if (!aclPermits(ios, outCfg?.accessGroup?.out, packet)) return { kind: 'unreachable', ...error(sender) }
    }

    const r = resolve(project, hop.out, hop.nextHop)
    if (!r.ok) return { kind: 'dropped' }
    at = r.to.deviceId
    ingress = r.to.port
  }
  return { kind: 'dropped' }
}
