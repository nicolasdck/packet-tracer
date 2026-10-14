import { produce } from 'immer'
import { findModel } from '../model/catalog'
import { broadcastOf, formatIpv4, maskToPrefix, networkOf, parseIpv4 } from '../model/ipv4'
import type { DhcpLease, HomeRouterSettings, IfConfig, IosConfig, IosDevice, Project, WifiSettings } from '../model/types'
import { baseIosConfig } from '../project/create'

/**
 * Home Wi-Fi router (Linksys WRT300N style). It has no CLI: its settings page
 * generates the equivalent IOS configuration, which the engine simulates like
 * any other router:
 * - Ethernet1-4 and the radio slots are access ports of VLAN 1, the LAN address
 *   is on interface Vlan1;
 * - DHCP server for the LAN, NAT overload from the LAN to the Internet port;
 * - default route to the provider (static, or learned by DHCP on the Internet port).
 */

export const DEFAULT_HOME: HomeRouterSettings = {
  lan: { ip: '192.168.0.1', mask: '255.255.255.0' },
  dhcp: { enabled: true, start: 100, max: 50 },
  wan: { mode: 'dhcp' },
  wifi: { ssid: 'Default', security: 'open' },
}

const LAN_ACL = '1'

const accessPort = (): IfConfig => ({
  shutdown: false,
  duplex: 'auto',
  speed: 'auto',
  switchport: { mode: 'access', accessVlan: 1, nativeVlan: 1, allowedVlans: 'all' },
})

/** The IOS configuration equivalent to the settings (and WAN lease, in DHCP mode). */
export function homeRouterConfig(modelId: string, settings: HomeRouterSettings, lease?: DhcpLease): IosConfig {
  const model = findModel('wireless-router', modelId)
  const config = baseIosConfig('wireless-router')
  config.ipRouting = true

  const interfaces: Record<string, IfConfig> = {}
  for (const port of model.ports) {
    if (port !== 'Internet') interfaces[port] = accessPort()
  }
  const wan = settings.wan.mode === 'static' ? settings.wan : lease
  interfaces['Internet'] = {
    shutdown: false,
    duplex: 'auto',
    speed: 'auto',
    nat: 'outside',
    ...(wan?.ip && wan.mask ? { ip: { address: wan.ip, mask: wan.mask, method: 'manual' as const } } : {}),
  }
  interfaces['Vlan1'] = {
    shutdown: false,
    nat: 'inside',
    ip: { address: settings.lan.ip, mask: settings.lan.mask, method: 'manual' },
  }
  config.interfaces = interfaces
  config.vlans = { 1: { name: 'default' } }

  if (wan?.gateway) config.staticRoutes = [{ network: '0.0.0.0', mask: '0.0.0.0', nextHop: wan.gateway, distance: 1 }]

  const lanIp = parseIpv4(settings.lan.ip)!
  const prefix = maskToPrefix(parseIpv4(settings.lan.mask)!)!
  const network = networkOf(lanIp, prefix)
  const wildcard = formatIpv4((~parseIpv4(settings.lan.mask)! >>> 0) & 0xffffffff)

  if (settings.dhcp.enabled) {
    const first = network + settings.dhcp.start
    const last = first + settings.dhcp.max - 1
    config.dhcp = {
      pools: [
        {
          name: 'LAN',
          network: formatIpv4(network),
          mask: settings.lan.mask,
          defaultRouter: settings.lan.ip,
          dnsServer: (settings.wan.mode === 'static' ? settings.wan.dns : lease?.dns) ?? settings.lan.ip,
        },
      ],
      // Only the range start..start+max-1 is handed out.
      excluded: [
        ...(first > network + 1 ? [{ low: formatIpv4(network + 1), high: formatIpv4(first - 1) }] : []),
        ...(last < broadcastOf(network, prefix) - 1
          ? [{ low: formatIpv4(last + 1), high: formatIpv4(broadcastOf(network, prefix) - 1) }]
          : []),
      ],
    }
  }
  config.acls = {
    [LAN_ACL]: {
      name: LAN_ACL,
      type: 'standard',
      entries: [{ seq: 10, action: 'permit', src: { address: formatIpv4(network), wildcard } }],
    },
  }
  config.nat = { statics: [], pools: [], dynamic: [{ acl: LAN_ACL, iface: 'Internet', overload: true }] }
  return config
}

