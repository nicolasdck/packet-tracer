import { DEVICE_KINDS } from '../model/catalog'
import type { Project } from '../model/types'
import { migrateProject } from './migrate'

/** Backup file containing every project. */
export const EXPORT_FORMAT = 'mini-packet-tracer'

export interface ExportFile {
  format: typeof EXPORT_FORMAT
  version: 1
  exportedAt: number
  projects: Project[]
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportError'
  }
}

export function buildExport(projects: Project[], now: number): ExportFile {
  return { format: EXPORT_FORMAT, version: 1, exportedAt: now, projects }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Structural check: enough to be sure the app can open the project. */
function isProject(v: unknown): v is Project {
  if (!isRecord(v)) return false
  if (v.schemaVersion !== 1 || typeof v.id !== 'string' || typeof v.name !== 'string') return false
  if (typeof v.seq !== 'number' || !isRecord(v.devices) || !isRecord(v.links)) return false
  const devicesOk = Object.values(v.devices).every(
    (d) =>
      isRecord(d) &&
      typeof d.id === 'string' &&
      DEVICE_KINDS.includes(d.kind as never) &&
      Array.isArray(d.ports) &&
      isRecord(d.position),
  )
  const linksOk = Object.values(v.links).every((l) => isRecord(l) && isRecord(l.a) && isRecord(l.b))
  return devicesOk && linksOk
}

/** Parses and validates a backup file. Throws ImportError with a readable message. */
export function parseImport(text: string): Project[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new ImportError('This file is not valid JSON.')
  }
  if (!isRecord(data) || data.format !== EXPORT_FORMAT || !Array.isArray(data.projects)) {
    throw new ImportError('This file is not a Mini Packet Tracer backup.')
  }
  if (data.version !== 1) throw new ImportError(`Unsupported backup version: ${String(data.version)}.`)
  return data.projects.map((p, i) => {
    if (!isProject(p)) throw new ImportError(`Project #${i + 1} in the file is invalid.`)
    return migrateProject(p)
  })
}

/**
 * Gives a new identity to imported projects whose id already exists (locally
 * or earlier in the file), so an import never overwrites anything.
 */
export function prepareImport(incoming: Project[], existingIds: Iterable<string>, newId: () => string): Project[] {
  const taken = new Set(existingIds)
  return incoming.map((p) => {
    const project = taken.has(p.id) ? { ...p, id: newId(), name: `${p.name} (imported)` } : p
    taken.add(project.id)
    return project
  })
}
