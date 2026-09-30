import { produce } from 'immer'
import { isIosDevice } from '../model/catalog'
import type { IosDevice, Project } from '../model/types'
import { CONFIGURED_MSG, endConfig, reloadDevice, saveConfig } from './actions'
import { modeDef, rootsFor } from './modes'
import { complete, help, parse, tokenize, type ParseResult } from './parser'
import type { CliSession, ExecCtx, Handler, NodeCtx } from './types'

export interface CliResult {
  project: Project
  session: CliSession
  output: string[]
}

export interface Prompt {
  text: string
  /** Input must be hidden (password). */
  masked: boolean
}

const HISTORY_SIZE = 50

function iosDevice(project: Project, deviceId: string): IosDevice {
  const device = project.devices[deviceId]
  if (!device || !isIosDevice(device)) throw new Error(`Not an IOS device: ${deviceId}`)
  return device
}

export function createSession(deviceId: string): CliSession {
  return { deviceId, mode: 'user', ifContext: [], pending: null, history: [] }
}

export function getPrompt(project: Project, session: CliSession): Prompt {
  const device = iosDevice(project, session.deviceId)
  switch (session.pending?.kind) {
    case 'password':
      return { text: 'Password: ', masked: true }
    case 'press-return':
    case 'banner':
      return { text: '', masked: false }
    case 'copy-destination':
      return { text: 'Destination filename [startup-config]? ', masked: false }
    case 'reload-save':
      return { text: 'System configuration has been modified. Save? [yes/no]: ', masked: false }
    case 'reload-confirm':
      return { text: 'Proceed with reload? [confirm]', masked: false }
    default:
      return { text: device.running.hostname + modeDef(session.mode).prompt, masked: false }
  }
}

/** Runs a handler on a draft of the project and collects its output. */
function run(project: Project, session: CliSession, handler: Handler, args = {}): CliResult {
  const output: string[] = []
  const s = structuredClone(session)
  const next = produce(project, (draft) => {
    const ctx: ExecCtx = {
      project: draft,
      device: iosDevice(draft, s.deviceId),
      session: s,
      out: (...lines) => output.push(...lines),
    }
    handler(ctx, args)
  })
  return { project: next, session: s, output }
}

/** Console greeting: MOTD, then the login password if the console requires one. */
const greet: Handler = (ctx) => {
  const { running } = ctx.device
  ctx.session.mode = 'user'
  ctx.session.pending = null
  if (running.bannerMotd) ctx.out(...running.bannerMotd.text.split('\n'))
  const con = running.lines.console
  if (con.login && con.password) {
    ctx.out('', 'User Access Verification', '')
    ctx.session.pending = { kind: 'password', purpose: 'login', attempts: 0 }
  }
}

/** Opens the console of an IOS device. */
export function openSession(project: Project, deviceId: string): CliResult {
  return run(project, createSession(deviceId), greet)
}

/** Handles the answer to a pending question (password, confirmation…). */
const answerPending = (input: string): Handler => (ctx) => {
  const { session, device } = ctx
  const pending = session.pending!
  const answer = input.trim()
  switch (pending.kind) {
    case 'press-return':
      return greet(ctx, {})
    case 'password': {
      const expected = pending.purpose === 'login'
        ? device.running.lines.console.password?.value
        : device.running.enableSecret
      if (input === expected) {
        session.pending = null
        if (pending.purpose === 'enable') session.mode = 'priv'
        return
      }
      if (pending.attempts + 1 < 3) {
        session.pending = { ...pending, attempts: pending.attempts + 1 }
        return
      }
      if (pending.purpose === 'login') {
        ctx.out('% Bad passwords', '')
        session.pending = { kind: 'press-return' }
      } else {
        ctx.out('% Bad secrets', '')
        session.pending = null
      }
      return
    }
    case 'banner': {
      const end = input.indexOf(pending.delimiter)
      if (end === -1) {
        session.pending = { ...pending, lines: [...pending.lines, input] }
        return
      }
      device.running.bannerMotd = {
        delimiter: pending.delimiter,
        text: [...pending.lines, input.slice(0, end)].join('\n'),
      }
      session.pending = null
      return
    }
    case 'copy-destination':
      session.pending = null
      if (answer === '' || answer === 'startup-config') return saveConfig(ctx)
      ctx.out(`%Error opening flash:${answer} (Permission denied)`)
      return
    case 'reload-save':
      if (/^y(es?)?$/i.test(answer)) {
        saveConfig(ctx)
      } else if (!/^no?$/i.test(answer)) {
        ctx.out("% Please answer 'yes' or 'no'.")
        return
      }
      session.pending = { kind: 'reload-confirm' }
      return
    case 'reload-confirm':
      session.pending = null
      if (answer === '' || /^y/i.test(answer)) reloadDevice(ctx)
      else ctx.out('')
      return
  }
}

