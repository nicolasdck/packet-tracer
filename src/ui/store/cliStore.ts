import { create } from 'zustand'
import {
  cliComplete,
  cliHelp,
  ctrlZ,
  executeLine,
  getPrompt,
  openSession,
  type CliResult,
  type CliSession,
} from '../../engine'
import { useProjectStore } from './projectStore'

const MAX_LINES = 2000

export interface Terminal {
  session: CliSession
  /** Scrollback, one entry per line. */
  lines: string[]
  /** Output of the last command, for the Copy button. */
  lastOutput: string[]
}

interface CliState {
  terminals: Record<string, Terminal>
  /** Device whose console is shown full screen. */
  openDeviceId: string | null
  open(deviceId: string): void
  close(): void
  submit(line: string): void
  ctrlZ(): void
  help(line: string): void
  complete(line: string): string | null
  /**
   * Types pasted text: every complete line is executed in order, like a real
   * terminal. Returns the trailing text without newline, to leave in the input.
   */
  paste(text: string): string
  forget(deviceId: string): void
  reset(): void
}

function currentProject() {
  const project = useProjectStore.getState().project
  if (!project) throw new Error('No project open')
  return project
}

export const useCliStore = create<CliState>()((set, get) => {
  /** Stores an engine result: new project state, session and scrollback. */
  function commit(deviceId: string, echo: string[], result: CliResult) {
    const project = currentProject()
    if (result.project !== project) useProjectStore.getState().apply(() => result.project)
    set((s) => {
      const previous = s.terminals[deviceId]?.lines ?? []
      const lines = [...previous, ...echo, ...result.output].slice(-MAX_LINES)
      const terminal = { session: result.session, lines, lastOutput: result.output }
      return { terminals: { ...s.terminals, [deviceId]: terminal } }
    })
  }

  function active(): { deviceId: string; terminal: Terminal } | null {
    const deviceId = get().openDeviceId
    const terminal = deviceId ? get().terminals[deviceId] : undefined
    return deviceId && terminal ? { deviceId, terminal } : null
  }

  return {
    terminals: {},
    openDeviceId: null,

    open: (deviceId) => {
      if (!get().terminals[deviceId]) commit(deviceId, [], openSession(currentProject(), deviceId))
      set({ openDeviceId: deviceId })
    },

    close: () => set({ openDeviceId: null }),

    submit: (line) => {
      const a = active()
      if (!a) return
      const project = currentProject()
      const prompt = getPrompt(project, a.terminal.session)
      const echo = prompt.text + (prompt.masked ? '' : line)
      commit(a.deviceId, [echo], executeLine(project, a.terminal.session, line))
    },

    ctrlZ: () => {
      const a = active()
      if (!a) return
      const project = currentProject()
      const prompt = getPrompt(project, a.terminal.session)
      commit(a.deviceId, [prompt.text + '^Z'], ctrlZ(project, a.terminal.session))
    },

    help: (line) => {
      const a = active()
      if (!a) return
      const project = currentProject()
      const prompt = getPrompt(project, a.terminal.session)
      if (prompt.masked) return
      const output = cliHelp(project, a.terminal.session, line)
      commit(a.deviceId, [prompt.text + line + '?'], { project, session: a.terminal.session, output })
    },

    complete: (line) => {
      const a = active()
      return a ? cliComplete(currentProject(), a.terminal.session, line) : null
    },

    paste: (text) => {
      const lines = text.replace(/\r\n?/g, '\n').split('\n')
      const rest = lines.pop() ?? ''
      for (const line of lines) get().submit(line)
      return rest
    },

    forget: (deviceId) =>
      set((s) => {
        const terminals = { ...s.terminals }
        delete terminals[deviceId]
        return { terminals, openDeviceId: s.openDeviceId === deviceId ? null : s.openDeviceId }
      }),

    reset: () => set({ terminals: {}, openDeviceId: null }),
  }
})
