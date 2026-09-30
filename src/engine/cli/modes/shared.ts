import { IF_TYPES } from '../../model/ifname'
import { deviceIfTypes, ifNumber } from '../args'
import { arg, kw } from '../dsl'
import type { CmdNode, Handler } from '../types'

const TYPE_HELP: Record<string, string> = {
  GigabitEthernet: 'GigabitEthernet IEEE 802.3z',
  FastEthernet: 'FastEthernet IEEE 802.3',
  Serial: 'Serial',
  Vlan: 'Catalyst Vlans',
}

interface InterfaceNodeOpts {
  run: Handler
  noRun?: Handler
  /** Offer virtual interfaces (SVIs). */
  includeVirtual: boolean
  /** Accept interfaces that do not exist yet (new SVIs and subinterfaces). */
  create?: boolean
}

/**
 * Interface selector: one keyword per interface type present on the device
 * ("GigabitEthernet", glued to its number as in "g0/0"), followed by the number.
 * The canonical interface name is stored in Args under "if".
 */
export function interfaceNodes({ run, noRun, includeVirtual, create = false }: InterfaceNodeOpts): CmdNode[] {
  return IF_TYPES.map((t) =>
    kw(t.full, TYPE_HELP[t.full] ?? t.full, {
      glue: true,
      when: (c) => deviceIfTypes(c, includeVirtual).includes(t),
      children: [arg('if', ifNumber(t.full, create), `${t.full} interface number`, { run, noRun })],
    }),
  )
}
