import { CATALOG } from '../../model/catalog'
import { endConfig } from '../actions'
import { ifRange, int, line, word } from '../args'
import { arg, kw } from '../dsl'
import type { CmdNode, ExecCtx } from '../types'
import { interfaceNodes } from './shared'

const HOSTNAME_RE = /^[A-Za-z]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/

function enterLine(ctx: ExecCtx, which: 'console' | 'vty') {
  ctx.session.mode = 'config-line'
  ctx.session.lineContext = which
}

function setBanner(ctx: ExecCtx, text: string) {
  const delimiter = text[0]!
  const body = text.slice(1)
  const end = body.indexOf(delimiter)
  if (end !== -1) {
    ctx.device.running.bannerMotd = { delimiter, text: body.slice(0, end) }
    return
  }
  // Multi-line banner: the text continues until the delimiter appears.
  ctx.session.pending = { kind: 'banner', delimiter, lines: body ? [body] : [] }
  ctx.out(`Enter TEXT message.  End with the character '${delimiter}'.`)
}

export const configNodes: CmdNode[] = [
  kw('hostname', 'Set system\'s network name', {
    children: [
      arg('name', word(), 'This system\'s network name', {
        run: (ctx, args) => {
          const name = String(args.name)
          if (!HOSTNAME_RE.test(name)) {
            ctx.out('% Hostname contains one or more illegal characters.')
            return
          }
          ctx.device.running.hostname = name
        },
      }),
    ],
    noRun: (ctx) => {
      ctx.device.running.hostname = CATALOG[ctx.device.kind].defaultHostname ?? 'Router'
    },
  }),
  kw('enable', 'Modify enable password parameters', {
    children: [
      kw('secret', 'Assign the privileged level secret', {
        noRun: (ctx) => {
          delete ctx.device.running.enableSecret
        },
        children: [
          arg('secret', line(), 'The UNENCRYPTED (cleartext) \'enable\' secret', {
            run: (ctx, args) => {
              // "enable secret 0 <pw>" = explicit cleartext.
              ctx.device.running.enableSecret = String(args.secret).trim().replace(/^0\s+/, '')
            },
          }),
        ],
      }),
    ],
  }),
  kw('banner', 'Define a login banner', {
    children: [
      kw('motd', 'Set Message of the Day banner', {
        noRun: (ctx) => {
          delete ctx.device.running.bannerMotd
        },
        children: [
          arg('text', line(), 'c banner-text c, where \'c\' is a delimiting character', {
            run: (ctx, args) => setBanner(ctx, String(args.text)),
          }),
        ],
      }),
    ],
  }),
  kw('line', 'Configure a terminal line', {
    children: [
      kw('console', 'Primary terminal line', {
        children: [arg('first', int(0, 0), 'First Line number', { run: (ctx) => enterLine(ctx, 'console') })],
      }),
      kw('vty', 'Virtual terminal', {
        children: [
          arg('first', int(0, 15), 'First Line number', {
            run: (ctx) => enterLine(ctx, 'vty'),
            children: [arg('last', int(1, 15), 'Last Line number', { run: (ctx) => enterLine(ctx, 'vty') })],
          }),
        ],
      }),
    ],
  }),
  kw('service', 'Modify use of network based services', {
    children: [
      kw('password-encryption', 'Encrypt system passwords', {
        run: (ctx) => {
          const cfg = ctx.device.running
          cfg.servicePasswordEncryption = true
          // Existing passwords are encrypted once and stay encrypted.
          for (const l of [cfg.lines.console, cfg.lines.vty]) {
            if (l.password) l.password.encrypted = true
          }
        },
        noRun: (ctx) => {
          ctx.device.running.servicePasswordEncryption = false
        },
      }),
    ],
  }),
  kw('interface', 'Select an interface to configure', {
    children: [
      ...interfaceNodes((ctx, args) => {
        ctx.session.mode = 'config-if'
        ctx.session.ifContext = [args.if as string]
      }, false),
      kw('range', 'interface range command', {
        children: [
          arg('range', ifRange(), 'Interface range', {
            run: (ctx, args) => {
              ctx.session.mode = 'config-if-range'
              ctx.session.ifContext = args.range as string[]
            },
          }),
        ],
      }),
    ],
  }),
  kw('exit', 'Exit from configure mode', { run: endConfig }),
]
