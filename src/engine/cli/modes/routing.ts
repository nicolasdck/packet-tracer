import { formatIpv4, maskToPrefix, networkOf, parseIpv4 } from '../../model/ipv4'
import type { StaticRoute } from '../../model/types'
import { exitToConfig, withOspfMessages } from '../actions'
import { int, ipv4 } from '../args'
import { arg, kw } from '../dsl'
import type { Args, CmdNode, ExecCtx, Handler } from '../types'
import { interfaceNodes } from './shared'

// --- static routes --------------------------------------------------------------

function routeFromArgs(args: Args): StaticRoute {
  const route: StaticRoute = {
    network: String(args.network),
    mask: String(args.mask),
    distance: typeof args.distance === 'number' ? args.distance : 1,
  }
  if (typeof args.nexthop === 'string') route.nextHop = args.nexthop
  if (typeof args.if === 'string') route.iface = args.if
  return route
}

const sameTarget = (a: StaticRoute, b: StaticRoute) =>
  a.network === b.network && a.mask === b.mask && a.nextHop === b.nextHop && a.iface === b.iface

const addRoute: Handler = (ctx, args) => {
  const route = routeFromArgs(args)
  const network = parseIpv4(route.network)!
  const prefix = maskToPrefix(parseIpv4(route.mask)!)
  if (prefix === null || networkOf(network, prefix) !== network) {
    return ctx.out('%Inconsistent address and mask')
  }
  const own = Object.values(ctx.device.running.interfaces).some((i) => i.ip?.address === route.nextHop)
  if (route.nextHop && own) return ctx.out("%Invalid next hop address (it's this router)")
  const routes = ctx.device.running.staticRoutes
  const existing = routes.findIndex((r) => sameTarget(r, route))
  if (existing === -1) routes.push(route)
  else routes[existing] = route
}

/** `no ip route <net> <mask>` removes every route to the prefix; with a target, only that one. */
const removeRoute: Handler = (ctx, args) => {
  const route = routeFromArgs(args)
  const specific = route.nextHop !== undefined || route.iface !== undefined
  const cfg = ctx.device.running
  const kept = cfg.staticRoutes.filter((r) =>
    specific ? !sameTarget(r, route) : !(r.network === route.network && r.mask === route.mask),
  )
  if (kept.length === cfg.staticRoutes.length) return ctx.out('%No matching route to delete')
  cfg.staticRoutes = kept
}

const distanceNode = arg('distance', int(1, 255), 'Distance metric for this route', { run: addRoute })
const nextHopNode = arg('nexthop', ipv4(), "Forwarding router's address", {
  run: addRoute,
  noRun: removeRoute,
  children: [distanceNode],
})

export const ipRouteNode = kw('route', 'Establish static routes', {
  children: [
    arg('network', ipv4(), 'Destination prefix', {
      children: [
        arg('mask', ipv4(), 'Destination prefix mask', {
          noRun: removeRoute,
          children: [
            nextHopNode,
            ...interfaceNodes({
              run: addRoute,
              noRun: removeRoute,
              includeVirtual: true,
              children: [nextHopNode, distanceNode],
            }),
          ],
        }),
      ],
    }),
  ],
})

// --- OSPF -------------------------------------------------------------------------

function ospf(ctx: ExecCtx) {
  return ctx.device.running.ospf!
}

/** Runs an OSPF configuration change and reports the adjacencies it creates or breaks. */
const ospfChange = (change: (ctx: ExecCtx, args: Args) => void): Handler => (ctx, args) =>
  withOspfMessages(ctx, () => change(ctx, args))

export const routerNode = kw('router', 'Enable a routing process', {
  when: (c) => c.device.kind !== 'switch-l2',
  children: [
    kw('ospf', 'Open Shortest Path First (OSPF)', {
      children: [
        arg('pid', int(1, 65535), 'Process ID', {
          run: (ctx, args) => {
            const current = ctx.device.running.ospf
            if (current && current.processId !== args.pid) {
              // A real router can run several processes; this simulator keeps one.
              return ctx.out(`% Only one OSPF process is supported (process ${current.processId} is configured)`)
            }
            if (!current) {
              ctx.device.running.ospf = { processId: args.pid as number, networks: [], passiveInterfaces: [] }
            }
            ctx.session.mode = 'config-router'
          },
          noRun: ospfChange((ctx, args) => {
            if (ctx.device.running.ospf?.processId === args.pid) delete ctx.device.running.ospf
          }),
        }),
      ],
    }),
  ],
})

/** Statements are stored the way IOS shows them: address bits covered by the wildcard are cleared. */
function networkStatement(args: Args) {
  const wildcard = parseIpv4(String(args.wildcard))!
  const address = (parseIpv4(String(args.address))! & ~wildcard) >>> 0
  return { address: formatIpv4(address), wildcard: String(args.wildcard), area: args.area as number }
}

export const routerModeNodes: CmdNode[] = [
  kw('network', 'Enable routing on an IP network', {
    children: [
      arg('address', ipv4(), 'Network number', {
        children: [
          arg('wildcard', ipv4(), 'OSPF wild card bits', {
            children: [
              kw('area', 'Set the OSPF area ID', {
                children: [
                  arg('area', int(0, 4294967295), 'OSPF area ID as a decimal value', {
                    run: ospfChange((ctx, args) => {
                      const statement = networkStatement(args)
                      const { networks } = ospf(ctx)
                      const i = networks.findIndex((n) => n.address === statement.address && n.wildcard === statement.wildcard)
                      if (i === -1) networks.push(statement)
                      else networks[i] = statement
                    }),
                    noRun: ospfChange((ctx, args) => {
                      const s = networkStatement(args)
                      const cfg = ospf(ctx)
                      cfg.networks = cfg.networks.filter(
                        (n) => !(n.address === s.address && n.wildcard === s.wildcard && n.area === s.area),
                      )
                    }),
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  }),
  kw('router-id', 'router-id for this OSPF process', {
    noRun: ospfChange((ctx) => {
      delete ospf(ctx).routerId
    }),
    children: [
      arg('id', ipv4(), 'OSPF router-id in IP address format', {
        run: ospfChange((ctx, args) => {
          ospf(ctx).routerId = String(args.id)
          // IOS only applies it after a process restart; the simulator applies it at once.
          ctx.out('Reload or use "clear ip ospf process" command, for this to take effect', '')
        }),
      }),
    ],
  }),
  kw('passive-interface', 'Suppress routing updates on an interface', {
    children: interfaceNodes({
      includeVirtual: true,
      run: ospfChange((ctx, args) => {
        const list = ospf(ctx).passiveInterfaces
        if (!list.includes(args.if as string)) list.push(args.if as string)
      }),
      noRun: ospfChange((ctx, args) => {
        const cfg = ospf(ctx)
        cfg.passiveInterfaces = cfg.passiveInterfaces.filter((n) => n !== args.if)
      }),
    }),
  }),
  kw('exit', 'Exit from routing protocol configuration mode', { run: exitToConfig }),
]
