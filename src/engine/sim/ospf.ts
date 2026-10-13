import { isIosDevice } from '../model/catalog'
import { ifMedia, parentIf, splitIfName } from '../model/ifname'
import { networkOf, parseIpv4 } from '../model/ipv4'
import type { IfName, IosDevice, Project } from '../model/types'
import { l2Reach } from './l2'
import { l3Interfaces, type L3Interface } from './l3'
import type { Route } from './rib'

/** Reference bandwidth for the cost: 10^8 bit/s = 100 000 Kbit/s. */
const REFERENCE_KBPS = 100_000
export const OSPF_DISTANCE = 110

export interface OspfNeighbor {
  deviceId: string
  routerId: number
  /** Address of the neighbor's interface. */
  address: number
  /** Local interface the neighbor is seen on. */
  iface: IfName
  priority: number
  /** As printed by `show ip ospf neighbor`: "FULL/DR", "FULL/  -"… */
  state: string
}

export interface OspfState {
  routerIds: Map<string, number>
  neighbors: Map<string, OspfNeighbor[]>
  /** Best OSPF route to every network learned from other routers. */
  routes: Map<string, Route[]>
}

interface OspfInterface {
  l3: L3Interface
  area: number
  cost: number
  passive: boolean
}

interface OspfRouter {
  device: IosDevice
  routerId: number
  interfaces: OspfInterface[]
}

export function ospfCost(iface: IfName): number {
  const bandwidth = splitIfName(parentIf(iface)).type.bandwidthKbps
  return Math.max(1, Math.floor(REFERENCE_KBPS / bandwidth))
}

/** True if `ip` is covered by a `network <address> <wildcard>` statement. */
function matches(ip: number, address: number, wildcard: number): boolean {
  return ((ip & ~wildcard) >>> 0) === ((address & ~wildcard) >>> 0)
}

function ospfRouters(project: Project): OspfRouter[] {
  const routers: OspfRouter[] = []
  for (const device of Object.values(project.devices)) {
    if (!isIosDevice(device)) continue
    const cfg = device.running.ospf
    if (!cfg || !device.running.ipRouting) continue
    const ifs = l3Interfaces(project, device.id)
    // Router ID: configured, else the highest address of an active interface.
    const configured = cfg.routerId ? parseIpv4(cfg.routerId) : null
    const routerId = configured ?? (ifs.length ? Math.max(...ifs.map((i) => i.ip)) : null)
    if (routerId === null) continue
    const interfaces: OspfInterface[] = []
    for (const l3 of ifs) {
      const statement = cfg.networks.find((n) => matches(l3.ip, parseIpv4(n.address) ?? 0, parseIpv4(n.wildcard) ?? 0))
      if (!statement) continue
      interfaces.push({
        l3,
        area: statement.area,
        cost: ospfCost(l3.iface),
        passive: cfg.passiveInterfaces.includes(l3.iface),
      })
    }
    routers.push({ device, routerId, interfaces })
  }
  return routers
}

interface Adjacency {
  to: OspfRouter
  local: OspfInterface
  remote: OspfInterface
}

/**
 * Neighbors of a router: routers reached at layer 2 on an OSPF interface, in
 * the same subnet and area, with neither side passive.
 */
function adjacencies(project: Project, router: OspfRouter, byId: Map<string, OspfRouter>): Adjacency[] {
  const out: Adjacency[] = []
  for (const local of router.interfaces) {
    if (local.passive) continue
    for (const target of l2Reach(project, router.device.id, local.l3.iface)) {
      const to = byId.get(target.deviceId)
      const remote = to?.interfaces.find((i) => i.l3.iface === target.iface)
      if (!to || !remote || remote.passive || to.routerId === router.routerId) continue
      const sameSubnet =
        remote.l3.prefix === local.l3.prefix &&
        networkOf(remote.l3.ip, remote.l3.prefix) === networkOf(local.l3.ip, local.l3.prefix)
      if (sameSubnet && remote.area === local.area) out.push({ to, local, remote })
    }
  }
  return out
}

/** Neighbor states, with DR/BDR election on multi-access segments (highest router ID wins). */
function neighborList(router: OspfRouter, adj: Adjacency[]): OspfNeighbor[] {
  return adj.map(({ to, local, remote }) => {
    const base = { deviceId: to.device.id, routerId: to.routerId, address: remote.l3.ip, iface: local.l3.iface }
    if (ifMedia(local.l3.iface) === 'serial') return { ...base, priority: 0, state: 'FULL/  -' }
    const segment = [router.routerId, ...adj.filter((a) => a.local === local).map((a) => a.to.routerId)]
    const [dr, bdr] = [...segment].sort((a, b) => b - a)
    const role = (id: number) => (id === dr ? 'DR' : id === bdr ? 'BDR' : 'DROTHER')
    const mine = role(router.routerId)
    const theirs = role(to.routerId)
    // Two DROTHERs stay in 2WAY: they only synchronize with the DR and BDR.
    const state = mine === 'DROTHER' && theirs === 'DROTHER' ? '2WAY' : 'FULL'
    return { ...base, priority: 1, state: `${state}/${theirs}` }
  })
}

/** Shortest paths from `source`: distance and first hop to every reachable router. */
function shortestPaths(source: OspfRouter, adj: Map<string, Adjacency[]>) {
  const dist = new Map<string, number>([[source.device.id, 0]])
  const firstHop = new Map<string, Adjacency>()
  const done = new Set<string>()
  for (;;) {
    let current: string | undefined
    for (const [id, d] of dist) {
      if (!done.has(id) && (current === undefined || d < dist.get(current)!)) current = id
    }
    if (current === undefined) break
    done.add(current)
    for (const edge of adj.get(current) ?? []) {
      const id = edge.to.device.id
      const d = dist.get(current)! + edge.local.cost
      if (d < (dist.get(id) ?? Infinity)) {
        dist.set(id, d)
        firstHop.set(id, current === source.device.id ? edge : firstHop.get(current)!)
      }
    }
  }
  return { dist, firstHop }
}

/** Runs OSPF for the whole network. Pure: derived from configuration and link state. */
export function computeOspf(project: Project): OspfState {
  const routers = ospfRouters(project)
  const byId = new Map(routers.map((r) => [r.device.id, r]))
  const adj = new Map(routers.map((r) => [r.device.id, adjacencies(project, r, byId)]))
  const state: OspfState = { routerIds: new Map(), neighbors: new Map(), routes: new Map() }

  for (const router of routers) {
    const id = router.device.id
    state.routerIds.set(id, router.routerId)
    state.neighbors.set(id, neighborList(router, adj.get(id)!))

    const { dist, firstHop } = shortestPaths(router, adj)
    const best = new Map<string, Route>()
    for (const other of routers) {
      const hop = firstHop.get(other.device.id)
      if (!hop) continue
      for (const i of other.interfaces) {
        const network = networkOf(i.l3.ip, i.l3.prefix)
        const metric = dist.get(other.device.id)! + i.cost
        const key = `${network}/${i.l3.prefix}`
        if (metric < (best.get(key)?.metric ?? Infinity)) {
          best.set(key, {
            code: 'O',
            network,
            prefix: i.l3.prefix,
            iface: hop.local.l3.iface,
            nextHop: hop.remote.l3.ip,
            ad: OSPF_DISTANCE,
            metric,
          })
        }
      }
    }
    state.routes.set(id, [...best.values()])
  }
  return state
}
