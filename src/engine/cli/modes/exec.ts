import { endSession, saveConfig } from '../actions'
import { parseIpv4 } from '../../model/ipv4'
import { formatIpv6, isLinkLocal, parseIpv6 } from '../../model/ipv6'
import { ping6, traceroute6 } from '../../sim/v6'
import { ping, traceroute } from '../../sim/ping'
import { ipv4, ipv6, word } from '../args'
import { arg, kw } from '../dsl'
import { iosPingOutput, iosTracerouteOutput } from '../render/ping'
import { isConfigModified, showRunningConfig, showStartupConfig } from '../render/config'
import { showInterfaces, showIpInterfaceBrief } from '../render/interfaces'
import { showAccessLists } from '../render/acl'
import { showIpv6InterfaceBrief, showIpv6Neighbors, showIpv6Route } from '../render/ipv6'
import { showIpOspfNeighbor, showIpRoute } from '../render/routing'
import { showIpDhcpBinding, showIpNatTranslations } from '../render/services'
import { showArp, showInterfacesTrunk, showMacAddressTable, showVlanBrief } from '../render/switching'
import { showVersion } from '../render/version'
import type { CmdNode, Handler, NodeCtx } from '../types'
import { interfaceNodes } from './shared'
import { showIpSsh } from './ssh'

const isSwitch = (c: NodeCtx) => c.device.kind !== 'router'
const arpNode = (help: string) => kw('arp', help, { run: (ctx) => ctx.out(...showArp(ctx.project, ctx.device)) })
const macTable: Handler = (ctx) => ctx.out(...showMacAddressTable(ctx.device))

function showNodes(privileged: boolean): CmdNode {
  const children: CmdNode[] = [
    kw('version', 'System hardware and software status', {
      run: (ctx) => ctx.out(...showVersion(ctx.device)),
    }),
    kw('access-lists', 'List access lists', {
      run: (ctx) => ctx.out(...showAccessLists(ctx.device)),
      children: [
        arg('name', word(), 'ACL name or number', {
          run: (ctx, args) => ctx.out(...showAccessLists(ctx.device, String(args.name))),
        }),
      ],
    }),
    arpNode('ARP table'),
    kw('mac', 'MAC configuration', {
      when: isSwitch,
      children: [kw('address-table', 'MAC forwarding table', { run: macTable })],
    }),
    kw('mac-address-table', 'MAC forwarding table', { when: isSwitch, run: macTable }),
    kw('vlan', 'VTP VLAN status', {
      when: isSwitch,
      children: [
        kw('brief', 'VTP all VLAN status in brief', {
          run: (ctx) => ctx.out(...showVlanBrief(ctx.project, ctx.device)),
        }),
      ],
    }),
    kw('ipv6', 'IPv6 information', {
      children: [
        kw('interface', 'IPv6 interface status and configuration', {
          children: [
            kw('brief', 'Brief summary of IPv6 status and configuration', {
              run: (ctx) => ctx.out(...showIpv6InterfaceBrief(ctx.project, ctx.device)),
            }),
          ],
        }),
        kw('neighbors', 'Show IPv6 neighbor cache entries', {
          run: (ctx) => ctx.out(...showIpv6Neighbors(ctx.device)),
        }),
        kw('route', 'Show IPv6 route table entries', {
          run: (ctx) => ctx.out(...showIpv6Route(ctx.project, ctx.device)),
        }),
      ],
    }),
    kw('ip', 'IP information', {
      children: [
        arpNode('IP ARP table'),
        kw('dhcp', 'Show items in the DHCP database', {
          children: [
            kw('binding', 'DHCP address bindings', {
              run: (ctx) => ctx.out(...showIpDhcpBinding(ctx.device)),
            }),
          ],
        }),
        kw('nat', 'IP NAT information', {
          when: (c) => c.device.kind === 'router',
          children: [
            kw('translations', 'Translation entries', {
              run: (ctx) => ctx.out(...showIpNatTranslations(ctx.device)),
            }),
          ],
        }),
        kw('ssh', 'Information on SSH', { run: (ctx) => ctx.out(...showIpSsh(ctx)) }),
        kw('route', 'IP routing table', {
          run: (ctx) => ctx.out(...showIpRoute(ctx.project, ctx.device)),
        }),
        kw('ospf', 'OSPF information', {
          when: (c) => c.device.kind !== 'switch-l2',
          children: [
            kw('neighbor', 'Neighbor list', {
              run: (ctx) => ctx.out(...showIpOspfNeighbor(ctx.project, ctx.device)),
            }),
          ],
        }),
        kw('interface', 'IP interface status and configuration', {
          children: [
            kw('brief', 'Brief summary of IP status and configuration', {
              run: (ctx) => ctx.out(...showIpInterfaceBrief(ctx.project, ctx.device)),
            }),
          ],
        }),
      ],
    }),
    kw('interfaces', 'Interface status and configuration', {
      run: (ctx) => ctx.out(...showInterfaces(ctx.project, ctx.device)),
      children: [
        ...interfaceNodes({
          run: (ctx, args) => ctx.out(...showInterfaces(ctx.project, ctx.device, args.if as string)),
          includeVirtual: true,
        }),
        kw('trunk', 'Show interface trunk information', {
          when: (c) => c.device.kind !== 'router',
          run: (ctx) => ctx.out(...showInterfacesTrunk(ctx.project, ctx.device)),
        }),
      ],
    }),
  ]
  if (privileged) {
    children.push(
      kw('running-config', 'Current operating configuration', {
        run: (ctx) => ctx.out(...showRunningConfig(ctx.device)),
      }),
      kw('startup-config', 'Contents of startup configuration', {
        run: (ctx) => ctx.out(...showStartupConfig(ctx.device)),
      }),
    )
  }
  return kw('show', 'Show running system information', { children })
}

