import { formatIpv4, networkOf } from '../../model/ipv4'
import type { IosDevice, Project } from '../../model/types'
import { computeOspf } from '../../sim/ospf'
import { buildRib, type Route } from '../../sim/rib'

const LEGEND = [
  'Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP',
  '       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area',
  '       N1 - OSPF NSSA external type 1, N2 - OSPF NSSA external type 2',
  '       E1 - OSPF external type 1, E2 - OSPF external type 2, E - EGP',
  '       i - IS-IS, L1 - IS-IS level-1, L2 - IS-IS level-2, ia - IS-IS inter area',
  '       * - candidate default, U - per-user static route, o - ODR',
  '       P - periodic downloaded static route',
  '',
]

/** Prefix length of the classful network an address belongs to. */
function classfulPrefix(ip: number): number {
  const first = Math.floor(ip / 2 ** 24)
  return first < 128 ? 8 : first < 192 ? 16 : 24
}

/** What follows the destination on a route line. */
function routeDetail(r: Route): string {
  if (r.code === 'C' || r.code === 'L') return `is directly connected, ${r.iface}`
  if (r.code === 'O') return `[${r.ad}/${r.metric}] via ${formatIpv4(r.nextHop!)}, 00:00:10, ${r.iface}`
  if (r.nextHop === undefined) return `is directly connected, ${r.iface}`
  return `[${r.ad}/${r.metric}] via ${formatIpv4(r.nextHop)}${r.iface ? `, ${r.iface}` : ''}`
}

export function showIpRoute(project: Project, device: IosDevice): string[] {
  if (!device.running.ipRouting) {
    // A layer 2 switch (or a 3560 without `ip routing`) only has a default gateway.
    return [
      'Default gateway is not set',
      '',
      'Host               Gateway           Last Use    Total Uses  Interface',
      'ICMP redirect cache is empty',
      '',
    ]
  }
  const rib = buildRib(project, device.id).sort((a, b) => a.network - b.network || a.prefix - b.prefix)
  const defaultRoute = rib.find((r) => r.prefix === 0)
  const gateway = defaultRoute
    ? `Gateway of last resort is ${formatIpv4(defaultRoute.nextHop ?? 0)} to network 0.0.0.0`
    : 'Gateway of last resort is not set'
  const out = [...LEGEND, gateway, '']

  // Routes are grouped by classful network, like IOS.
  const groups = new Map<number, Route[]>()
  for (const r of rib) {
    if (r.prefix === 0) continue
    const major = networkOf(r.network, classfulPrefix(r.network))
    groups.set(major, [...(groups.get(major) ?? []), r])
  }
  for (const [major, routes] of groups) {
    const classful = classfulPrefix(major)
    const masks = new Set(routes.map((r) => r.prefix))
    if (routes.length === 1 && routes[0]!.prefix === classful) {
      const r = routes[0]!
      out.push(`${r.code.padEnd(5)}${formatIpv4(r.network)}/${r.prefix} ${routeDetail(r)}`)
      continue
    }
    if (masks.size === 1) {
      out.push(`     ${formatIpv4(major)}/${routes[0]!.prefix} is subnetted, ${routes.length} subnets`)
      for (const r of routes) out.push(`${r.code.padEnd(8)}${formatIpv4(r.network)} ${routeDetail(r)}`)
    } else {
      out.push(`     ${formatIpv4(major)}/${classful} is variably subnetted, ${routes.length} subnets, ${masks.size} masks`)
      for (const r of routes) out.push(`${r.code.padEnd(8)}${formatIpv4(r.network)}/${r.prefix} ${routeDetail(r)}`)
    }
  }
  if (defaultRoute) out.push(`${defaultRoute.code.padEnd(5)}0.0.0.0/0 ${routeDetail(defaultRoute)}`)
  out.push('')
  return out
}

export function showIpOspfNeighbor(project: Project, device: IosDevice): string[] {
  const neighbors = computeOspf(project).neighbors.get(device.id) ?? []
  if (!neighbors.length) return []
  const out = ['', 'Neighbor ID     Pri   State           Dead Time   Address         Interface']
  for (const n of [...neighbors].sort((a, b) => a.routerId - b.routerId)) {
    out.push(
      `${formatIpv4(n.routerId).padEnd(16)}${String(n.priority).padStart(3)}   ${n.state.padEnd(16)}${'00:00:35'.padEnd(12)}${formatIpv4(n.address).padEnd(16)}${n.iface}`,
    )
  }
  return out
}
