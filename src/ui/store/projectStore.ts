import { create } from 'zustand'
import { dhcpSettle, wirelessSettle, type Project } from '../../engine'

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
  // After every change, laptops (re)associate with the matching access point, and
  // DHCP clients still waiting for an address try again: a PC gets its lease as
  // soon as a cable, a pool, a route or a Wi-Fi key makes it possible.
  apply: (op) =>
    set((state) => (state.project ? { project: dhcpSettle(wirelessSettle(op(state.project))) } : state)),
}))
