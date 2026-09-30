import { ifMedia, splitIfName } from '../../model/ifname'
import { maskToPrefix, parseIpv4 } from '../../model/ipv4'
import type { IfName, IosDevice, Project } from '../../model/types'
import { macOf } from '../../sim/l3'
import { interfaceStatus } from '../../sim/linkState'
import { orderedInterfaces } from './config'

export function showIpInterfaceBrief(project: Project, device: IosDevice): string[] {
  const row = (n: string, ip: string, ok: string, method: string, status: string, proto: string) =>
    `${n.padEnd(23)}${ip.padEnd(16)}${ok.padEnd(4)}${method.padEnd(7)}${status.padEnd(22)}${proto}`
  const out = [row('Interface', 'IP-Address', 'OK?', 'Method', 'Status', 'Protocol')]
  for (const name of orderedInterfaces(device)) {
    const cfg = device.running.interfaces[name]!
    const st = interfaceStatus(project, device.id, name)
    out.push(row(name, cfg.ip?.address ?? 'unassigned', 'YES', cfg.ip?.method ?? 'unset', st.status, st.protocol))
  }
  return out
}

function hardware(device: IosDevice, name: IfName): string {
  const media = ifMedia(name)
  if (media === 'serial') return 'GT96K Serial'
  if (media === 'virtual') return 'CPU Interface'
  const full = splitIfName(name).type.full
  if (device.kind === 'router') return 'CN Gigabit Ethernet'
  return full === 'GigabitEthernet' ? 'Gigabit Ethernet' : 'Lance'
}

function describeInterface(project: Project, device: IosDevice, name: IfName): string[] {
  const cfg = device.running.interfaces[name]!
  const st = interfaceStatus(project, device.id, name)
  const media = ifMedia(name)
  const isSwitchPort = !!cfg.switchport
  const reason = st.status === 'administratively down'
    ? ' (disabled)'
    : isSwitchPort ? (st.status === 'up' ? ' (connected)' : ' (notconnect)') : ''
  const mac = macOf(project, device.id, name)
  const bw = splitIfName(name).type.bandwidthKbps
  const out = [
    `${name} is ${st.status}, line protocol is ${st.protocol}${reason}`,
    media === 'serial'
      ? `  Hardware is ${hardware(device, name)}`
      : `  Hardware is ${hardware(device, name)}, address is ${mac} (bia ${mac})`,
  ]
  if (cfg.description !== undefined) out.push(`  Description: ${cfg.description}`)
  if (cfg.ip) {
    const prefix = maskToPrefix(parseIpv4(cfg.ip.mask) ?? 0)
    out.push(`  Internet address is ${cfg.ip.address}/${prefix}`)
  }
  out.push(
    `  MTU 1500 bytes, BW ${bw} Kbit, DLY ${media === 'serial' ? 20000 : media === 'virtual' ? 10 : 100} usec,`,
    '     reliability 255/255, txload 1/255, rxload 1/255',
    cfg.encapsulation
      ? `  Encapsulation 802.1Q Virtual LAN, Vlan ID  ${cfg.encapsulation.vlan}.`
      : `  Encapsulation ${media === 'serial' ? 'HDLC' : 'ARPA'}, loopback not set`,
    '  Keepalive set (10 sec)',
  )
  if (media === 'ethernet' && device.ports.some((p) => p.name === name)) {
    const duplex = cfg.duplex === 'full' ? 'Full-duplex' : cfg.duplex === 'half' ? 'Half-duplex' : 'Auto-duplex'
    const speed = cfg.speed === undefined || cfg.speed === 'auto' ? 'Auto Speed' : `${cfg.speed}Mb/s`
    out.push(`  ${duplex}, ${speed}, media type is RJ45`)
  }
  if (media !== 'serial') out.push('  ARP type: ARPA, ARP Timeout 04:00:00')
  out.push(
    '  Last input never, output never, output hang never',
    '  Last clearing of "show interface" counters never',
    '  Input queue: 0/75/0/0 (size/max/drops/flushes); Total output drops: 0',
    '  Queueing strategy: fifo',
    '  Output queue: 0/40 (size/max)',
    '  5 minute input rate 0 bits/sec, 0 packets/sec',
    '  5 minute output rate 0 bits/sec, 0 packets/sec',
    '     0 packets input, 0 bytes, 0 no buffer',
    '     Received 0 broadcasts, 0 runts, 0 giants, 0 throttles',
    '     0 input errors, 0 CRC, 0 frame, 0 overrun, 0 ignored, 0 abort',
    '     0 packets output, 0 bytes, 0 underruns',
    '     0 output errors, 0 collisions, 0 interface resets',
  )
  return out
}

export function showInterfaces(project: Project, device: IosDevice, only?: IfName): string[] {
  const names = only ? [only] : orderedInterfaces(device)
  return names.flatMap((n) => describeInterface(project, device, n))
}
