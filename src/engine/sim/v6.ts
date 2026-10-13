import { isHostDevice, isIosDevice } from '../model/catalog'
import { ifMedia } from '../model/ifname'
import {
  eui64Address,
  formatIpv6,
  inPrefix,
  isLinkLocal,
  linkLocalOf,
  parseIpv6,
  prefixOf,
} from '../model/ipv6'
import type { HostDevice, IfName, IosDevice, NeighborEntry, Project } from '../model/types'
import { learnPath } from './forward'
import { l2Reach } from './l2'
import { macOf } from './l3'
import { interfaceStatus } from './linkState'
import type { EchoResult, PingResult, TraceHop, TraceProbe } from './ping'

/**
 * IPv6 simulation: interfaces, routing table, neighbor discovery and packet
 * forwarding. Mirrors the IPv4 engine (same layer 2, same first-packet loss
 * while a router resolves a neighbor), without access lists or NAT.
 */

export interface V6Address {
  ip: bigint
  prefix: number
}

/** An interface with IPv6 enabled and line protocol up. */
export interface V6Interface {
  deviceId: string
  iface: IfName
  mac: string
  linkLocal: bigint
  addresses: V6Address[]
}

// --- addresses ------------------------------------------------------------------

export interface HostV6 {
  linkLocal: bigint
  addresses: V6Address[]
  gateway: bigint | null
  /** Where the global address comes from. */
  source: 'static' | 'slaac' | 'none'
}

/**
 * IPv6 addressing of a host. In `auto` mode (SLAAC) the address is built from
 * the /64 prefixes advertised by a router on the link (one with
 * `ipv6 unicast-routing`), which also becomes the default gateway.
 */
export function hostV6(project: Project, host: HostDevice): HostV6 {
  const port = host.ports[0]!
  const linkLocal = linkLocalOf(port.mac)
  const cfg = host.net.ipv6
  if (!cfg) return { linkLocal, addresses: [], gateway: null, source: 'none' }

  if (cfg.mode === 'static') {
    const ip = cfg.address ? parseIpv6(cfg.address) : null
    const gateway = cfg.gateway ? parseIpv6(cfg.gateway) : null
    const addresses = ip === null ? [] : [{ ip, prefix: cfg.prefix ?? 64 }]
    return { linkLocal, addresses, gateway, source: addresses.length ? 'static' : 'none' }
  }

  for (const target of l2Reach(project, host.id, port.name)) {
    const router = project.devices[target.deviceId]
    if (!router || !isIosDevice(router) || !router.running.ipv6Routing) continue
    const advertised = v6Interfaces(project, router.id).find((i) => i.iface === target.iface)
    const prefixes = advertised?.addresses.filter((a) => a.prefix === 64) ?? []
    if (!advertised || !prefixes.length) continue
    return {
      linkLocal,
      addresses: prefixes.map((a) => ({ ip: eui64Address(a.ip, port.mac), prefix: 64 })),
      gateway: advertised.linkLocal,
      source: 'slaac',
    }
  }
  return { linkLocal, addresses: [], gateway: null, source: 'none' }
}

export function v6Interfaces(project: Project, deviceId: string): V6Interface[] {
  const device = project.devices[deviceId]
  if (!device) return []
  const isUp = (iface: IfName) => interfaceStatus(project, deviceId, iface).protocol === 'up'

  if (isHostDevice(device)) {
    const port = device.ports[0]!
    if (!isUp(port.name)) return []
    const info = hostV6(project, device)
    return [{ deviceId, iface: port.name, mac: port.mac, linkLocal: info.linkLocal, addresses: info.addresses }]
  }

  const out: V6Interface[] = []
  for (const iface of Object.keys(device.running.interfaces)) {
    const configured = isUp(iface) ? configuredV6(project, device, iface) : null
    if (configured) out.push({ deviceId, iface, mac: macOf(project, deviceId, iface), ...configured })
  }
  return out
}

/**
 * IPv6 addresses configured on an IOS interface, whatever its state (as listed
 * by `show ipv6 interface brief`); null when IPv6 is not enabled on it.
 */
