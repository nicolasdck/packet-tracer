import { produce } from 'immer'
import { isHostDevice } from '../model/catalog'
import { formatIpv4, parseIpv4 } from '../model/ipv4'
import type { HostDevice, Project } from '../model/types'
import { ping, traceroute, type PingResult, type TraceHop } from '../sim/ping'

export const HOST_PROMPT = 'C:\\>'

export interface HostResult {
  project: Project
  output: string[]
  /** The screen must be cleared (cls / clear). */
  clear?: boolean
}

function pingOutput(target: string, result: PingResult): string[] {
  const out = ['', `Pinging ${target} with 32 bytes of data:`, '']
  for (const e of result.echoes) {
    if (e.mark === '!') out.push(`Reply from ${formatIpv4(e.from)}: bytes=32 time<1ms TTL=${e.ttl}`)
    else if (e.mark === 'U') out.push(`Reply from ${formatIpv4(e.from)}: Destination host unreachable.`)
    else out.push('Request timed out.')
  }
  const sent = result.echoes.length
  const received = result.echoes.filter((e) => e.mark !== '.').length
  const lost = sent - received
  out.push(
    '',
    `Ping statistics for ${target}:`,
    `    Packets: Sent = ${sent}, Received = ${received}, Lost = ${lost} (${Math.round((lost * 100) / sent)}% loss),`,
  )
  if (result.echoes.some((e) => e.mark === '!')) {
    out.push('Approximate round trip times in milli-seconds:', '    Minimum = 0ms, Maximum = 0ms, Average = 0ms')
  }
  out.push('')
  return out
}

function tracertOutput(target: string, hops: TraceHop[]): string[] {
  const out = ['', `Tracing route to ${target} over a maximum of 30 hops: `, '']
  for (const hop of hops) {
    const cols = hop.probes.map((p) => (p.kind === 'timeout' ? '*' : '0 ms').padEnd(10)).join('')
    const answered = hop.probes.find((p) => p.kind !== 'timeout')
    const text = !answered
      ? 'Request timed out.'
      : answered.kind === 'unreachable'
        ? `${formatIpv4(answered.from)} reports: Destination host unreachable.`
        : formatIpv4(answered.from)
    out.push(`${String(hop.ttl).padStart(3)}   ${cols}${text}`)
  }
  out.push('', 'Trace complete.', '')
  return out
}

function ipconfigOutput(host: HostDevice): string[] {
  return [
    '',
    'FastEthernet0 Connection:(default port)',
    '',
    '   Connection-specific DNS Suffix..: ',
    `   IPv4 Address....................: ${host.net.ip ?? '0.0.0.0'}`,
    `   Subnet Mask.....................: ${host.net.mask ?? '0.0.0.0'}`,
    `   Default Gateway.................: ${host.net.gateway ?? '0.0.0.0'}`,
    '',
  ]
}

/** Runs a command in the PC's command prompt: ping, tracert, ipconfig, cls/clear. */
export function runHostCommand(project: Project, deviceId: string, line: string): HostResult {
  const device = project.devices[deviceId]
  if (!device || !isHostDevice(device)) throw new Error(`Not a host: ${deviceId}`)
  const [command = '', target = '', ...extra] = line.trim().split(/\s+/)
  const cmd = command.toLowerCase()
  if (!cmd) return { project, output: [] }

  if ((cmd === 'cls' || cmd === 'clear') && !target) return { project, output: [], clear: true }

  if (cmd === 'ipconfig' && !target) return { project, output: ipconfigOutput(device) }

  if ((cmd === 'ping' || cmd === 'tracert') && target && !extra.length) {
    const dst = parseIpv4(target)
    if (dst === null) {
      return {
        project,
        output: cmd === 'ping'
          ? [`Ping request could not find host ${target}. Please check the name and try again.`]
          : [`Unable to resolve target system name ${target}.`],
      }
    }
    let output: string[] = []
    // Sending packets fills ARP caches along the path.
    const next = produce(project, (draft) => {
      output = cmd === 'ping'
        ? pingOutput(target, ping(draft, deviceId, dst, 4))
        : tracertOutput(target, traceroute(draft, deviceId, dst, 3))
    })
    return { project: next, output }
  }

  return { project, output: ['Invalid Command.'] }
}
