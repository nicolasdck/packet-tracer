import { defaultVlanName } from '../../model/vlans'
import { exitToConfig } from '../actions'
import { word } from '../args'
import { arg, kw } from '../dsl'
import type { CmdNode, ExecCtx } from '../types'

function currentVlan(ctx: ExecCtx) {
  return ctx.device.running.vlans[ctx.session.vlanContext ?? 1]
}

export const vlanModeNodes: CmdNode[] = [
  kw('name', 'Ascii name of the VLAN', {
    noRun: (ctx) => {
      const vlan = currentVlan(ctx)
      if (vlan) vlan.name = defaultVlanName(ctx.session.vlanContext ?? 1)
    },
    children: [
      arg('name', word(), 'The ascii name for the VLAN', {
        run: (ctx, args) => {
          const vlan = currentVlan(ctx)
          if (vlan) vlan.name = String(args.name).slice(0, 32)
        },
      }),
    ],
  }),
  kw('exit', 'Apply changes, bump revision number, and exit mode', { run: exitToConfig }),
]
