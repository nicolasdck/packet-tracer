import { produce } from 'immer'
import { createSession, executeLine, getPrompt } from '../cli/execute'
import { SSH_V2_MIN_BITS } from '../cli/modes/ssh'
import type { CliSession } from '../cli/types'
import { isIosDevice } from '../model/catalog'
import { parseIpv4 } from '../model/ipv4'
import type { Project } from '../model/types'
import { tcpConnect } from '../sim/ping'

const SSH_PORT = 22

export type SshError = 'timeout' | 'refused' | 'auth' | 'unsupported'

export type SshLogin =
  | { ok: true; project: Project; deviceId: string; session: CliSession }
  | { ok: false; project: Project; error: SshError; message: string }

/**
 * SSH connection from a host, like a client such as Netmiko does it:
 * 1. TCP connection to port 22 (routing, ACLs and NAT apply);
 * 2. the device runs an SSH v2 server: RSA keys of at least 768 bits, vty
 *    lines accepting SSH;
 * 3. authentication on the vty lines: `login local` (local account) or
 *    `login` (line password).
 * The session starts in privileged EXEC for a privilege 15 account, else in user EXEC.
 */
export function sshLogin(project: Project, fromId: string, host: string, username: string, password: string): SshLogin {
  const dst = parseIpv4(host)
  if (dst === null) return { ok: false, project, error: 'unsupported', message: `Only IPv4 addresses are supported: ${host}` }

  let deviceId: string | null = null
  const next = produce(project, (draft) => {
    deviceId = tcpConnect(draft, fromId, dst, SSH_PORT)
  })
  const fail = (error: SshError, message: string): SshLogin => ({ ok: false, project: next, error, message })

  const device = deviceId ? next.devices[deviceId] : undefined
  if (!device) return fail('timeout', `TCP connection to device failed. Device ${host}:${SSH_PORT} is not reachable.`)
  if (!isIosDevice(device)) return fail('refused', `Connection to ${host}:${SSH_PORT} refused.`)

  const cfg = device.running
  const vty = cfg.lines.vty
  if (!cfg.rsaKeyBits || vty.transportInput === 'none' || vty.transportInput === 'telnet') {
    return fail('refused', `Connection to ${host}:${SSH_PORT} refused: no SSH server.`)
  }
  if (cfg.rsaKeyBits < SSH_V2_MIN_BITS) {
    return fail('refused', `Incompatible SSH version: SSH v2 needs RSA keys of at least ${SSH_V2_MIN_BITS} bits.`)
  }

  let privilege: number | null = null
  if (vty.loginLocal) {
    const user = cfg.users.find((u) => u.name === username)
    const ok = user && (user.secret !== undefined ? user.secret === password : user.password?.value === password)
    if (user && ok) privilege = user.privilege
  } else if (vty.login && vty.password && vty.password.value === password) {
    privilege = 1
  }
  if (privilege === null) return fail('auth', `Authentication to device failed (${host}).`)

  const session: CliSession = { ...createSession(device.id), mode: privilege >= 15 ? 'priv' : 'user' }
  return { ok: true, project: next, deviceId: device.id, session }
}

/** Runs one line in an SSH session (no echo, no prompt, like Netmiko's send_command). */
export function sshSend(project: Project, session: CliSession, line: string) {
  const result = executeLine(project, session, line)
  return { project: result.project, session: result.session, output: result.output.join('\n') }
}

export function sshPrompt(project: Project, session: CliSession): string {
  return getPrompt(project, session).text
}
