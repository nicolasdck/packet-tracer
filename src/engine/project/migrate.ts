import { produce } from 'immer'
import { isIosDevice } from '../model/catalog'
import type { IosConfig, Project } from '../model/types'

/**
 * Brings a project saved by an older version up to the current model.
 * Idempotent: returns the same object when nothing is missing.
 */
export function migrateProject(project: Project): Project {
  const needsFix = (c: IosConfig | null) => c !== null && c.ipRouting === undefined
  const stale = Object.values(project.devices).some(
    (d) => isIosDevice(d) && (needsFix(d.running) || needsFix(d.startup)),
  )
  if (!stale) return project
  return produce(project, (draft) => {
    for (const d of Object.values(draft.devices)) {
      if (!isIosDevice(d)) continue
      for (const c of [d.running, d.startup]) {
        if (c && c.ipRouting === undefined) c.ipRouting = d.kind === 'router'
      }
    }
  })
}
