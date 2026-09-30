import { isIosDevice } from '../model/catalog'
import type { IfName, Project } from '../model/types'
import { networkOf } from '../model/ipv4'
import { l3Interfaces } from './l3'

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

/** Routes an IOS device knows: connected (C) and local (L) routes of its up interfaces. */
export function buildRib(project: Project, deviceId: string): Route[] {
  const device = project.devices[deviceId]
  if (!device || !isIosDevice(device)) return []
  const routes: Route[] = []
  for (const l3 of l3Interfaces(project, deviceId)) {
    routes.push({ code: 'C', network: networkOf(l3.ip, l3.prefix), prefix: l3.prefix, iface: l3.iface, ad: 0, metric: 0 })
    if (l3.prefix < 32) routes.push({ code: 'L', network: l3.ip, prefix: 32, iface: l3.iface, ad: 0, metric: 0 })
  }
  return routes
}

/** Longest prefix match. */
export function lookupRoute(rib: Route[], ip: number): Route | undefined {
  let best: Route | undefined
  for (const r of rib) {
    if (networkOf(ip, r.prefix) !== r.network) continue
    if (!best || r.prefix > best.prefix || (r.prefix === best.prefix && r.ad < best.ad)) best = r
  }
  return best
}
