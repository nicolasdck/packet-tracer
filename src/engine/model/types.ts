/**
 * Network model. A project is a plain JSON-serializable object:
 * no classes, Maps, Sets, functions or Dates.
 */

export type DeviceKind = 'switch-l2' | 'switch-l3' | 'router' | 'pc' | 'server'
export type IosKind = Extract<DeviceKind, 'switch-l2' | 'switch-l3' | 'router'>
export type HostKind = Extract<DeviceKind, 'pc' | 'server'>

/** Always the canonical IOS name: "GigabitEthernet0/0", "FastEthernet0/1", "Serial0/0/0". */
export type IfName = string

export interface Position {
  x: number
  y: number
}

export interface Project {
  schemaVersion: 1
  id: string
  name: string
  createdAt: number
  updatedAt: number
  /** Monotonic counter used to derive device/link ids and MAC addresses. */
  seq: number
  devices: Record<string, Device>
  links: Record<string, Link>
}

export interface LinkEnd {
  deviceId: string
  port: IfName
}

export interface Link {
  id: string
  a: LinkEnd
  b: LinkEnd
  /** Serial links only: the end that provides clocking. */
  dce?: 'a' | 'b'
}

/** Physical port (hardware), independent of the configuration. */
export interface Port {
  name: IfName
  mac: string
}

interface DeviceBase {
  id: string
  kind: DeviceKind
  model: string
  /** Canvas display name ("Router0"), distinct from the IOS hostname. */
  label: string
  position: Position
  ports: Port[]
}

export type Device = IosDevice | HostDevice

export interface IosDevice extends DeviceBase {
  kind: IosKind
  running: IosConfig
  /** null = "startup-config is not present". */
  startup: IosConfig | null
  runtime: IosRuntime
}

export interface HostDevice extends DeviceBase {
  kind: HostKind
  net: HostNetConfig
  runtime: HostRuntime
}

export interface IosConfig {
  hostname: string
  enableSecret?: string
  bannerMotd?: string
  servicePasswordEncryption: boolean
  lines: { console: LineConfig; vty: LineConfig }
  interfaces: Record<IfName, IfConfig>
  vlans: Record<number, VlanConfig>
}

export interface LineConfig {
  password?: string
  login: boolean
}

export interface VlanConfig {
  name: string
}

export type Duplex = 'auto' | 'full' | 'half'
export type Speed = 'auto' | 10 | 100 | 1000

export interface IfConfig {
  shutdown: boolean
  description?: string
  ip?: { address: string; mask: string }
  /** Ethernet only. */
  duplex?: Duplex
  speed?: Speed
  /** Serial DCE only, in bit/s. */
  clockRate?: number
  /** Switch ports only (absent on routed ports). */
  switchport?: SwitchportConfig
}

export interface SwitchportConfig {
  mode: 'dynamic-auto' | 'access' | 'trunk'
  accessVlan: number
  nativeVlan: number
  allowedVlans: 'all' | number[]
}

export interface MacEntry {
  vlan: number
  mac: string
  port: IfName
}

export interface ArpEntry {
  ip: string
  mac: string
  iface: IfName
}

export interface IosRuntime {
  mac: MacEntry[]
  arp: ArpEntry[]
}

export interface HostNetConfig {
  mode: 'static' | 'dhcp'
  ip?: string
  mask?: string
  gateway?: string
  dns?: string
}

export interface HostRuntime {
  arp: ArpEntry[]
}