export type HomeRouterErrors = Partial<Record<'lan' | 'dhcp' | 'wan' | 'ssid' | 'passphrase', string>>

const validIp = (text?: string) => !!text && parseIpv4(text) !== null
const validMask = (text?: string) => !!text && parseIpv4(text) !== null && maskToPrefix(parseIpv4(text)!) !== null

export function validateWifi(wifi: WifiSettings): HomeRouterErrors {
  const errors: HomeRouterErrors = {}
  if (!wifi.ssid.trim() || wifi.ssid.length > 32) errors.ssid = 'SSID must be 1 to 32 characters'
  // WPA2 personal: the passphrase is 8 to 63 characters.
  if (wifi.security === 'wpa2' && ((wifi.passphrase ?? '').length < 8 || (wifi.passphrase ?? '').length > 63)) {
    errors.passphrase = 'Passphrase must be 8 to 63 characters'
  }
  return errors
}

export function validateHomeRouter(settings: HomeRouterSettings): HomeRouterErrors {
  const errors = validateWifi(settings.wifi)
  const { lan, dhcp, wan } = settings
  if (!validIp(lan.ip) || !validMask(lan.mask)) {
    errors.lan = 'Invalid LAN address or mask'
  } else {
    const ip = parseIpv4(lan.ip)!
    const prefix = maskToPrefix(parseIpv4(lan.mask)!)!
    const network = networkOf(ip, prefix)
    if (prefix > 30 || ip === network || ip === broadcastOf(ip, prefix)) errors.lan = 'Invalid LAN address or mask'
    const lastOffset = broadcastOf(ip, prefix) - network - 1
    if (dhcp.enabled && (dhcp.start < 1 || dhcp.max < 1 || dhcp.start + dhcp.max - 1 > lastOffset)) {
      errors.dhcp = `The DHCP range must stay within the LAN (offsets 1 to ${lastOffset})`
    }
  }
  if (wan.mode === 'static') {
    if (!validIp(wan.ip) || !validMask(wan.mask)) errors.wan = 'Invalid Internet address or mask'
    else if (wan.gateway && !validIp(wan.gateway)) errors.wan = 'Invalid default gateway'
    else if (wan.dns && !validIp(wan.dns)) errors.wan = 'Invalid DNS server'
  }
  return errors
}

function homeRouter(project: Project, deviceId: string): IosDevice {
  const device = project.devices[deviceId]
  if (!device || device.kind !== 'wireless-router') throw new Error(`Not a wireless router: ${deviceId}`)
  return device as IosDevice
}

/** Applies the settings page (throws if invalid) and regenerates the configuration. */
export function setHomeRouter(project: Project, deviceId: string, settings: HomeRouterSettings): Project {
  homeRouter(project, deviceId)
  const first = Object.values(validateHomeRouter(settings))[0]
  if (first) throw new Error(first)
  return produce(project, (draft) => {
    const device = homeRouter(draft, deviceId)
    const lanChanged = device.home?.lan.ip !== settings.lan.ip || device.home?.lan.mask !== settings.lan.mask
    device.home = structuredClone(settings)
    if (settings.wan.mode === 'static') delete device.runtime.wanLease
    if (lanChanged) device.runtime.dhcpBindings = []
    device.runtime.arp = []
    device.runtime.natTranslations = []
    device.running = homeRouterConfig(device.model, settings, device.runtime.wanLease)
  })
}
