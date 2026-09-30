import type { LineConfig } from '../../model/types'
import { exitToConfig } from '../actions'
import { line } from '../args'
import { arg, kw } from '../dsl'
import type { CmdNode, ExecCtx } from '../types'

function current(ctx: ExecCtx): LineConfig {
  return ctx.device.running.lines[ctx.session.lineContext ?? 'console']
}

export const lineModeNodes: CmdNode[] = [
  kw('password', 'Set a password', {
    noRun: (ctx) => {
      delete current(ctx).password
    },
    children: [
      arg('password', line(), 'The UNENCRYPTED (cleartext) line password', {
        run: (ctx, args) => {
          current(ctx).password = {
            value: String(args.password).trim(),
            encrypted: ctx.device.running.servicePasswordEncryption,
          }
        },
      }),
    ],
  }),
  kw('login', 'Enable password checking', {
    run: (ctx) => {
      current(ctx).login = true
    },
    noRun: (ctx) => {
      current(ctx).login = false
    },
  }),
  kw('exit', 'Exit from line configuration mode', { run: exitToConfig }),
]
