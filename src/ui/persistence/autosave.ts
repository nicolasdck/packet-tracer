import type { Project } from '../../engine'
import { useProjectStore } from '../store/projectStore'
import { saveProject } from './db'

const DELAY_MS = 800

let pending: Project | null = null
let timer: ReturnType<typeof setTimeout> | undefined

/** Writes the pending project now, if any. */
export async function flushAutosave(): Promise<void> {
  clearTimeout(timer)
  timer = undefined
  const project = pending
  pending = null
  if (project) await saveProject(project)
}

function schedule(project: Project) {
  pending = project
  clearTimeout(timer)
  timer = setTimeout(() => void flushAutosave(), DELAY_MS)
}

/** Saves the open project after each change (debounced). Returns an unsubscribe function. */
export function startAutosave(): () => void {
  const unsubscribe = useProjectStore.subscribe((state, prev) => {
    const next = state.project
    // Opening or closing a project is not an edit.
    if (!next || !prev.project || next.id !== prev.project.id || next === prev.project) return
    schedule(next)
  })
  const onHide = () => {
    if (document.visibilityState === 'hidden') void flushAutosave()
  }
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', onHide)
  return () => {
    unsubscribe()
    document.removeEventListener('visibilitychange', onHide)
    window.removeEventListener('pagehide', onHide)
  }
}
