import Dexie, { type EntityTable } from 'dexie'
import {
  buildExport,
  cloneProject,
  createProject,
  migrateProject,
  parseImport,
  prepareImport,
  type Project,
} from '../../engine'

class AppDB extends Dexie {
  projects!: EntityTable<Project, 'id'>

  constructor() {
    super('mini-packet-tracer')
    this.version(1).stores({ projects: 'id, updatedAt' })
  }
}

export const db = new AppDB()

export interface ProjectSummary {
  id: string
  name: string
  updatedAt: number
  deviceCount: number
  linkCount: number
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await db.projects.orderBy('updatedAt').reverse().toArray()
  return all.map((p) => ({
    id: p.id,
    name: p.name,
    updatedAt: p.updatedAt,
    deviceCount: Object.keys(p.devices).length,
    linkCount: Object.keys(p.links).length,
  }))
}

export async function getProject(id: string): Promise<Project | undefined> {
  const project = await db.projects.get(id)
  return project && migrateProject(project)
}

export async function saveProject(project: Project): Promise<void> {
  await db.projects.put({ ...project, updatedAt: Date.now() })
}

export async function createNewProject(name: string): Promise<Project> {
  const project = createProject(crypto.randomUUID(), name, Date.now())
  await db.projects.add(project)
  return project
}

export async function renameProject(id: string, name: string): Promise<void> {
  await db.projects.update(id, { name, updatedAt: Date.now() })
}

export async function duplicateProject(id: string): Promise<void> {
  const source = await db.projects.get(id)
  if (!source) return
  await db.projects.add(cloneProject(migrateProject(source), crypto.randomUUID(), `${source.name} (copy)`, Date.now()))
}

export async function deleteProject(id: string): Promise<void> {
  await db.projects.delete(id)
}

/** JSON backup of every project. */
export async function exportAllProjects(): Promise<string> {
  const projects = await db.projects.orderBy('updatedAt').reverse().toArray()
  return JSON.stringify(buildExport(projects, Date.now()), null, 2)
}

/** Imports a backup; projects whose id already exists are added as copies. Returns how many were imported. */
export async function importProjects(text: string): Promise<number> {
  const incoming = parseImport(text)
  const existing = (await db.projects.toCollection().primaryKeys()) as string[]
  const prepared = prepareImport(incoming, existing, () => crypto.randomUUID())
  await db.projects.bulkAdd(prepared)
  return prepared.length
}
