import { endConfig } from '../actions'
import { kw } from '../dsl'
import { NEGATE } from '../parser'
import type { CmdNode, ModeDef, ModeId } from '../types'
import { privNodes, userNodes } from './exec'
import { configNodes } from './global'
import { interfaceModeNodes, interfaceRangeNodes } from './interface'
import { lineModeNodes } from './line'

const MODE_DEFS: Partial<Record<ModeId, ModeDef>> = {
  user: { id: 'user', prompt: '>', nodes: userNodes },
  priv: { id: 'priv', prompt: '#', nodes: privNodes },
  config: { id: 'config', prompt: '(config)#', nodes: configNodes },
  'config-if': { id: 'config-if', prompt: '(config-if)#', nodes: interfaceModeNodes, parent: 'config' },
  'config-if-range': { id: 'config-if-range', prompt: '(config-if-range)#', nodes: interfaceRangeNodes, parent: 'config' },
  'config-line': { id: 'config-line', prompt: '(config-line)#', nodes: lineModeNodes, parent: 'config' },
}

export function modeDef(mode: ModeId): ModeDef {
  const def = MODE_DEFS[mode]
  if (!def) throw new Error(`Mode not implemented: ${mode}`)
  return def
}

const isExecMode = (mode: ModeId) => mode === 'user' || mode === 'priv'

const endNode = kw('end', 'Exit from configure mode', { run: endConfig })
const doNode = kw('do', 'To run exec commands in config mode', { children: privNodes })

const rootsCache = new Map<ModeId, CmdNode[]>()

/** Top-level commands of a mode, including `end`, `do` and `no` in configuration modes. */
export function rootsFor(mode: ModeId): CmdNode[] {
  let roots = rootsCache.get(mode)
  if (!roots) {
    const { nodes } = modeDef(mode)
    if (isExecMode(mode)) {
      roots = nodes
    } else {
      const noNode = { ...kw('no', 'Negate a command or set its defaults', { children: nodes }), [NEGATE]: true as const }
      roots = [...nodes, endNode, doNode, noNode]
    }
    rootsCache.set(mode, roots)
  }
  return roots
}