export function configuredV6(
  project: Project,
  device: IosDevice,
  iface: IfName,
): { linkLocal: bigint; addresses: V6Address[] } | null {
  const cfg = device.running.interfaces[iface]
  if (!cfg?.ipv6 || cfg.switchport) return null
  const mac = macOf(project, device.id, iface)
  const manual = cfg.ipv6.linkLocal ? parseIpv6(cfg.ipv6.linkLocal) : null
  const addresses = cfg.ipv6.addresses.flatMap((a): V6Address[] => {
    const ip = parseIpv6(a.address)
    if (ip === null) return []
    return [{ ip: a.eui64 ? eui64Address(ip, mac) : ip, prefix: a.prefix }]
  })
  return { linkLocal: manual ?? linkLocalOf(mac), addresses }
}

const owns = (i: V6Interface, ip: bigint) => i.linkLocal === ip || i.addresses.some((a) => a.ip === ip)

// --- routing table --------------------------------------------------------------

export interface Route6 {
  code: 'C' | 'L' | 'S'
  prefix: bigint
  length: number
  iface?: IfName
  nextHop?: bigint
  ad: number
}

function lookup6(rib: Route6[], ip: bigint): Route6 | undefined {
  let best: Route6 | undefined
  for (const r of rib) {
    if (!inPrefix(ip, r.prefix, r.length)) continue
    if (!best || r.length > best.length || (r.length === best.length && r.ad < best.ad)) best = r
  }
  return best
}

/** IPv6 routing table of an IOS device: connected, local and usable static routes. */
export function buildRib6(project: Project, deviceId: string): Route6[] {
  const device = project.devices[deviceId]
  if (!device || !isIosDevice(device)) return []
  const ifs = v6Interfaces(project, deviceId)
  const routes: Route6[] = []
  for (const i of ifs) {
    for (const a of i.addresses) {
      routes.push({ code: 'C', prefix: prefixOf(a.ip, a.prefix), length: a.prefix, iface: i.iface, ad: 0 })
      if (a.prefix < 128) routes.push({ code: 'L', prefix: a.ip, length: 128, iface: i.iface, ad: 0 })
    }
  }
  const pending = device.running.ipv6StaticRoutes.flatMap((s): Route6[] => {
    const prefix = parseIpv6(s.prefix)
    if (prefix === null) return []
    const nextHop = s.nextHop ? (parseIpv6(s.nextHop) ?? undefined) : undefined
    return [{ code: 'S', prefix: prefixOf(prefix, s.length), length: s.length, iface: s.iface, nextHop, ad: s.distance }]
  })
  // Like IPv4: a static route is installed once its exit interface is up, or its
  // next hop is reachable through another (non-default) route.
  let installed = true
  while (installed) {
    installed = false
    for (const route of [...pending]) {
      const usable = route.iface
        ? ifs.some((i) => i.iface === route.iface)
        : route.nextHop !== undefined && (lookup6(routes, route.nextHop)?.length ?? 0) > 0
      if (!usable) continue
      routes.push(route)
      pending.splice(pending.indexOf(route), 1)
      installed = true
    }
  }
  const best = new Map<string, Route6>()
  for (const r of routes) {
    const key = `${r.prefix}/${r.length}`
    const current = best.get(key)
    if (!current || r.ad < current.ad) best.set(key, r)
  }
  return [...best.values()]
}

interface NextHop6 {
  out: V6Interface
  nextHop: bigint
}

/**
 * Where a device sends a packet for `dst`. A link-local destination is only
 * reachable on a given link: `via` names the interface (hosts have a single one).
 */
function nextHop6(project: Project, deviceId: string, dst: bigint, via?: IfName): NextHop6 | null {
  const device = project.devices[deviceId]
  if (!device) return null
  const ifs = v6Interfaces(project, deviceId)

  if (isHostDevice(device)) {
    const nic = ifs[0]
    if (!nic) return null
    if (isLinkLocal(dst) || nic.addresses.some((a) => inPrefix(dst, a.ip, a.prefix))) return { out: nic, nextHop: dst }
    const gateway = hostV6(project, device).gateway
    return gateway === null ? null : { out: nic, nextHop: gateway }
  }

  if (isLinkLocal(dst)) {
    const out = ifs.find((i) => i.iface === via)
    return out ? { out, nextHop: dst } : null
  }
  const rib = buildRib6(project, deviceId)
  let target = dst
  for (let depth = 0; depth < 8; depth++) {
    const route = lookup6(rib, target)
    if (!route) return null
    if (route.iface) {
      const out = ifs.find((i) => i.iface === route.iface)
      return out ? { out, nextHop: route.nextHop ?? target } : null
    }
    if (route.nextHop === undefined) return null
    target = route.nextHop
  }
  return null
}

