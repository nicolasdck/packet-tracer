import type { ArgSpec, CmdNode } from './types'

type NodeOpts = Omit<CmdNode, 'kw' | 'arg' | 'name' | 'help'>

/** Keyword node. */
export const kw = (keyword: string, help: string, opts: NodeOpts = {}): CmdNode => ({ kw: keyword, help, ...opts })

/** Argument node; its value is stored in Args under `name`. */
export const arg = (name: string, spec: ArgSpec, help: string, opts: NodeOpts = {}): CmdNode => ({
  name,
  arg: spec,
  help,
  ...opts,
})
