import { isIosDevice } from '../model/catalog'
import { formatIpv4 } from '../model/ipv4'
import type { Project } from '../model/types'
import { forward, nextHopFor } from './forward'
import type { Packet } from './packet'
import { createRouting, type Routing } from './rib'

/** Initial TTL of packets a device originates. */
function initialTtl(project: Project, deviceId: string): number {
  return isIosDevice(project.devices[deviceId]!) ? 255 : 128
}

/** First source and destination ports of IOS traceroute probes (UDP). */
const TRACE_SOURCE_PORT = 49152
const TRACE_DEST_PORT = 33434

/** '!' reply, '.' timeout, 'U' destination unreachable. */
export type EchoResult = { mark: '!'; ttl: number; from: string } | { mark: 'U'; from: string } | { mark: '.' }

export interface PingResult {
  /** Source address used, null if the device has no route to the destination. */
  source: number | null
  echoes: EchoResult[]
}

/**
 * Sends one packet from `deviceId`, then the answer it triggers back to the
 * sender, and returns what the sender sees.
 */
function probe(project: Project, routing: Routing, deviceId: string, packet: Packet) {
  const d = forward(project, deviceId, packet, routing)
  if (d.kind === 'dropped') return { kind: 'lost' } as const

  // The answer goes to the sender as seen at that point (a NAT address, possibly)
  // and refers to the flow as seen there, so NAT can translate it back.
  const seen = d.packet
  const flow = { proto: seen.proto, id: seen.id }
  const answer: Packet =
    d.kind === 'delivered'
      ? seen.proto === 'icmp'
        ? { src: seen.dst, dst: seen.src, ttl: 0, proto: 'icmp', id: seen.id, icmpType: 'echo-reply' }
        : // A UDP probe reaching its target gets "port unreachable": the target was reached.
          { src: seen.dst, dst: seen.src, ttl: 0, proto: 'icmp', id: seen.id, icmpType: 'unreachable', related: flow }
      : {
          src: d.from,
          dst: d.to,
          ttl: 0,
          proto: 'icmp',
          id: seen.id,
          icmpType: d.kind === 'unreachable' ? 'unreachable' : 'time-exceeded',
          related: flow,
        }
  answer.ttl = initialTtl(project, d.deviceId)
  const back = forward(project, d.deviceId, answer, routing)
  if (back.kind !== 'delivered' || back.deviceId !== deviceId) return { kind: 'lost' } as const
  const from = formatIpv4(back.packet.src)
  if (d.kind === 'delivered') return { kind: 'reply', ttl: back.packet.ttl, from } as const
  return { kind: d.kind === 'unreachable' ? 'unreachable' : 'expired', from } as const
}

/** Sends `count` ICMP echoes. Mutates the project (ARP caches, NAT translations, ACL counters). */
export function ping(project: Project, deviceId: string, dst: number, count: number): PingResult {
  const routing = createRouting(project)
  const hop = nextHopFor(project, deviceId, dst, routing)
  if (!hop) return { source: null, echoes: Array.from({ length: count }, () => ({ mark: '.' as const })) }
  const source = hop.out.ip
  const echoes: EchoResult[] = []
  // IOS sends its echoes back to back, but routers rate-limit ICMP unreachables
  // (one per 500 ms): every other one is missing, hence "U.U.U". A PC waits a
  // second between echoes and gets them all.
  const rateLimited = isIosDevice(project.devices[deviceId]!)
  let suppressNext = false
  for (let i = 0; i < count; i++) {
    const r = probe(project, routing, deviceId, {
      src: source,
      dst,
      ttl: initialTtl(project, deviceId),
      proto: 'icmp',
      id: i + 1,
      icmpType: 'echo',
    })
    if (r.kind === 'reply') echoes.push({ mark: '!', ttl: r.ttl, from: r.from })
    else if (r.kind === 'unreachable' && !suppressNext) echoes.push({ mark: 'U', from: r.from })
    else echoes.push({ mark: '.' })
    suppressNext = rateLimited && r.kind === 'unreachable' && !suppressNext
  }
  return { source, echoes }
}

export type TraceProbe = { kind: 'reply'; from: string } | { kind: 'unreachable'; from: string } | { kind: 'timeout' }

export interface TraceHop {
  ttl: number
  probes: TraceProbe[]
}

/**
 * Traceroute: probes with increasing TTL until the destination answers,
 * a router reports it unreachable, or `maxHops` is reached. IOS probes with
 * UDP, a PC with ICMP echo — access lists tell them apart.
 */
export function traceroute(
  project: Project,
  deviceId: string,
  dst: number,
  probesPerHop: number,
  proto: 'icmp' | 'udp',
  maxHops = 30,
): TraceHop[] {
  const routing = createRouting(project)
  const hop = nextHopFor(project, deviceId, dst, routing)
  const hops: TraceHop[] = []
  let sent = 0
  for (let ttl = 1; ttl <= maxHops; ttl++) {
    const probes: TraceProbe[] = []
    let done = false
    for (let i = 0; i < probesPerHop; i++) {
      if (!hop) {
        probes.push({ kind: 'timeout' })
        continue
      }
      const n = sent++
      const packet: Packet =
        proto === 'icmp'
          ? { src: hop.out.ip, dst, ttl, proto, id: n + 1, icmpType: 'echo' }
          : { src: hop.out.ip, dst, ttl, proto, id: TRACE_SOURCE_PORT + n, dstPort: TRACE_DEST_PORT + n }
      const r = probe(project, routing, deviceId, packet)
      if (r.kind === 'reply') {
        probes.push({ kind: 'reply', from: r.from })
        done = true
      } else if (r.kind === 'expired') {
        probes.push({ kind: 'reply', from: r.from })
      } else if (r.kind === 'unreachable') {
        probes.push({ kind: 'unreachable', from: r.from })
        done = true
      } else {
        probes.push({ kind: 'timeout' })
      }
    }
    hops.push({ ttl, probes })
    if (done) break
  }
  return hops
}

/** Client port of TCP connections opened by hosts. */
const TCP_CLIENT_PORT = 49152
/** A client retransmits its SYN; that also gets past the ARP resolutions on the way. */
const SYN_ATTEMPTS = 3

/**
 * Opens a TCP connection from `deviceId` to `dst`:`port` (SYN there, SYN-ACK
 * back), through routing, access lists and NAT. Returns the device that
 * accepted it, or null. Mutates the project (ARP caches, NAT, ACL counters).
 */
export function tcpConnect(project: Project, deviceId: string, dst: number, port: number): string | null {
  const routing = createRouting(project)
  const hop = nextHopFor(project, deviceId, dst, routing)
  if (!hop) return null
  for (let attempt = 0; attempt < SYN_ATTEMPTS; attempt++) {
    const syn = { src: hop.out.ip, dst, ttl: initialTtl(project, deviceId), proto: 'tcp' as const, id: TCP_CLIENT_PORT, dstPort: port }
    const there = forward(project, deviceId, syn, routing)
    if (there.kind !== 'delivered') continue
    const seen = there.packet
    const synAck = { src: seen.dst, dst: seen.src, ttl: initialTtl(project, there.deviceId), proto: 'tcp' as const, id: port, dstPort: seen.id }
    const back = forward(project, there.deviceId, synAck, routing)
    if (back.kind === 'delivered' && back.deviceId === deviceId) return there.deviceId
  }
  return null
}
