import { produce } from 'immer'
import { isHostDevice } from '../model/catalog'
import { parseIpv4 } from '../model/ipv4'
import type { HostDevice, Project } from '../model/types'
import { dhcpRelease, dhcpRequest } from '../sim/dhcp'
import { formatIpv6, parseIpv6 } from '../model/ipv6'
import { hostAddress } from '../sim/l3'
import { ping, traceroute, type PingResult, type TraceHop } from '../sim/ping'
import { hostV6, ping6, traceroute6 } from '../sim/v6'

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
    if (e.mark === '!') out.push(`Reply from ${e.from}: bytes=32 time<1ms TTL=${e.ttl}`)
    else if (e.mark === 'U') out.push(`Reply from ${e.from}: Destination host unreachable.`)
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
        ? `${answered.from} reports: Destination host unreachable.`
        : answered.from
    out.push(`${String(hop.ttl).padStart(3)}   ${cols}${text}`)
  }
  out.push('', 'Trace complete.', '')
  return out
}

function ipconfigOutput(project: Project, host: HostDevice, all: boolean): string[] {
  const address = hostAddress(host)
  const v6 = hostV6(project, host)
  // Like Windows: the IPv6 gateway first, the IPv4 one below it.
  const v4Gateway = address.gateway ?? '0.0.0.0'
  const gateway =
    v6.gateway === null
      ? [`   Default Gateway.................: ${v4Gateway}`]
      : [`   Default Gateway.................: ${formatIpv6(v6.gateway)}`, `${' '.repeat(37)}${v4Gateway}`]
  return [
    '',
    'FastEthernet0 Connection:(default port)',
    '',
    '   Connection-specific DNS Suffix..: ',
    ...(all
      ? [
          `   Physical Address................: ${host.ports[0]?.mac ?? ''}`,
          `   DHCP Enabled....................: ${host.net.mode === 'dhcp' ? 'Yes' : 'No'}`,
        ]
      : []),
    `   Link-local IPv6 Address.........: ${formatIpv6(v6.linkLocal)}`,
    ...(v6.addresses.length
      ? v6.addresses.map((a) => `   IPv6 Address....................: ${formatIpv6(a.ip)}`)
      : ['   IPv6 Address....................: ::']),
    `   IPv4 Address....................: ${address.ip ?? '0.0.0.0'}`,
    `   Subnet Mask.....................: ${address.mask ?? '0.0.0.0'}`,
    ...gateway,
    ...(all ? [`   DNS Servers.....................: ${address.dns ?? '0.0.0.0'}`] : []),
    '',
  ]
}

/** `ipconfig /renew` and `/release`, only meaningful in DHCP mode. */
function dhcpCommand(project: Project, host: HostDevice, action: 'renew' | 'release'): HostResult {
  if (host.net.mode !== 'dhcp') {
    return { project, output: ['Port is not DHCP enabled, static IP address is configured.'] }
  }
  let ok = false
  const next = produce(project, (draft) => {
    dhcpRelease(draft, host.id)
    if (action === 'renew') ok = dhcpRequest(draft, host.id)
  })
  if (action === 'renew' && !ok) return { project: next, output: ['DHCP request failed. '] }
  return { project: next, output: ipconfigOutput(next, next.devices[host.id] as HostDevice, false) }
}

function arpOutput(host: HostDevice): string[] {
  if (!host.runtime.arp.length) return ['No ARP Entries Found']
  const row = (ip: string, mac: string, type: string) => `  ${ip.padEnd(22)}${mac.padEnd(22)}${type}`
  return [
    row('Internet Address', 'Physical Address', 'Type'),
    ...host.runtime.arp.map((e) => row(e.ip, e.mac, 'dynamic')),
  ]
}

/** Runs a command in the PC's command prompt: ping, tracert, ipconfig [/all|/renew|/release], arp -a/-d, cls/clear. */
export function runHostCommand(project: Project, deviceId: string, line: string): HostResult {
  const device = project.devices[deviceId]
  if (!device || !isHostDevice(device)) throw new Error(`Not a host: ${deviceId}`)
  const [command = '', target = '', ...extra] = line.trim().split(/\s+/)
  const cmd = command.toLowerCase()
  if (!cmd) return { project, output: [] }

  if ((cmd === 'cls' || cmd === 'clear') && !target) return { project, output: [], clear: true }

  if (cmd === 'ipconfig' && !extra.length) {
    const option = target.toLowerCase()
    if (!option) return { project, output: ipconfigOutput(project, device, false) }
    if (option === '/all') return { project, output: ipconfigOutput(project, device, true) }
    if (option === '/renew') return dhcpCommand(project, device, 'renew')
    if (option === '/release') return dhcpCommand(project, device, 'release')
  }

  if (cmd === 'arp' && !extra.length) {
    if (target === '-a') return { project, output: arpOutput(device) }
    if (target === '-d') {
      const next = produce(project, (draft) => {
        draft.devices[deviceId]!.runtime.arp = []
      })
      return { project: next, output: [] }
    }
  }

  if ((cmd === 'ping' || cmd === 'tracert') && target && !extra.length) {
    const dst6 = parseIpv6(target)
    if (dst6 !== null) {
      const text = formatIpv6(dst6)
      let output: string[] = []
      // Sending packets fills neighbor caches along the path.
      const next = produce(project, (draft) => {
        output = cmd === 'ping'
          ? pingOutput(text, ping6(draft, deviceId, dst6, 4))
          : tracertOutput(text, traceroute6(draft, deviceId, dst6, 3))
      })
      return { project: next, output }
    }
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
        : tracertOutput(target, traceroute(draft, deviceId, dst, 3, 'icmp'))
    })
    return { project: next, output }
  }

  return { project, output: ['Invalid Command.'] }
}
