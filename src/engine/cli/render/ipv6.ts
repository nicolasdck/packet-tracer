import { shortIfName } from '../../model/ifname'
import { formatIpv6, parseIpv6 } from '../../model/ipv6'
import type { IfConfig, IosConfig, IosDevice, Project } from '../../model/types'
import { interfaceStatus } from '../../sim/linkState'
import { buildRib6, configuredV6, type Route6 } from '../../sim/v6'
import { orderedInterfaces } from './config'

export function showIpv6InterfaceBrief(project: Project, device: IosDevice): string[] {
  const out: string[] = []
  for (const name of orderedInterfaces(device)) {
    if (device.running.interfaces[name]!.switchport) continue
    const st = interfaceStatus(project, device.id, name)
    out.push(`${name.padEnd(27)}[${st.status}/${st.protocol}]`)
    const v6 = configuredV6(project, device, name)
    if (!v6) {
      out.push('    unassigned')
      continue
    }
    out.push(`    ${formatIpv6(v6.linkLocal)}`)
    for (const a of v6.addresses) out.push(`    ${formatIpv6(a.ip)}`)
  }
  return out
}

const ROUTE_LEGEND = [
  'Codes: C - Connected, L - Local, S - Static, U - Per-user Static route',
  '       B - BGP, R - RIP, I1 - ISIS L1, I2 - ISIS L2',
  '       IA - ISIS interarea, IS - ISIS summary, D - EIGRP, EX - EIGRP external',
  '       ND - ND Default, NDp - ND Prefix, DCE - Destination, NDr - Redirect',
  '       O - OSPF Intra, OI - OSPF Inter, OE1 - OSPF ext 1, OE2 - OSPF ext 2',
  '       ON1 - OSPF NSSA ext 1, ON2 - OSPF NSSA ext 2',
]

function via(r: Route6): string {
  if (r.code === 'C') return `via ${r.iface}, directly connected`
  if (r.code === 'L') return `via ${r.iface}, receive`
  if (r.nextHop === undefined) return `via ${r.iface}, directly connected`
  return `via ${formatIpv6(r.nextHop)}${r.iface ? `, ${r.iface}` : ''}`
}

export function showIpv6Route(project: Project, device: IosDevice): string[] {
  const rib = buildRib6(project, device.id).sort((a, b) => (a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : a.length - b.length))
  const lines = rib.flatMap((r) => [
    `${r.code.padEnd(4)}${formatIpv6(r.prefix)}/${r.length} [${r.ad}/0]`,
    `     ${via(r)}`,
  ])
  // The multicast route exists as soon as IPv6 runs on an interface.
  const multicast = rib.length ? ['L   FF00::/8 [0/0]', '     via Null0, receive'] : []
  const count = rib.length + multicast.length / 2
  return [`IPv6 Routing Table - default - ${count} entries`, ...ROUTE_LEGEND, ...lines, ...multicast]
}

export function showIpv6Neighbors(device: IosDevice): string[] {
  const entries = [...device.runtime.neighbors].sort((a, b) => {
    const x = parseIpv6(a.ip) ?? 0n
    const y = parseIpv6(b.ip) ?? 0n
    return x < y ? -1 : x > y ? 1 : 0
  })
  if (!entries.length) return []
  return [
    'IPv6 Address                              Age Link-layer Addr State Interface',
    ...entries.map((e) => `${e.ip.padEnd(42)}${'0'.padStart(3)} ${e.mac.padEnd(15)} REACH ${shortIfName(e.iface)}`),
  ]
}

/** IPv6 lines of an interface in the running-config. */
export function ipv6InterfaceLines(cfg: IfConfig): string[] {
  if (!cfg.ipv6) return []
  const out: string[] = []
  if (cfg.ipv6.linkLocal) out.push(` ipv6 address ${cfg.ipv6.linkLocal} link-local`)
  for (const a of cfg.ipv6.addresses) out.push(` ipv6 address ${a.address}/${a.prefix}${a.eui64 ? ' eui-64' : ''}`)
  if (cfg.ipv6.enabled) out.push(' ipv6 enable')
  return out
}

export function ipv6RouteLines(config: IosConfig): string[] {
  return config.ipv6StaticRoutes.map((r) => {
    const target = [r.iface, r.nextHop].filter(Boolean).join(' ')
    return `ipv6 route ${r.prefix}/${r.length} ${target}${r.distance !== 1 ? ` ${r.distance}` : ''}`
  })
}
