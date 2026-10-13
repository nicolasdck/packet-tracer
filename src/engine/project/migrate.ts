import { produce } from 'immer'
import { CATALOG, isIosDevice } from '../model/catalog'
import { deviceMac } from '../model/mac'
import type { IosConfig, IosKind, IosRuntime, Project } from '../model/types'

/** Fills the fields added to IosConfig since the project was saved. */
function upgradeConfig(config: IosConfig, kind: IosKind) {
  if (config.ipRouting === undefined) config.ipRouting = kind === 'router'
  if (config.staticRoutes === undefined) config.staticRoutes = []
  if (config.dhcp === undefined) config.dhcp = { pools: [], excluded: [] }
  if (config.acls === undefined) config.acls = {}
  if (config.nat === undefined) config.nat = { statics: [], pools: [], dynamic: [] }
  if (config.ipv6Routing === undefined) config.ipv6Routing = false
  if (config.ipv6StaticRoutes === undefined) config.ipv6StaticRoutes = []
}

function upgradeRuntime(runtime: IosRuntime) {
  if (runtime.dhcpBindings === undefined) runtime.dhcpBindings = []
  if (runtime.natTranslations === undefined) runtime.natTranslations = []
  if (runtime.aclHits === undefined) runtime.aclHits = {}
  if (runtime.neighbors === undefined) runtime.neighbors = []
}

/**
 * Brings a project saved by an older version up to the current model.
 * Idempotent: returns the same object when nothing is missing.
 */
export function migrateProject(project: Project): Project {
  return produce(project, (draft) => {
    for (const d of Object.values(draft.devices)) {
      // Console ports were added to the hardware later.
      const consolePort = CATALOG[d.kind].consolePort
      if (!d.ports.some((p) => p.name === consolePort)) {
        d.ports.push({ name: consolePort, mac: deviceMac(Number(d.id.slice(1)) || 0, d.ports.length + 1) })
      }
      if (!isIosDevice(d)) {
        if (d.runtime.neighbors === undefined) d.runtime.neighbors = []
        continue
      }
      upgradeConfig(d.running, d.kind)
      if (d.startup) upgradeConfig(d.startup, d.kind)
      upgradeRuntime(d.runtime)
    }
  })
}
