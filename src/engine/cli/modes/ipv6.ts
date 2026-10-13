import { formatIpv6, isLinkLocal, parseIpv6, parseIpv6Prefix, prefixOf } from '../../model/ipv6'
import type { Ipv6IfConfig, Ipv6StaticRoute } from '../../model/types'
import { int, ipv6, ipv6Prefix } from '../args'
import { arg, kw } from '../dsl'
import type { Args, CmdNode, ExecCtx, Handler, NodeCtx } from '../types'
import { interfaceNodes } from './shared'

// --- interface commands ---------------------------------------------------------

/** IPv6 settings of the interface being configured, created on first use. */
function v6(ctx: ExecCtx): Ipv6IfConfig {
  const cfg = ctx.device.running.interfaces[ctx.session.ifContext[0]!]!
  return (cfg.ipv6 ??= { addresses: [] })
}

/** Drops the IPv6 settings once nothing is configured, which disables IPv6 on the interface. */
function prune(ctx: ExecCtx) {
  const cfg = ctx.device.running.interfaces[ctx.session.ifContext[0]!]!
  const c = cfg.ipv6
  if (c && !c.enabled && !c.linkLocal && !c.addresses.length) delete cfg.ipv6
}

const addAddress = (eui64: boolean): Handler => (ctx, args) => {
  const parsed = parseIpv6Prefix(String(args.prefix))!
  const name = ctx.session.ifContext[0]!
  // With eui-64 only the prefix is kept; the interface ID comes from the MAC.
  const address = formatIpv6(eui64 ? prefixOf(parsed.address, 64) : parsed.address)
  const network = formatIpv6(prefixOf(parsed.address, parsed.length))
  for (const [other, cfg] of Object.entries(ctx.device.running.interfaces)) {
    if (other === name) continue
    const clash = cfg.ipv6?.addresses.some(
      (a) => a.prefix === parsed.length && formatIpv6(prefixOf(parseIpv6(a.address)!, a.prefix)) === network,
    )
    if (clash) {
      const prefix = `${network}/${parsed.length}`
      return ctx.out(`%${name}: Error: ${prefix} is overlapping with ${prefix} on ${other}`)
    }
  }
  const cfg = v6(ctx)
  const entry = { address, prefix: parsed.length, ...(eui64 ? { eui64: true } : {}) }
  cfg.addresses = [...cfg.addresses.filter((a) => !(a.address === address && a.prefix === parsed.length)), entry]
}

const isRouted = (c: NodeCtx) => c.session.ifContext.every((n) => !c.device.running.interfaces[n]?.switchport)

/** `ipv6 …` in interface configuration. */
export const ipv6InterfaceNode = kw('ipv6', 'IPv6 interface subcommands', {
  when: isRouted,
  children: [
    kw('address', 'Configure IPv6 address on interface', {
      noRun: (ctx) => {
        const cfg = v6(ctx)
        cfg.addresses = []
        delete cfg.linkLocal
        prune(ctx)
      },
      children: [
        arg('prefix', ipv6Prefix(), 'IPv6 prefix', {
          run: addAddress(false),
          noRun: (ctx, args) => {
            const parsed = parseIpv6Prefix(String(args.prefix))!
            const cfg = v6(ctx)
            const exact = formatIpv6(parsed.address)
            const prefix = formatIpv6(prefixOf(parsed.address, 64))
            cfg.addresses = cfg.addresses.filter(
              (a) => !(a.prefix === parsed.length && (a.address === exact || (a.eui64 && a.address === prefix))),
            )
            prune(ctx)
          },
          children: [kw('eui-64', 'Use eui-64 interface identifier', { run: addAddress(true) })],
        }),
        arg('address', ipv6(), 'IPv6 link-local address', {
          children: [
            kw('link-local', 'Use link-local address', {
              run: (ctx, args) => {
                const address = parseIpv6(String(args.address))!
                if (!isLinkLocal(address)) return ctx.out('% Invalid link-local address')
                v6(ctx).linkLocal = formatIpv6(address)
              },
              noRun: (ctx) => {
                delete v6(ctx).linkLocal
                prune(ctx)
              },
            }),
          ],
        }),
      ],
    }),
    kw('enable', 'Enable IPv6 on interface', {
      run: (ctx) => {
        v6(ctx).enabled = true
      },
      noRun: (ctx) => {
        delete v6(ctx).enabled
        prune(ctx)
      },
    }),
  ],
})

// --- global commands ------------------------------------------------------------

function routeFrom(args: Args): Ipv6StaticRoute {
  const parsed = parseIpv6Prefix(String(args.prefix))!
  const route: Ipv6StaticRoute = {
    prefix: formatIpv6(prefixOf(parsed.address, parsed.length)),
    length: parsed.length,
    distance: typeof args.distance === 'number' ? args.distance : 1,
  }
  if (typeof args.nexthop === 'string') route.nextHop = formatIpv6(parseIpv6(args.nexthop)!)
  if (typeof args.if === 'string') route.iface = args.if
  return route
}

const sameTarget = (a: Ipv6StaticRoute, b: Ipv6StaticRoute) =>
  a.prefix === b.prefix && a.length === b.length && a.nextHop === b.nextHop && a.iface === b.iface

const addRoute: Handler = (ctx, args) => {
  const route = routeFrom(args)
  if (route.nextHop && !route.iface && isLinkLocal(parseIpv6(route.nextHop)!)) {
    return ctx.out('% Interface has to be specified for a link-local nexthop')
  }
  const cfg = ctx.device.running
  cfg.ipv6StaticRoutes = [...cfg.ipv6StaticRoutes.filter((r) => !sameTarget(r, route)), route]
}

const removeRoute: Handler = (ctx, args) => {
  const route = routeFrom(args)
  const specific = route.nextHop !== undefined || route.iface !== undefined
  const cfg = ctx.device.running
  const kept = cfg.ipv6StaticRoutes.filter((r) =>
    specific ? !sameTarget(r, route) : !(r.prefix === route.prefix && r.length === route.length),
  )
  if (kept.length === cfg.ipv6StaticRoutes.length) return ctx.out('%No matching route to delete')
  cfg.ipv6StaticRoutes = kept
}

const distanceNode = arg('distance', int(1, 254), 'Administrative distance', { run: addRoute })
const nextHopNode = arg('nexthop', ipv6(), 'IPv6 address of next-hop', {
  run: addRoute,
  noRun: removeRoute,
  children: [distanceNode],
})

const canRoute = (c: NodeCtx) => c.device.kind !== 'switch-l2'

/** `ipv6 …` in global configuration. */
export const ipv6GlobalNode: CmdNode = kw('ipv6', 'Global IPv6 configuration commands', {
  when: canRoute,
  children: [
    kw('unicast-routing', 'Enable unicast routing', {
      run: (ctx) => {
        ctx.device.running.ipv6Routing = true
      },
      noRun: (ctx) => {
        ctx.device.running.ipv6Routing = false
      },
    }),
    kw('route', 'Configure static routes', {
      children: [
        arg('prefix', ipv6Prefix(), 'IPv6 prefix', {
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
