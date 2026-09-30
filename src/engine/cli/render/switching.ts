import { shortIfName } from '../../model/ifname'
import { formatIpv4, parseIpv4 } from '../../model/ipv4'
import type { IosDevice, Project } from '../../model/types'
import { DEFAULT_VLANS, allVlans, formatVlanList } from '../../model/vlans'
import { l3Interfaces } from '../../sim/l3'
import { interfaceStatus } from '../../sim/linkState'
import { egressTag, operMode, switchPorts } from '../../sim/switching'

const PORTS_PER_LINE = 4

export function showVlanBrief(project: Project, device: IosDevice): string[] {
  const out = [
    'VLAN Name                             Status    Ports',
    '---- -------------------------------- --------- -------------------------------',
  ]
  const accessPorts = switchPorts(device).filter((p) => operMode(project, { deviceId: device.id, port: p }) === 'access')
  const row = (id: number, name: string, ports: string[]) => {
    const head = `${String(id).padEnd(5)}${name.padEnd(33)}${'active'.padEnd(10)}`
    const chunks: string[] = []
    for (let i = 0; i < ports.length; i += PORTS_PER_LINE) chunks.push(ports.slice(i, i + PORTS_PER_LINE).join(', '))
    out.push(head + (chunks[0] ?? ''))
    for (const chunk of chunks.slice(1)) out.push(' '.repeat(48) + chunk)
  }
  const ids = Object.keys(device.running.vlans).map(Number).sort((a, b) => a - b)
  for (const id of ids) {
    const ports = accessPorts
      .filter((p) => device.running.interfaces[p]!.switchport!.accessVlan === id)
      .map(shortIfName)
    row(id, device.running.vlans[id]!.name, ports)
  }
  for (const [id, name] of DEFAULT_VLANS) row(id, name, [])
  return out
}

export function showInterfacesTrunk(project: Project, device: IosDevice): string[] {
  const trunks = switchPorts(device).filter((port) => {
    const end = { deviceId: device.id, port }
    return operMode(project, end) === 'trunk' && interfaceStatus(project, device.id, port).protocol === 'up'
  })
  if (!trunks.length) return []
  const col = (text: string, width: number) => text.padEnd(width)
  const sp = (port: string) => device.running.interfaces[port]!.switchport!
  const out = [`${col('Port', 12)}${col('Mode', 13)}${col('Encapsulation', 15)}${col('Status', 14)}Native vlan`]
  for (const port of trunks) {
    const s = sp(port)
    const mode = s.mode === 'trunk' ? 'on' : 'auto'
    const encap = device.kind === 'switch-l3' && !s.trunkEncapsulation ? 'n-802.1q' : '802.1q'
    out.push(`${col(shortIfName(port), 12)}${col(mode, 13)}${col(encap, 15)}${col('trunking', 14)}${s.nativeVlan}`)
  }
  const section = (title: string, value: (port: string) => string) => {
    out.push('', `${col('Port', 12)}${title}`)
    for (const port of trunks) out.push(`${col(shortIfName(port), 12)}${value(port)}`)
  }
  section('Vlans allowed on trunk', (port) => {
    const allowed = sp(port).allowedVlans
    return allowed === 'all' ? '1-4094' : allowed.length ? formatVlanList(allowed) : 'none'
  })
  const active = (port: string) => {
    const vlans = allVlans().filter((v) => egressTag(project, { deviceId: device.id, port }, v) !== undefined)
    return vlans.length ? formatVlanList(vlans) : 'none'
  }
  section('Vlans allowed and active in management domain', active)
  section('Vlans in spanning tree forwarding state and not pruned', active)
  return out
}

export function showMacAddressTable(device: IosDevice): string[] {
  const out = [
    '          Mac Address Table',
    '-------------------------------------------',
    '',
    'Vlan    Mac Address       Type        Ports',
    '----    -----------       --------    -----',
    '',
  ]
  const entries = [...device.runtime.mac].sort((a, b) => a.vlan - b.vlan || a.mac.localeCompare(b.mac))
  for (const e of entries) {
    out.push(`${String(e.vlan).padStart(4)}    ${e.mac}    DYNAMIC     ${shortIfName(e.port)}`)
  }
  return out
}

export function showArp(project: Project, device: IosDevice): string[] {
  const rows: { ip: number; age: string; mac: string; iface: string }[] = []
  for (const l3 of l3Interfaces(project, device.id)) {
    rows.push({ ip: l3.ip, age: '-', mac: l3.mac, iface: l3.iface })
  }
  for (const e of device.runtime.arp) {
    const ip = parseIpv4(e.ip)
    if (ip !== null && !rows.some((r) => r.ip === ip)) rows.push({ ip, age: '0', mac: e.mac, iface: e.iface })
  }
  rows.sort((a, b) => a.ip - b.ip)
  return [
    'Protocol  Address          Age (min)  Hardware Addr   Type   Interface',
    ...rows.map(
      (r) => `Internet  ${formatIpv4(r.ip).padEnd(17)}${r.age.padStart(9)}   ${r.mac.padEnd(16)}ARPA   ${r.iface}`,
    ),
  ]
}