// --- neighbor discovery ---------------------------------------------------------

function learnNeighbor(project: Project, deviceId: string, entry: NeighborEntry) {
  const table = project.devices[deviceId]!.runtime.neighbors
  const i = table.findIndex((e) => e.ip === entry.ip)
  if (i === -1) table.push(entry)
  else table[i] = entry
}

/**
 * Finds the neighbor owning `nextHop` on the link of `out` (Neighbor
 * Solicitation). `source` is the address the solicitation comes from, which the
 * neighbor learns in return. IOS drops the packet that triggers the resolution.
 */
function resolve6(project: Project, out: V6Interface, nextHop: bigint, source: bigint): { deviceId: string; iface: IfName } | null {
  const reached = l2Reach(project, out.deviceId, out.iface)
  if (ifMedia(out.iface) === 'serial') {
    const peer = reached[0]
    return peer ? { deviceId: peer.deviceId, iface: peer.iface } : null
  }
  for (const t of reached) learnPath(project, t.path, out.mac, 'in')
  const target = reached.find((t) =>
    v6Interfaces(project, t.deviceId).some((i) => i.iface === t.iface && owns(i, nextHop)),
  )
  if (!target) return null
  const owner = v6Interfaces(project, target.deviceId).find((i) => i.iface === target.iface)!
  const to = { deviceId: owner.deviceId, iface: owner.iface }

  const ip = formatIpv6(nextHop)
  const cached = project.devices[out.deviceId]!.runtime.neighbors.find((e) => e.ip === ip)
  if (cached && cached.mac === owner.mac && cached.iface === out.iface) return to

  learnPath(project, target.path, owner.mac, 'out')
  learnNeighbor(project, out.deviceId, { ip, mac: owner.mac, iface: out.iface })
  learnNeighbor(project, owner.deviceId, { ip: formatIpv6(source), mac: out.mac, iface: owner.iface })
  return isIosDevice(project.devices[out.deviceId]!) ? null : to
}

// --- forwarding -----------------------------------------------------------------

interface Packet6 {
  src: bigint
  dst: bigint
  hopLimit: number
}

type Delivery6 =
  /** `iface`: interface the packet arrived on (null at the origin). */
  | { kind: 'delivered'; deviceId: string; iface: IfName | null; hopLimit: number }
  | { kind: 'dropped' }
  | { kind: 'unreachable' | 'expired'; deviceId: string; iface: IfName; from: bigint }

const MAX_STEPS = 64

function forward6(project: Project, originId: string, original: Packet6, via?: IfName): Delivery6 {
  let hopLimit = original.hopLimit
  let at = originId
  let ingress: IfName | null = null
  for (let step = 0; step < MAX_STEPS; step++) {
    const ifs = v6Interfaces(project, at)
    const inIf = ingress === null ? undefined : ifs.find((i) => i.iface === ingress)
    if (ingress !== null && !inIf) return { kind: 'dropped' }

    // A link-local address only designates the interface on that link: the one the
    // packet came in on, or at the origin the chosen output interface.
    let mine: boolean
    if (isLinkLocal(original.dst)) {
      const onLink = inIf ?? (via === undefined ? undefined : ifs.find((i) => i.iface === via))
      mine = onLink ? onLink.linkLocal === original.dst : ifs.some((i) => i.linkLocal === original.dst)
    } else {
      mine = ifs.some((i) => i.addresses.some((a) => a.ip === original.dst))
    }
    if (mine) return { kind: 'delivered', deviceId: at, iface: ingress, hopLimit }

    if (inIf) {
      const device = project.devices[at]!
      // Only routers with `ipv6 unicast-routing` forward, and never link-local traffic.
      if (!isIosDevice(device) || !device.running.ipv6Routing || isLinkLocal(original.dst)) return { kind: 'dropped' }
      const from = inIf.addresses[0]?.ip ?? inIf.linkLocal
      if (hopLimit <= 1) return { kind: 'expired', deviceId: at, iface: inIf.iface, from }
      hopLimit--
    }

    const hop = nextHop6(project, at, original.dst, ingress === null ? via : undefined)
    if (!hop) {
      return inIf
        ? { kind: 'unreachable', deviceId: at, iface: inIf.iface, from: inIf.addresses[0]?.ip ?? inIf.linkLocal }
        : { kind: 'dropped' }
    }
    // Routers solicit neighbors from their link-local address, the sender from its own.
    const to = resolve6(project, hop.out, hop.nextHop, ingress === null ? original.src : hop.out.linkLocal)
    if (!to) return { kind: 'dropped' }
    at = to.deviceId
    ingress = to.iface
  }
  return { kind: 'dropped' }
}

