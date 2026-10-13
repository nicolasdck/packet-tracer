import { isIosDevice } from '../model/catalog'
import { maskToPrefix, networkOf, parseIpv4 } from '../model/ipv4'
import type { IfName, Project } from '../model/types'
import { l3Interfaces } from './l3'
import { computeOspf, type OspfState } from './ospf'

export type RouteCode = 'C' | 'L' | 'S' | 'S*' | 'O'

export interface Route {
  code: RouteCode
  network: number
  prefix: number
  iface?: IfName
  nextHop?: number
  /** Administrative distance. */
  ad: number
  metric: number
}

const MAX_RECURSION = 8

/** Longest prefix match. */
export function lookupRoute(rib: Route[], ip: number): Route | undefined {
  let best: Route | undefined
  for (const r of rib) {
    if (networkOf(ip, r.prefix) !== r.network) continue
    if (!best || r.prefix > best.prefix || (r.prefix === best.prefix && r.ad < best.ad)) best = r
  }
  return best
}

/** Keeps, for each prefix, the route with the lowest administrative distance, then metric. */
function selectBest(routes: Route[]): Route[] {
  const best = new Map<string, Route>()
  for (const r of routes) {
    const key = `${r.network}/${r.prefix}`
    const current = best.get(key)
    if (!current || r.ad < current.ad || (r.ad === current.ad && r.metric < current.metric)) best.set(key, r)
  }
  return [...best.values()]
}

/**
 * Routing table of an IOS device: connected (C) and local (L) routes of its up
 * interfaces, plus — when IP routing is on — OSPF (O) and static (S, S*) routes.
 */
export function buildRib(project: Project, deviceId: string, ospf?: OspfState): Route[] {
  const device = project.devices[deviceId]
  if (!device || !isIosDevice(device)) return []
  const ifs = l3Interfaces(project, deviceId)
  const routes: Route[] = []
  for (const l3 of ifs) {
    routes.push({ code: 'C', network: networkOf(l3.ip, l3.prefix), prefix: l3.prefix, iface: l3.iface, ad: 0, metric: 0 })
    if (l3.prefix < 32) routes.push({ code: 'L', network: l3.ip, prefix: 32, iface: l3.iface, ad: 0, metric: 0 })
  }
  if (!device.running.ipRouting) return routes

  if (device.running.ospf) {
    routes.push(...((ospf ?? computeOspf(project)).routes.get(deviceId) ?? []))
  }

  // Static routes are installed only when usable: exit interface up, or next hop
  // reachable through another (non-default) route. Repeat until nothing changes,
  // since a static route can resolve through another one.
  const pending = device.running.staticRoutes.flatMap((s): Route[] => {
    const network = parseIpv4(s.network)
    const mask = parseIpv4(s.mask)
    const prefix = mask === null ? null : maskToPrefix(mask)
    if (network === null || prefix === null) return []
    const nextHop = s.nextHop ? (parseIpv4(s.nextHop) ?? undefined) : undefined
    return [{ code: prefix === 0 ? 'S*' : 'S', network, prefix, iface: s.iface, nextHop, ad: s.distance, metric: 0 }]
  })
  let installed = true
  while (installed) {
    installed = false
    for (const route of [...pending]) {
      const usable = route.iface
        ? ifs.some((i) => i.iface === route.iface)
        : route.nextHop !== undefined && (lookupRoute(routes, route.nextHop)?.prefix ?? 0) > 0
      if (!usable) continue
      routes.push(route)
      pending.splice(pending.indexOf(route), 1)
      installed = true
    }
  }
  return selectBest(routes)
}

/** Exit interface and next-hop address for `dst`, following recursive static routes. */
export function resolveRoute(rib: Route[], dst: number): { iface: IfName; nextHop: number } | null {
  let target = dst
  for (let depth = 0; depth < MAX_RECURSION; depth++) {
    const route = lookupRoute(rib, target)
    if (!route) return null
    if (route.iface) return { iface: route.iface, nextHop: route.nextHop ?? target }
    if (route.nextHop === undefined) return null
    target = route.nextHop
  }
  return null
}

/** Routing tables for one simulation run: OSPF is computed once, tables are memoized. */
export interface Routing {
  rib(deviceId: string): Route[]
  ospf(): OspfState
}

export function createRouting(project: Project): Routing {
  let ospf: OspfState | undefined
  const ribs = new Map<string, Route[]>()
  const getOspf = () => (ospf ??= computeOspf(project))
  return {
    ospf: getOspf,
    rib(deviceId) {
      let rib = ribs.get(deviceId)
      if (!rib) {
        rib = buildRib(project, deviceId, getOspf())
        ribs.set(deviceId, rib)
      }
      return rib
    },
  }
}
