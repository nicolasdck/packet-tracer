import { create } from 'zustand'
import { HOST_PROMPT, runHostCommand } from '../../engine'
import { useProjectStore } from './projectStore'

const MAX_LINES = 2000
const HISTORY_SIZE = 50

export interface PcConsole {
  lines: string[]
  history: string[]
}

export type PcTab = 'config' | 'prompt'

interface PcState {
  consoles: Record<string, PcConsole>
  /** PC whose screen is shown full screen. */
  openDeviceId: string | null
  tab: PcTab
  open(deviceId: string): void
  close(): void
  setTab(tab: PcTab): void
  run(line: string): void
  forget(deviceId: string): void
  reset(): void
}

const EMPTY: PcConsole = { lines: [], history: [] }

export const usePcStore = create<PcState>()((set, get) => ({
  consoles: {},
  openDeviceId: null,
  tab: 'config',

  open: (deviceId) => set({ openDeviceId: deviceId }),
  close: () => set({ openDeviceId: null }),
  setTab: (tab) => set({ tab }),

  run: (line) => {
    const deviceId = get().openDeviceId
    const project = useProjectStore.getState().project
    if (!deviceId || !project) return
    const result = runHostCommand(project, deviceId, line)
    if (result.project !== project) useProjectStore.getState().apply(() => result.project)
    set((s) => {
      const prev = s.consoles[deviceId] ?? EMPTY
      const history = line.trim() && prev.history.at(-1) !== line
        ? [...prev.history, line].slice(-HISTORY_SIZE)
        : prev.history
      const lines = [...prev.lines, HOST_PROMPT + line, ...result.output].slice(-MAX_LINES)
      return { consoles: { ...s.consoles, [deviceId]: { lines, history } } }
    })
  },

  forget: (deviceId) =>
    set((s) => {
      const consoles = { ...s.consoles }
      delete consoles[deviceId]
      return { consoles, openDeviceId: s.openDeviceId === deviceId ? null : s.openDeviceId }
    }),

  reset: () => set({ consoles: {}, openDeviceId: null, tab: 'config' }),
}))
