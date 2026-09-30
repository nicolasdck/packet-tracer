import { CATALOG, isIosKind } from '../model/catalog'
import { ifMedia } from '../model/ifname'
import { deviceMac } from '../model/mac'
import type {
  Device,
  DeviceKind,
  IfConfig,
  IfName,
  IosConfig,
  IosKind,
  Position,
  Project,
} from '../model/types'

/** Ids and timestamps come from the caller so the engine stays deterministic. */
export function createProject(id: string, name: string, now: number): Project {
  return {
    schemaVersion: 1,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    seq: 0,
    devices: {},
    links: {},
  }
}

export function cloneProject(source: Project, id: string, name: string, now: number): Project {
  return { ...structuredClone(source), id, name, createdAt: now, updatedAt: now }
}

function defaultInterface(kind: IosKind, port: IfName): IfConfig {
  const media = ifMedia(port)
  // IOS: router interfaces start shut down, switch ports start up.
  const cfg: IfConfig = { shutdown: kind === 'router' }
  if (media === 'ethernet') {
    cfg.duplex = 'auto'
    cfg.speed = 'auto'
  }
  if (kind !== 'router') {
    cfg.switchport = { mode: 'dynamic-auto', accessVlan: 1, nativeVlan: 1, allowedVlans: 'all' }
  }
  return cfg
}

export function defaultIosConfig(kind: IosKind): IosConfig {
  const model = CATALOG[kind]
  const interfaces: Record<IfName, IfConfig> = {}
  for (const port of model.ports) interfaces[port] = defaultInterface(kind, port)
  return {
    hostname: model.defaultHostname ?? 'Router',
    servicePasswordEncryption: false,
    lines: { console: { login: false }, vty: { login: true } },
    interfaces,
    vlans: kind === 'router' ? {} : { 1: { name: 'default' } },
  }
}

/** Builds a factory-default device. `seq` must be unique within the project. */
export function createDevice(
  kind: DeviceKind,
  seq: number,
  label: string,
  position: Position,
): Device {
  const model = CATALOG[kind]
  const base = {
    id: `d${seq}`,
    model: model.model,
    label,
    position: { ...position },
    ports: model.ports.map((name, i) => ({ name, mac: deviceMac(seq, i + 1) })),
  }
  if (isIosKind(kind)) {
    return {
      ...base,
      kind,
      running: defaultIosConfig(kind),
      startup: null,
      runtime: { mac: [], arp: [] },
    }
  }
  return { ...base, kind, net: { mode: 'static' }, runtime: { arp: [] } }
}
