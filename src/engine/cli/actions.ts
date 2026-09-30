import { current, isDraft } from 'immer'
import type { IosConfig } from '../model/types'
import { defaultIosConfig } from '../project/create'
import { interfaceStatus } from '../sim/linkState'
import type { ExecCtx } from './types'

export const CONFIGURED_MSG = '%SYS-5-CONFIG_I: Configured from console by console'

function snapshot(config: IosConfig): IosConfig {
  return structuredClone(isDraft(config) ? current(config) : config)
}

/** copy running-config startup-config / write memory. */
export function saveConfig(ctx: ExecCtx) {
  ctx.device.startup = snapshot(ctx.device.running)
  ctx.out('Building configuration...', '[OK]')
}

/** Leaves any configuration mode for privileged EXEC. */
export function endConfig(ctx: ExecCtx) {
  ctx.session.mode = 'priv'
  ctx.session.ifContext = []
  ctx.session.lineContext = undefined
  ctx.out(CONFIGURED_MSG)
}

/** Back to global configuration from a sub-mode. */
export function exitToConfig(ctx: ExecCtx) {
  ctx.session.mode = 'config'
  ctx.session.ifContext = []
  ctx.session.lineContext = undefined
}

/** exit / logout from EXEC: the console waits for RETURN. */
export function endSession(ctx: ExecCtx) {
  ctx.session.mode = 'user'
  ctx.session.pending = { kind: 'press-return' }
  ctx.out('', `${ctx.device.running.hostname} con0 is now available`, '', '', '', '', '', 'Press RETURN to get started.', '')
}

/** Reloads the startup-config (or factory defaults) and clears learned tables. */
export function reloadDevice(ctx: ExecCtx) {
  const { device } = ctx
  const running = device.startup ? snapshot(device.startup) : defaultIosConfig(device.kind)
  for (const cfg of Object.values(running.interfaces)) {
    if (cfg.ip) cfg.ip.method = 'NVRAM'
  }
  device.running = running
  device.runtime = { mac: [], arp: [] }
  ctx.session.mode = 'user'
  ctx.session.ifContext = []
  ctx.session.lineContext = undefined
  ctx.session.pending = { kind: 'press-return' }
  ctx.out(
    '%SYS-5-RELOAD: Reload requested by console. Reload Reason: Reload Command.',
    '',
    'System Bootstrap, Version 15.1(4)M4, RELEASE SOFTWARE (fc1)',
    'Initializing memory...',
    'Loading IOS image... [OK]',
    '',
    'Press RETURN to get started!',
    '',
  )
}

/**
 * Applies an interface change and prints the IOS link/protocol messages
 * for the interfaces whose state changed.
 */
export function withLinkMessages(ctx: ExecCtx, names: string[], change: () => void) {
  const before = names.map((n) => interfaceStatus(ctx.project, ctx.device.id, n))
  change()
  const messages: string[] = []
  names.forEach((name, i) => {
    const b = before[i]!
    const a = interfaceStatus(ctx.project, ctx.device.id, name)
    if (a.status !== b.status && a.status !== 'down') {
      messages.push('', `%LINK-5-CHANGED: Interface ${name}, changed state to ${a.status}`)
    }
    if (a.protocol !== b.protocol) {
      messages.push('', `%LINEPROTO-5-UPDOWN: Line protocol on Interface ${name}, changed state to ${a.protocol}`)
    }
  })
  if (messages.length) ctx.out(...messages, '')
}
