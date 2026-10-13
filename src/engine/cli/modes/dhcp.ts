import { maskToPrefix, networkOf, parseIpv4 } from '../../model/ipv4'
import type { DhcpPool } from '../../model/types'
import { exitToConfig } from '../actions'
import { ipv4, word } from '../args'
import { arg, kw } from '../dsl'
import type { CmdNode, ExecCtx } from '../types'

function pool(ctx: ExecCtx): DhcpPool | undefined {
  return ctx.device.running.dhcp.pools.find((p) => p.name === ctx.session.poolContext)
}

/** `ip dhcp …` in global configuration. */
export const ipDhcpNode = kw('dhcp', 'Configure DHCP server and relay parameters', {
  children: [
    kw('pool', 'Configure DHCP address pools', {
      children: [
        arg('name', word(), 'Pool name', {
          run: (ctx, args) => {
            const name = String(args.name)
            const { pools } = ctx.device.running.dhcp
            if (!pools.some((p) => p.name === name)) pools.push({ name })
            ctx.session.mode = 'dhcp-config'
            ctx.session.poolContext = name
          },
          noRun: (ctx, args) => {
            const name = String(args.name)
            const cfg = ctx.device.running.dhcp
            cfg.pools = cfg.pools.filter((p) => p.name !== name)
            // Leases of a removed pool are gone with it.
            ctx.device.runtime.dhcpBindings = ctx.device.runtime.dhcpBindings.filter((b) => b.pool !== name)
          },
        }),
      ],
    }),
    kw('excluded-address', 'Prevent DHCP from assigning certain addresses', {
      children: [
        arg('low', ipv4(), 'Low IP address', {
          run: (ctx, args) => exclude(ctx, String(args.low), String(args.low)),
          noRun: (ctx, args) => include(ctx, String(args.low), String(args.low)),
          children: [
            arg('high', ipv4(), 'High IP address', {
              run: (ctx, args) => exclude(ctx, String(args.low), String(args.high)),
              noRun: (ctx, args) => include(ctx, String(args.low), String(args.high)),
            }),
          ],
        }),
      ],
    }),
  ],
})

function exclude(ctx: ExecCtx, low: string, high: string) {
  if ((parseIpv4(high) ?? 0) < (parseIpv4(low) ?? 0)) return ctx.out('% DHCP excluded-address range is invalid')
  const { excluded } = ctx.device.running.dhcp
  if (!excluded.some((e) => e.low === low && e.high === high)) excluded.push({ low, high })
}

function include(ctx: ExecCtx, low: string, high: string) {
  const cfg = ctx.device.running.dhcp
  cfg.excluded = cfg.excluded.filter((e) => !(e.low === low && e.high === high))
}

/** Sets or clears one address option of the current pool. */
const option = (key: 'defaultRouter' | 'dnsServer', keyword: string, help: string, argHelp: string): CmdNode =>
  kw(keyword, help, {
    noRun: (ctx) => {
      const p = pool(ctx)
      if (p) delete p[key]
    },
    children: [
      arg('address', ipv4(), argHelp, {
        run: (ctx, args) => {
          const p = pool(ctx)
          if (p) p[key] = String(args.address)
        },
      }),
    ],
  })

export const dhcpModeNodes: CmdNode[] = [
  kw('network', 'Network number and mask', {
    noRun: (ctx) => {
      const p = pool(ctx)
      if (!p) return
      delete p.network
      delete p.mask
    },
    children: [
      arg('network', ipv4(), 'Network number in dotted-decimal notation', {
        children: [
          arg('mask', ipv4(), 'Network mask', {
            run: (ctx, args) => {
              const p = pool(ctx)
              const network = parseIpv4(String(args.network))!
              const prefix = maskToPrefix(parseIpv4(String(args.mask))!)
              if (prefix === null || networkOf(network, prefix) !== network) {
                return ctx.out('% Inconsistent address and mask')
              }
              if (!p) return
              p.network = String(args.network)
              p.mask = String(args.mask)
            },
          }),
        ],
      }),
    ],
  }),
  option('defaultRouter', 'default-router', 'Default routers', 'Router\'s IP address'),
  option('dnsServer', 'dns-server', 'Set name server', 'Server\'s IP address'),
  kw('exit', 'Exit from DHCP pool configuration mode', { run: exitToConfig }),
]
