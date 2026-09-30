import type { IfName, IosDevice, Project } from '../model/types'

export type ModeId =
  | 'user'
  | 'priv'
  | 'config'
  | 'config-if'
  | 'config-if-range'
  | 'config-line'
  | 'config-vlan'
  | 'config-router'
  | 'config-subif'
  | 'dhcp-config'

/**
 * An interactive question waiting for the next input line
 * (password, [confirm], banner text…). Plain data, so the session stays serializable.
 */
export type Pending =
  | { kind: 'press-return' }
  | { kind: 'password'; purpose: 'login' | 'enable'; attempts: number }
  | { kind: 'banner'; delimiter: string; lines: string[] }
  | { kind: 'copy-destination' }
  | { kind: 'reload-save' }
  | { kind: 'reload-confirm' }

/** A console session on one IOS device. Not persisted with the project. */
export interface CliSession {
  deviceId: string
  mode: ModeId
  /** Interfaces being configured (config-if: one, config-if-range: several). */
  ifContext: IfName[]
  lineContext?: 'console' | 'vty'
  pending: Pending | null
  history: string[]
}

export type ArgValue = string | number | IfName[]
export type Args = Record<string, ArgValue>

/** Mutable context given to handlers (device and project are Immer drafts). */
export interface ExecCtx {
  project: Project
  device: IosDevice
  session: CliSession
  out(...lines: string[]): void
}

export type Handler = (ctx: ExecCtx, args: Args) => void

/** Read-only context used to decide which nodes are available. */
export interface NodeCtx {
  project: Project
  device: IosDevice
  session: CliSession
}

export type MatchResult<T = ArgValue> =
  | { ok: true; value: T }
  /** `offset`: position of the `^` marker within the token. */
  | { ok: false; offset: number }

export interface ArgSpec {
  /** Label shown by `?`: "WORD", "LINE", "A.B.C.D", "<1-4094>"… */
  label: string | ((c: NodeCtx) => string)
  match(text: string, c: NodeCtx): MatchResult
  /** Consumes the rest of the line (raw text, spaces included). */
  rest?: boolean
}

export interface CmdNode {
  /** Keyword (exclusive with `arg`). */
  kw?: string
  arg?: ArgSpec
  /** Name under which the argument value is stored in Args. */
  name?: string
  help: string
  /**
   * Keyword may be glued to the following number: "g0/0" = "g" + "0/0",
   * like IOS interface types.
   */
  glue?: boolean
  children?: CmdNode[]
  /** Present ⇒ the command is complete at this node (`<cr>`). */
  run?: Handler
  /** Present ⇒ `no <command>` is complete at this node. */
  noRun?: Handler
  when?: (c: NodeCtx) => boolean
}

export interface ModeDef {
  id: ModeId
  /** Suffix after the hostname: ">", "#", "(config-if)#". */
  prompt: string
  nodes: CmdNode[]
  /** Mode whose commands are also accepted (IOS falls back to global config). */
  parent?: ModeId
}
