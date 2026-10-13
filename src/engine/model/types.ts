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
  /** Plain text, always displayed hashed (type 5). */
  enableSecret?: string
  bannerMotd?: { delimiter: string; text: string }
  servicePasswordEncryption: boolean
  lines: { console: LineConfig; vty: LineConfig }
  /** Physical ports, subinterfaces ("GigabitEthernet0/0.10") and SVIs ("Vlan10"). */
  interfaces: Record<IfName, IfConfig>
  /**
   * VLAN database. Like vlan.dat on a real switch it is not shown in the
   * running-config and survives a reload.
   */
  vlans: Record<number, VlanConfig>
  /** Routes between interfaces (routers: on by default; 3560: `ip routing`). */
  ipRouting: boolean
  staticRoutes: StaticRoute[]
  /** Single OSPF process. */
  ospf?: OspfConfig
  dhcp: DhcpConfig
  /** Access lists by name (numbered lists use their number as name). */
  acls: Record<string, Acl>
  nat: NatConfig
  /** `ipv6 unicast-routing`: forwards IPv6 packets and advertises its prefixes (off by default). */
  ipv6Routing: boolean
  ipv6StaticRoutes: Ipv6StaticRoute[]
}

/** `ipv6 route <prefix>/<length> {<nextHop> | <iface> [<nextHop>]} [<distance>]` */
export interface Ipv6StaticRoute {
  prefix: string
  length: number
  nextHop?: string
  iface?: IfName
  distance: number
}

/** IPv6 settings of an interface. Present = IPv6 is enabled on it. */
export interface Ipv6IfConfig {
  /** `ipv6 enable`: link-local address only. */
  enabled?: boolean
  /** With `eui64`, `address` is the prefix and the interface ID comes from the MAC. */
  addresses: { address: string; prefix: number; eui64?: boolean }[]
  /** Manual link-local address; automatic (EUI-64) when absent. */
  linkLocal?: string
}

export interface AclAddress {
  address: string
  /** Wildcard mask: 0.0.0.0 = host, 255.255.255.255 = any. */
  wildcard: string
}

export type AclProtocol = 'ip' | 'icmp' | 'tcp' | 'udp'

export interface AclEntry {
  seq: number
  action: 'permit' | 'deny'
  src: AclAddress
  /** Extended lists only. */
  proto?: AclProtocol
  dst?: AclAddress
  srcPort?: number
  dstPort?: number
  icmpType?: 'echo' | 'echo-reply'
}

export interface Acl {
  name: string
  type: 'standard' | 'extended'
  entries: AclEntry[]
}

export interface NatConfig {
  statics: { local: string; global: string }[]
  pools: { name: string; start: string; end: string; netmask: string }[]
  /** `ip nat inside source list <acl> {pool <name> | interface <if>} [overload]` */
  dynamic: { acl: string; pool?: string; iface?: IfName; overload: boolean }[]
}

export interface DhcpPool {
  name: string
  network?: string
  mask?: string
  defaultRouter?: string
  dnsServer?: string
}

export interface DhcpConfig {
  pools: DhcpPool[]
  /** `ip dhcp excluded-address low [high]` */
  excluded: { low: string; high: string }[]
}

/** `ip route <network> <mask> {<nextHop> | <iface> [<nextHop>]} [<distance>]` */
export interface StaticRoute {
  network: string
  mask: string
  nextHop?: string
  iface?: IfName
  /** Administrative distance (1 by default). */
  distance: number
}

export interface OspfConfig {
  processId: number
  routerId?: string
  networks: { address: string; wildcard: string; area: number }[]
  passiveInterfaces: IfName[]
}

export interface LineConfig {
  /** Plain text. `encrypted`: shown as type 7 (set by service password-encryption, never reverted). */
  password?: { value: string; encrypted: boolean }
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
  ip?: { address: string; mask: string; method: 'manual' | 'NVRAM' }
  /** Ethernet only. */
  duplex?: Duplex
  speed?: Speed
  /** Serial DCE only, in bit/s. */
  clockRate?: number
  /** Switch ports only (absent on routed ports). */
  switchport?: SwitchportConfig
  /** Subinterfaces only: 802.1Q tag handled by this subinterface. */
  encapsulation?: { vlan: number; native: boolean }
  /** `ip helper-address`: DHCP servers that broadcasts received here are relayed to. */
  helperAddresses?: string[]
  /** `ip access-group <acl> in|out` */
  accessGroup?: { in?: string; out?: string }
  /** `ip nat inside|outside` */
  nat?: 'inside' | 'outside'
  ipv6?: Ipv6IfConfig
}

export interface SwitchportConfig {
  mode: 'dynamic-auto' | 'access' | 'trunk'
  accessVlan: number
  nativeVlan: number
  allowedVlans: 'all' | number[]
  /** 3560 only: a trunk needs `switchport trunk encapsulation dot1q`. */
  trunkEncapsulation?: 'dot1q'
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

export interface DhcpBinding {
  ip: string
  mac: string
  pool: string
}

export type NatProtocol = 'icmp' | 'udp' | 'tcp'

/** Dynamic NAT translation. Without "proto" it is a one-to-one entry (no overload). */
export interface NatEntry {
  proto?: NatProtocol
  insideLocal: string
  insideGlobal: string
  /** ICMP identifier or source port, before and after translation (PAT). */
  localId?: number
  globalId?: number
  /** Remote address of the flow (PAT). */
  outside?: string
  outsideId?: number
}

export interface IosRuntime {
  mac: MacEntry[]
  arp: ArpEntry[]
  dhcpBindings: DhcpBinding[]
  natTranslations: NatEntry[]
  /** Matches per ACL entry, keyed "<acl>|<sequence>". */
  aclHits: Record<string, number>
  /** IPv6 neighbor cache (the IPv6 counterpart of the ARP table). */
  neighbors: NeighborEntry[]
}

export interface NeighborEntry {
  ip: string
  mac: string
  iface: IfName
}

export interface HostNetConfig {
  mode: 'static' | 'dhcp'
  ip?: string
  mask?: string
  gateway?: string
  dns?: string
  ipv6?: HostIpv6Config
}

/**
 * IPv6 settings of a host. `auto` (SLAAC) builds the address from the prefix a
 * router advertises on the link; the link-local address always exists.
 */
export interface HostIpv6Config {
  mode: 'auto' | 'static'
  address?: string
  prefix?: number
  gateway?: string
}

export interface DhcpLease {
  ip: string
  mask: string
  gateway?: string
  dns?: string
  /** Device that granted the lease. */
  serverId: string
}

export interface HostRuntime {
  arp: ArpEntry[]
  neighbors: NeighborEntry[]
  /** Address obtained in DHCP mode. */
  lease?: DhcpLease
}
