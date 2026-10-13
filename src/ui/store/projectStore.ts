import { create } from 'zustand'
import { dhcpSettle, type Project } from '../../engine'

interface ProjectState {
  /** The project open in the workspace, or null on the project list. */
  project: Project | null
  open(project: Project): void
  close(): void
  /** Applies a pure engine operation to the open project. */
  apply(op: (project: Project) => Project): void
}

export const useProjectStore = create<ProjectState>()((set) => ({
  project: null,
  open: (project) => set({ project }),
  close: () => set({ project: null }),
  // After every change, DHCP clients still waiting for an address try again:
  // a PC gets its lease as soon as a cable, a pool or a route makes it possible.
  apply: (op) =>
    set((state) => (state.project ? { project: dhcpSettle(op(state.project)) } : state)),
}))
