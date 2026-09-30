import { isIosDevice } from '../model/catalog'
import type { Project } from '../model/types'
import { forward, nextHopFor } from './forward'

/** Initial TTL of packets a device originates. */
function initialTtl(project: Project, deviceId: string): number {
  return isIosDevice(project.devices[deviceId]!) ? 255 : 128
}

/** '!' reply, '.' timeout, 'U' destination unreachable. */
export type EchoResult = { mark: '!'; ttl: number; from: number } | { mark: 'U'; from: number } | { mark: '.' }

export interface PingResult {
  /** Source address used, null if the device has no route to the destination. */
  source: number | null
  echoes: EchoResult[]
}

/** Sends one packet from `deviceId` and its answer back, and returns what the sender sees. */
function probe(project: Project, deviceId: string, source: number, dst: number, ttl: number) {
  const d = forward(project, deviceId, { src: source, dst, ttl })
  const answer = (fromDevice: string, from: number) => {
    const back = forward(project, fromDevice, { src: from, dst: source, ttl: initialTtl(project, fromDevice) })
    return back.kind === 'delivered' && back.deviceId === deviceId ? back : null
  }
  switch (d.kind) {
    case 'delivered': {
      const back = answer(d.deviceId, dst)
      return back ? ({ kind: 'reply', ttl: back.ttl, from: dst } as const) : ({ kind: 'lost' } as const)
    }
    case 'unreachable':
      return answer(d.deviceId, d.from) ? ({ kind: 'unreachable', from: d.from } as const) : ({ kind: 'lost' } as const)
    case 'ttl-expired':
      return answer(d.deviceId, d.from) ? ({ kind: 'expired', from: d.from } as const) : ({ kind: 'lost' } as const)
    case 'dropped':
      return { kind: 'lost' } as const
  }
}

/** Sends `count` ICMP echoes. Mutates the project (ARP caches). */
export function ping(project: Project, deviceId: string, dst: number, count: number): PingResult {
  const hop = nextHopFor(project, deviceId, dst)
  if (!hop) return { source: null, echoes: Array.from({ length: count }, () => ({ mark: '.' as const })) }
  const source = hop.out.ip
  const echoes: EchoResult[] = []
  for (let i = 0; i < count; i++) {
    const r = probe(project, deviceId, source, dst, initialTtl(project, deviceId))
    if (r.kind === 'reply') echoes.push({ mark: '!', ttl: r.ttl, from: r.from })
    else if (r.kind === 'unreachable') echoes.push({ mark: 'U', from: r.from })
    else echoes.push({ mark: '.' })
  }
  return { source, echoes }
}

export type TraceProbe = { kind: 'reply'; from: number } | { kind: 'unreachable'; from: number } | { kind: 'timeout' }

export interface TraceHop {
  ttl: number
  probes: TraceProbe[]
}

/**
 * Traceroute: probes with increasing TTL until the destination answers,
 * a router reports it unreachable, or `maxHops` is reached.
 */
export function traceroute(project: Project, deviceId: string, dst: number, probesPerHop: number, maxHops = 30): TraceHop[] {
  const hop = nextHopFor(project, deviceId, dst)
  const hops: TraceHop[] = []
  for (let ttl = 1; ttl <= maxHops; ttl++) {
    const probes: TraceProbe[] = []
    let done = false
    for (let i = 0; i < probesPerHop; i++) {
      if (!hop) {
        probes.push({ kind: 'timeout' })
        continue
      }
      const r = probe(project, deviceId, hop.out.ip, dst, ttl)
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
