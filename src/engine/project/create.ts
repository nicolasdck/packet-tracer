import { DEFAULT_HOME, homeRouterConfig } from '../wireless/home'
import { findModel, isIosKind } from '../model/catalog'
import { ifMedia } from '../model/ifname'
import { deviceMac } from '../model/mac'
import type {
  Device,
  DeviceKind,
  IfConfig,
  IfName,
  IosConfig,
  IosKind,
  IosRuntime,
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
    notes: [],
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

/** Settings every IOS configuration starts from, without interfaces. */
export function baseIosConfig(kind: IosKind): IosConfig {
  return {
    hostname: findModel(kind).defaultHostname ?? 'Router',
    servicePasswordEncryption: false,
    lines: { console: { login: false }, vty: { login: true } },
    interfaces: {},
    vlans: kind === 'router' ? {} : { 1: { name: 'default' } },
    ipRouting: kind === 'router',
    staticRoutes: [],
    dhcp: { pools: [], excluded: [] },
    acls: {},
    nat: { statics: [], pools: [], dynamic: [] },
    ipv6Routing: false,
    ipv6StaticRoutes: [],
    users: [],
  }
}

/** Factory configuration of an IOS device: one interface per data port of its model. */
export function defaultIosConfig(kind: IosKind, modelId?: string): IosConfig {
  const model = findModel(kind, modelId)
  if (kind === 'wireless-router') return homeRouterConfig(model.id, DEFAULT_HOME)
  const config = baseIosConfig(kind)
  for (const port of model.ports) config.interfaces[port] = defaultInterface(kind, port)
  // Switches ship with the management SVI, shut down.
  if (kind !== 'router') config.interfaces['Vlan1'] = { shutdown: true }
  return config
}

/** Learned tables of an IOS device, empty as after a boot. */
export function emptyIosRuntime(): IosRuntime {
  return { mac: [], arp: [], dhcpBindings: [], natTranslations: [], aclHits: {}, neighbors: [] }
}

/** Builds a factory-default device. `seq` must be unique within the project. */
export function createDevice(
  kind: DeviceKind,
  seq: number,
  label: string,
  position: Position,
  modelId?: string,
): Device {
  const model = findModel(kind, modelId)
  const base = {
    id: `d${seq}`,
    model: model.id,
    label,
    position: { ...position },
    ports: [...model.ports, ...(model.consolePort ? [model.consolePort] : [])].map((name, i) => ({ name, mac: deviceMac(seq, i + 1) })),
  }
  if (isIosKind(kind)) {
    return {
      ...base,
      kind,
      running: defaultIosConfig(kind, model.id),
      startup: null,
      runtime: emptyIosRuntime(),
      ...(kind === 'wireless-router' ? { home: structuredClone(DEFAULT_HOME) } : {}),
    }
  }
  return { ...base, kind, net: { mode: 'static' }, runtime: { arp: [], neighbors: [] } }
}