function errorLines(result: Exclude<ParseResult, { ok: true }>, promptLength: number): string[] {
  switch (result.error) {
    case 'incomplete':
      return ['% Incomplete command.', '']
    case 'ambiguous':
      return [`% Ambiguous command: "${result.text}"`, '']
    case 'invalid':
      return [' '.repeat(promptLength + result.col) + '^', "% Invalid input detected at '^' marker.", '']
  }
}

/** Executes one line typed at the console. */
export function executeLine(project: Project, session: CliSession, line: string): CliResult {
  if (session.pending) return run(project, session, answerPending(line))

  // Empty lines, and lines starting with "!" (IOS comments), do nothing.
  if (!line.trim() || line.trimStart().startsWith('!')) return { project, session, output: [] }
  const withHistory: CliSession = {
    ...session,
    history: session.history.at(-1) === line ? session.history : [...session.history, line].slice(-HISTORY_SIZE),
  }
  if (line.trimEnd().endsWith('?')) {
    return { project, session: withHistory, output: cliHelp(project, withHistory, line.trimEnd().slice(0, -1)) }
  }

  const device = iosDevice(project, session.deviceId)
  const c: NodeCtx = { project, device, session: withHistory }
  let result = parse(rootsFor(session.mode), line, c)
  let s = withHistory

  // Sub-modes also accept global configuration commands, like IOS.
  const parent = modeDef(session.mode).parent
  if (!result.ok && parent) {
    const fallback = parse(rootsFor(parent), line, c)
    if (fallback.ok) {
      result = fallback
      s = { ...withHistory, mode: parent, ifContext: [], lineContext: undefined, vlanContext: undefined }
    }
  }

  if (result.ok) return run(project, s, result.handler, result.args)

  const promptLength = getPrompt(project, session).text.length
  const tokens = tokenize(line)
  const isExec = session.mode === 'user' || session.mode === 'priv'
  if (isExec && result.error === 'invalid' && result.index === 0 && tokens.length === 1) {
    // IOS treats an unknown single word in EXEC mode as a host name to telnet to.
    return {
      project,
      session: s,
      output: [
        `Translating "${tokens[0]!.text}"...domain server (255.255.255.255)`,
        '% Unknown command or computer name, or unable to find computer address',
        '',
      ],
    }
  }
  return { project, session: s, output: errorLines(result, promptLength) }
}

/** Ctrl+Z: leaves configuration mode. */
export function ctrlZ(project: Project, session: CliSession): CliResult {
  if (session.pending || session.mode === 'user' || session.mode === 'priv') {
    return { project, session, output: [] }
  }
  return run(project, session, endConfig)
}

/** `?` help for the text typed so far. */
export function cliHelp(project: Project, session: CliSession, line: string): string[] {
  if (session.pending) return []
  const device = iosDevice(project, session.deviceId)
  const r = help(rootsFor(session.mode), line, { project, device, session })
  if (r.ok) return [...r.lines, '']
  if (r.error === 'unrecognized') return ['% Unrecognized command', '']
  const promptLength = getPrompt(project, session).text.length
  return errorLines(r, promptLength)
}

/** Tab completion; returns the completed line, or null if nothing to complete. */
export function cliComplete(project: Project, session: CliSession, line: string): string | null {
  if (session.pending) return null
  const device = iosDevice(project, session.deviceId)
  return complete(rootsFor(session.mode), line, { project, device, session })
}

export { CONFIGURED_MSG }
