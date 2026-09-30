import { endSession, saveConfig } from '../actions'
import { parseIpv4 } from '../../model/ipv4'
import { ping, traceroute } from '../../sim/ping'
import { ipv4, word } from '../args'
import { arg, kw } from '../dsl'
import { iosPingOutput, iosTracerouteOutput } from '../render/ping'
import { isConfigModified, showRunningConfig, showStartupConfig } from '../render/config'
import { showInterfaces, showIpInterfaceBrief } from '../render/interfaces'
import { showArp, showInterfacesTrunk, showMacAddressTable, showVlanBrief } from '../render/switching'
import { showVersion } from '../render/version'
import type { CmdNode, Handler, NodeCtx } from '../types'
import { interfaceNodes } from './shared'

const isSwitch = (c: NodeCtx) => c.device.kind !== 'router'
const arpNode = (help: string) => kw('arp', help, { run: (ctx) => ctx.out(...showArp(ctx.project, ctx.device)) })
const macTable: Handler = (ctx) => ctx.out(...showMacAddressTable(ctx.device))

function showNodes(privileged: boolean): CmdNode {
  const children: CmdNode[] = [
    kw('version', 'System hardware and software status', {
      run: (ctx) => ctx.out(...showVersion(ctx.device)),
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
    kw('ip', 'IP information', {
      children: [
        arpNode('IP ARP table'),
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

const pingNode = kw('ping', 'Send echo messages', {
  children: [
    arg('ip', ipv4(), 'Ping destination address or hostname', {
      run: (ctx, args) => {
        const target = String(args.ip)
        ctx.out(...iosPingOutput(target, ping(ctx.project, ctx.device.id, parseIpv4(target)!, 5)))
      },
    }),
    arg('host', word(), 'Ping destination address or hostname', { run: unknownHost }),
  ],
})

const tracerouteNode = kw('traceroute', 'Trace route to destination', {
  children: [
    arg('ip', ipv4(), 'Trace route to destination address or hostname', {
      run: (ctx, args) => {
        const target = String(args.ip)
        ctx.out(...iosTracerouteOutput(target, traceroute(ctx.project, ctx.device.id, parseIpv4(target)!, 3)))
      },
    }),
    arg('host', word(), 'Trace route to destination address or hostname', { run: unknownHost }),
  ],
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

