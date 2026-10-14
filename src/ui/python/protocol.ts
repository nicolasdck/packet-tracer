import type { Project } from '../../engine'

/** Messages between the UI and the Python worker. */
export type WorkerIn = { type: 'run'; project: Project; hostId: string; code: string }

export type WorkerOut =
  | { type: 'status'; text: string }
  | { type: 'stdout'; text: string }
  | { type: 'stderr'; text: string }
  /** `project`: the network after the script (configurations changed over SSH). */
  | { type: 'done'; ok: boolean; project: Project }
