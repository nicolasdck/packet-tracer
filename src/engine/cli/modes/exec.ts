import { endSession, saveConfig } from '../actions'
import { kw } from '../dsl'
import { isConfigModified, showRunningConfig, showStartupConfig } from '../render/config'
import { showInterfaces, showIpInterfaceBrief } from '../render/interfaces'
import { showVersion } from '../render/version'
import type { CmdNode } from '../types'
import { interfaceNodes } from './shared'

function showNodes(privileged: boolean): CmdNode {
  const children: CmdNode[] = [
    kw('version', 'System hardware and software status', {
      run: (ctx) => ctx.out(...showVersion(ctx.device)),
    }),
    kw('ip', 'IP information', {
      children: [
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
      children: interfaceNodes((ctx, args) => ctx.out(...showInterfaces(ctx.project, ctx.device, args.if as string)), true),
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
  showNodes(false),
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
  showNodes(true),
]

