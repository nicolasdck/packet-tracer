import type { LabInfo, Project } from '../model/types'
import { migrateProject } from '../project/migrate'
import type { LabDefinition } from './catalog'

/** New project for a lab: its starting network, with the lab instructions attached. */
export function startLab(def: LabDefinition, id: string, now: number): Project {
  return { ...def.build(), id, name: def.info.title, createdAt: now, updatedAt: now, lab: structuredClone(def.info) }
}

/** Shareable lab file: a starting network plus its instructions. */
export const LAB_FORMAT = 'mini-packet-tracer-lab'

export interface LabFile {
  format: typeof LAB_FORMAT
  version: 1
  lab: LabInfo
  start: Project
}

export class LabFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LabFileError'
  }
}

/** Turns a project with its lab back into a lab file (for sharing a lab one wrote). */
export function exportLab(project: Project): LabFile {
  if (!project.lab) throw new LabFileError('This project is not a lab.')
  const start = { ...structuredClone(project) }
  delete start.lab
  return { format: LAB_FORMAT, version: 1, lab: structuredClone(project.lab), start }
}

/** Reads a lab file into a new project. Throws LabFileError with a readable message. */
export function importLab(text: string, id: string, now: number): Project {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new LabFileError('This file is not valid JSON.')
  }
  const file = data as Partial<LabFile> | null
  if (!file || file.format !== LAB_FORMAT || file.version !== 1 || !file.lab || !file.start) {
    throw new LabFileError('This file is not a Mini Packet Tracer lab.')
  }
  const { lab, start } = file
  if (typeof lab.title !== 'string' || !Array.isArray(lab.tasks) || typeof start.devices !== 'object') {
    throw new LabFileError('This lab file is incomplete.')
  }
  const project = migrateProject({ ...start, id, name: lab.title, createdAt: now, updatedAt: now, notes: start.notes ?? [] })
  return { ...project, lab }
}
