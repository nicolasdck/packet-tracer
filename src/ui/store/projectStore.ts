import { create } from 'zustand'
import type { Project } from '../../engine'

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
  apply: (op) =>
    set((state) => (state.project ? { project: op(state.project) } : state)),
}))