const unknownHost: Handler = (ctx, args) =>
  ctx.out(
    `Translating "${String(args.host)}"...domain server (255.255.255.255)`,
    '% Unrecognized host or address, or protocol not running.',
    '',
  )

/** IPv6 ping; a link-local target needs the output interface, which IOS asks for. */
const ping6Handler: Handler = (ctx, args) => {
  const address = parseIpv6(String(args.ip6))!
  const target = formatIpv6(address)
  if (isLinkLocal(address)) {
    ctx.session.pending = { kind: 'ping6-interface', target }
    return
  }
  ctx.out(...iosPingOutput(target, ping6(ctx.project, ctx.device.id, address, 5)))
}

const traceroute6Handler: Handler = (ctx, args) => {
  const address = parseIpv6(String(args.ip6))!
  ctx.out(...iosTracerouteOutput(formatIpv6(address), traceroute6(ctx.project, ctx.device.id, address, 3)))
}

/** Destination of ping/traceroute: IPv4 or IPv6 address (optionally after `ipv6`), or a name. */
const destinationNodes = (help: string, v4: Handler, v6: Handler): CmdNode[] => [
  kw('ipv6', 'IPv6 echo', { children: [arg('ip6', ipv6(), help, { run: v6 })] }),
  arg('ip', ipv4(), help, { run: v4 }),
  arg('ip6', ipv6(), help, { run: v6 }),
  arg('host', word(), help, { run: unknownHost }),
]

const pingNode = kw('ping', 'Send echo messages', {
  children: destinationNodes(
    'Ping destination address or hostname',
    (ctx, args) => {
      const target = String(args.ip)
      ctx.out(...iosPingOutput(target, ping(ctx.project, ctx.device.id, parseIpv4(target)!, 5)))
    },
    ping6Handler,
  ),
})

const tracerouteNode = kw('traceroute', 'Trace route to destination', {
  children: destinationNodes(
    'Trace route to destination address or hostname',
    (ctx, args) => {
      const target = String(args.ip)
      ctx.out(...iosTracerouteOutput(target, traceroute(ctx.project, ctx.device.id, parseIpv4(target)!, 3, 'udp')))
    },
    traceroute6Handler,
  ),
})

const exitNode = kw('exit', 'Exit from the EXEC', { run: endSession })
const logoutNode = kw('logout', 'Exit from the EXEC', { run: endSession })

export const userNodes: CmdNode[] = [
  kw('enable', 'Turn on privileged commands', {
    run: (ctx) => {
      if (ctx.device.running.enableSecret !== undefined) {
        ctx.session.pending = { kind: 'password', purpose: 'enable', attempts: 0 }
      } else {
        ctx.session.mode = 'priv'
      }
    },
  }),
  exitNode,
  logoutNode,
  pingNode,
  showNodes(false),
  tracerouteNode,
]

export const privNodes: CmdNode[] = [
  kw('enable', 'Turn on privileged commands', { run: () => {} }),
  kw('disable', 'Turn off privileged commands', {
    run: (ctx) => {
      ctx.session.mode = 'user'
    },
  }),
  kw('configure', 'Enter configuration mode', {
    children: [
      kw('terminal', 'Configure from the terminal', {
        run: (ctx) => {
          ctx.session.mode = 'config'
          ctx.out('Enter configuration commands, one per line.  End with CNTL/Z.')
        },
      }),
    ],
  }),
  kw('clear', 'Reset functions', {
    when: (c) => c.device.kind === 'router',
    children: [
      kw('ip', 'IP', {
        children: [
          kw('nat', 'Clear NAT', {
            children: [
              kw('translation', 'Clear dynamic translation', {
                children: [
                  kw('*', 'Delete all dynamic translations', {
                    run: (ctx) => {
                      ctx.device.runtime.natTranslations = []
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
  kw('copy', 'Copy from one file to another', {
    children: [
      kw('running-config', 'Copy from current system configuration', {
        children: [
          kw('startup-config', 'Copy to startup configuration', {
            run: (ctx) => {
              ctx.session.pending = { kind: 'copy-destination' }
            },
          }),
        ],
      }),
    ],
  }),
  kw('write', 'Write running configuration to memory, network, or terminal', {
    run: saveConfig,
    children: [kw('memory', 'Write to NV memory', { run: saveConfig })],
  }),
  kw('reload', 'Halt and perform a cold restart', {
    run: (ctx) => {
      ctx.session.pending = isConfigModified(ctx.device) ? { kind: 'reload-save' } : { kind: 'reload-confirm' }
    },
  }),
  exitNode,
  logoutNode,
  pingNode,
  showNodes(true),
  tracerouteNode,
]