const initialHopLimit = (project: Project, deviceId: string) => (isIosDevice(project.devices[deviceId]!) ? 255 : 128)

/** Source address for a destination: link-local on the link, else a global address. */
function sourceFor(project: Project, deviceId: string, out: V6Interface, dst: bigint): bigint {
  if (isLinkLocal(dst)) return out.linkLocal
  const global = out.addresses[0] ?? v6Interfaces(project, deviceId).flatMap((i) => i.addresses)[0]
  return global?.ip ?? out.linkLocal
}

/** One packet and the answer it triggers; returns what the sender sees. */
function probe6(project: Project, deviceId: string, packet: Packet6, via?: IfName) {
  const d = forward6(project, deviceId, packet, via)
  if (d.kind === 'dropped') return { kind: 'lost' } as const
  const from = d.kind === 'delivered' ? packet.dst : d.from
  const answer = { src: from, dst: packet.src, hopLimit: initialHopLimit(project, d.deviceId) }
  const back = forward6(project, d.deviceId, answer, d.iface ?? undefined)
  if (back.kind !== 'delivered' || back.deviceId !== deviceId) return { kind: 'lost' } as const
  const text = formatIpv6(from)
  if (d.kind === 'delivered') return { kind: 'reply', ttl: back.hopLimit, from: text } as const
  return { kind: d.kind, from: text } as const
}

/** Sends `count` ICMPv6 echoes. Mutates the project (neighbor caches). */
export function ping6(project: Project, deviceId: string, dst: bigint, count: number, via?: IfName): PingResult {
  const hop = nextHop6(project, deviceId, dst, via)
  if (!hop) return { source: null, echoes: Array.from({ length: count }, () => ({ mark: '.' as const })) }
  const src = sourceFor(project, deviceId, hop.out, dst)
  const rateLimited = isIosDevice(project.devices[deviceId]!)
  const echoes: EchoResult[] = []
  let suppressNext = false
  for (let i = 0; i < count; i++) {
    const r = probe6(project, deviceId, { src, dst, hopLimit: initialHopLimit(project, deviceId) }, via)
    if (r.kind === 'reply') echoes.push({ mark: '!', ttl: r.ttl, from: r.from })
    else if (r.kind === 'unreachable' && !suppressNext) echoes.push({ mark: 'U', from: r.from })
    else echoes.push({ mark: '.' })
    suppressNext = rateLimited && r.kind === 'unreachable' && !suppressNext
  }
  return { source: null, echoes }
}

export function traceroute6(project: Project, deviceId: string, dst: bigint, probesPerHop: number, maxHops = 30): TraceHop[] {
  const hop = nextHop6(project, deviceId, dst)
  const src = hop ? sourceFor(project, deviceId, hop.out, dst) : 0n
  const hops: TraceHop[] = []
  for (let ttl = 1; ttl <= maxHops; ttl++) {
    const probes: TraceProbe[] = []
    let done = false
    for (let i = 0; i < probesPerHop; i++) {
      const r = hop ? probe6(project, deviceId, { src, dst, hopLimit: ttl }) : ({ kind: 'lost' } as const)
      if (r.kind === 'lost') probes.push({ kind: 'timeout' })
      else if (r.kind === 'unreachable') probes.push({ kind: 'unreachable', from: r.from })
      else probes.push({ kind: 'reply', from: r.from })
      if (r.kind === 'reply' || r.kind === 'unreachable') done = true
    }
    hops.push({ ttl, probes })
    if (done) break
  }
  return hops
}
