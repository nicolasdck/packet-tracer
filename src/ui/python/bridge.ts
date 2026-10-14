import { sshLogin, sshPrompt, sshSend, type CliSession, type Project } from '../../engine'

/** State of a script run: the network it changes, and its open SSH sessions. */
export interface RunState {
  project: Project
  hostId: string
  sessions: Map<number, CliSession>
  nextId: number
}

export function newRun(project: Project, hostId: string): RunState {
  return { project, hostId, sessions: new Map(), nextId: 1 }
}

/**
 * The `_sim` module netmiko.py calls. `current()` gives the run in progress, so
 * the bridge can be registered once in Python and serve every run.
 */
export function createBridge(current: () => RunState) {
  const session = (sid: number): CliSession => {
    const s = current().sessions.get(sid)
    if (!s) throw new Error('Socket is closed')
    return s
  }
  return {
    connect(host: string, username: string, password: string) {
      const run = current()
      const login = sshLogin(run.project, run.hostId, host, username, password)
      run.project = login.project
      if (!login.ok) return { sid: 0, error: login.error, message: login.message }
      const sid = run.nextId++
      run.sessions.set(sid, login.session)
      return { sid, error: '', message: '' }
    },
    send(sid: number, line: string): string {
      const run = current()
      const result = sshSend(run.project, session(sid), line)
      run.project = result.project
      run.sessions.set(sid, result.session)
      return result.output
    },
    prompt(sid: number): string {
      return sshPrompt(current().project, session(sid))
    },
    pending(sid: number): string {
      return session(sid).pending?.kind ?? ''
    },
    close(sid: number) {
      current().sessions.delete(sid)
    },
  }
}
