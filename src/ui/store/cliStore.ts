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

/**
 * Console sessions, one per IOS device. The same session is reached by
 * tapping the device and through a PC's Terminal tab (console cable).
 */
interface CliState {
  terminals: Record<string, Terminal>
  /** Device whose console is shown full screen. */
  openDeviceId: string | null
  /** Starts the console session of a device if it has none yet. */
  ensure(deviceId: string): void
  open(deviceId: string): void
  close(): void
  submit(deviceId: string, line: string): void
  ctrlZ(deviceId: string): void
  help(deviceId: string, line: string): void
  complete(deviceId: string, line: string): string | null
  /**
   * Types pasted text: every complete line is executed in order, like a real
   * terminal. Returns the trailing text without newline, to leave in the input.
   */
  paste(deviceId: string, text: string): string
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

  return {
    terminals: {},
    openDeviceId: null,

    ensure: (deviceId) => {
      if (!get().terminals[deviceId]) commit(deviceId, [], openSession(currentProject(), deviceId))
    },

    open: (deviceId) => {
      get().ensure(deviceId)
      set({ openDeviceId: deviceId })
    },

    close: () => set({ openDeviceId: null }),

    submit: (deviceId, line) => {
      const terminal = get().terminals[deviceId]
      if (!terminal) return
      const project = currentProject()
      const prompt = getPrompt(project, terminal.session)
      const echo = prompt.text + (prompt.masked ? '' : line)
      commit(deviceId, [echo], executeLine(project, terminal.session, line))
    },

    ctrlZ: (deviceId) => {
      const terminal = get().terminals[deviceId]
      if (!terminal) return
      const project = currentProject()
      const prompt = getPrompt(project, terminal.session)
      commit(deviceId, [prompt.text + '^Z'], ctrlZ(project, terminal.session))
    },

    help: (deviceId, line) => {
      const terminal = get().terminals[deviceId]
      if (!terminal) return
      const project = currentProject()
      const prompt = getPrompt(project, terminal.session)
      if (prompt.masked) return
      const output = cliHelp(project, terminal.session, line)
      commit(deviceId, [prompt.text + line + '?'], { project, session: terminal.session, output })
    },

    complete: (deviceId, line) => {
      const terminal = get().terminals[deviceId]
      return terminal ? cliComplete(currentProject(), terminal.session, line) : null
    },

    paste: (deviceId, text) => {
      const lines = text.replace(/\r\n?/g, '\n').split('\n')
      const rest = lines.pop() ?? ''
      for (const line of lines) get().submit(deviceId, line)
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
