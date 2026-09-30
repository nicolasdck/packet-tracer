import { formatIpv4 } from '../../model/ipv4'
import type { PingResult, TraceHop } from '../../sim/ping'

export function iosPingOutput(target: string, result: PingResult): string[] {
  const count = result.echoes.length
  const ok = result.echoes.filter((e) => e.mark === '!').length
  const rate = Math.floor((ok * 100) / count)
  return [
    'Type escape sequence to abort.',
    `Sending ${count}, 100-byte ICMP Echos to ${target}, timeout is 2 seconds:`,
    result.echoes.map((e) => e.mark).join(''),
    ok
      ? `Success rate is ${rate} percent (${ok}/${count}), round-trip min/avg/max = 0/0/0 ms`
      : `Success rate is 0 percent (0/${count})`,
    '',
  ]
}

export function iosTracerouteOutput(target: string, hops: TraceHop[]): string[] {
  const out = ['Type escape sequence to abort.', `Tracing the route to ${target}`, '']
  for (const hop of hops) {
    const parts: string[] = []
    let last: number | null = null
    for (const p of hop.probes) {
      if (p.kind === 'timeout') {
        parts.push('*')
        continue
      }
      if (p.from !== last) parts.push(formatIpv4(p.from))
      last = p.from
      parts.push(p.kind === 'reply' ? '0 msec' : '!H')
    }
    out.push(`${String(hop.ttl).padStart(3)} ${parts.join(' ')}`)
  }
  out.push('')
  return out
}
