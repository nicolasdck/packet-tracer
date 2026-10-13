import { parseIpv4 } from '../../model/ipv4'
import type { NatConfig } from '../../model/types'
import { ipv4, word } from '../args'
import { arg, kw } from '../dsl'
import type { Args, CmdNode, Handler } from '../types'
import { interfaceNodes } from './shared'

type DynamicRule = NatConfig['dynamic'][number]

function ruleFrom(args: Args, overload: boolean): DynamicRule {
  const rule: DynamicRule = { acl: String(args.acl), overload }
  if (typeof args.pool === 'string') rule.pool = args.pool
  if (typeof args.if === 'string') rule.iface = args.if
  return rule
}

/** One translation rule per access list: a new one replaces the previous one. */
const setRule = (overload: boolean): Handler => (ctx, args) => {
  const rule = ruleFrom(args, overload)
  const { nat } = ctx.device.running
  if (rule.pool && !nat.pools.some((p) => p.name === rule.pool)) return ctx.out(`%Pool ${rule.pool} not found`)
  nat.dynamic = [...nat.dynamic.filter((r) => r.acl !== rule.acl), rule]
}

const removeRule: Handler = (ctx, args) => {
  const { nat } = ctx.device.running
  nat.dynamic = nat.dynamic.filter((r) => r.acl !== String(args.acl))
}

/** End of a dynamic rule: `<cr>` or `overload`. */
const ruleEnd = (): Pick<CmdNode, 'run' | 'noRun' | 'children'> => ({
  run: setRule(false),
  noRun: removeRule,
  children: [kw('overload', 'Overload an address translation', { run: setRule(true), noRun: removeRule })],
})

/** `ip nat …` in global configuration. */
export const ipNatNode = kw('nat', 'NAT configuration commands', {
  when: (c) => c.device.kind === 'router',
  children: [
    kw('pool', 'Define pool of addresses', {
      children: [
        arg('name', word(), 'Pool name', {
          noRun: (ctx, args) => {
            const { nat } = ctx.device.running
            if (nat.dynamic.some((r) => r.pool === args.name)) return ctx.out(`%Pool ${String(args.name)} in use, cannot destroy`)
            nat.pools = nat.pools.filter((p) => p.name !== args.name)
          },
          children: [
            arg('start', ipv4(), 'Start IP address', {
              children: [
                arg('end', ipv4(), 'End IP address', {
                  children: [
                    kw('netmask', 'Specify the network mask', {
                      children: [
                        arg('netmask', ipv4(), 'Network mask', {
                          run: (ctx, args) => {
                            if (parseIpv4(String(args.end))! < parseIpv4(String(args.start))!) {
                              return ctx.out('%End address less than start address')
                            }
                            const pool = {
                              name: String(args.name),
                              start: String(args.start),
                              end: String(args.end),
                              netmask: String(args.netmask),
                            }
                            const { nat } = ctx.device.running
                            nat.pools = [...nat.pools.filter((p) => p.name !== pool.name), pool]
                          },
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    }),
    kw('inside', 'Inside address translation', {
      children: [
        kw('source', 'Source address translation', {
          children: [
            kw('static', 'Specify static local->global mapping', {
              children: [
                arg('local', ipv4(), 'Inside local IP address', {
                  children: [
                    arg('global', ipv4(), 'Inside global IP address', {
                      run: (ctx, args) => {
                        const entry = { local: String(args.local), global: String(args.global) }
                        const { nat } = ctx.device.running
                        nat.statics = [
                          ...nat.statics.filter((s) => s.local !== entry.local && s.global !== entry.global),
                          entry,
                        ]
                      },
                      noRun: (ctx, args) => {
                        const { nat } = ctx.device.running
                        nat.statics = nat.statics.filter((s) => !(s.local === args.local && s.global === args.global))
                      },
                    }),
                  ],
                }),
              ],
            }),
            kw('list', 'Specify access list describing local addresses', {
              children: [
                arg('acl', word(), 'Access list number or name for local addresses', {
                  noRun: removeRule,
                  children: [
                    kw('pool', 'Name pool of global addresses', {
                      children: [arg('pool', word(), 'Pool name for global addresses', ruleEnd())],
                    }),
                    kw('interface', 'Specify interface for global address', {
                      children: interfaceNodes({ includeVirtual: false, ...ruleEnd(), run: setRule(false) }),
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    }),
  ],
})
