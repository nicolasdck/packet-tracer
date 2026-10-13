import { isIosDevice } from '../model/catalog'
import { parentIf } from '../model/ifname'
import { baseMac } from '../model/mac'
import { maskToPrefix, networkOf, parseIpv4 } from '../model/ipv4'
import type { HostDevice, IfName, Project } from '../model/types'
import { interfaceStatus } from './linkState'

/** An interface that can send and receive IP packets (up/up, with an address). */
export interface L3Interface {
  deviceId: string
  iface: IfName
  ip: number
  prefix: number
  mac: string
}

/** MAC of an interface: its port's, its parent port's for a subinterface, the base MAC for an SVI. */
export function macOf(project: Project, deviceId: string, iface: IfName): string {
  const device = project.devices[deviceId]!
  const port = device.ports.find((p) => p.name === parentIf(iface))
  return port?.mac ?? baseMac(deviceId)
}

/** Address settings a host actually uses: its static configuration, or its DHCP lease. */
export function hostAddress(host: HostDevice): { ip?: string; mask?: string; gateway?: string; dns?: string } {
  return host.net.mode === 'dhcp' ? (host.runtime.lease ?? {}) : host.net
}

export function l3Interfaces(project: Project, deviceId: string): L3Interface[] {
  const device = project.devices[deviceId]
  if (!device) return []
  const out: L3Interface[] = []
  const add = (iface: IfName, address?: string, mask?: string) => {
    const ip = address ? parseIpv4(address) : null
    const m = mask ? parseIpv4(mask) : null
    const prefix = m === null ? null : maskToPrefix(m)
    if (ip === null || prefix === null) return
    if (interfaceStatus(project, deviceId, iface).protocol !== 'up') return
    out.push({ deviceId, iface, ip, prefix, mac: macOf(project, deviceId, iface) })
  }
  if (isIosDevice(device)) {
    for (const [name, cfg] of Object.entries(device.running.interfaces)) {
      if (!cfg.switchport) add(name, cfg.ip?.address, cfg.ip?.mask)
    }
  } else {
    const address = hostAddress(device)
    add(device.ports[0]!.name, address.ip, address.mask)
  }
  return out
}

/** The up interface of the device that carries this address, if any. */
export function interfaceWithIp(project: Project, deviceId: string, ip: number): L3Interface | undefined {
  return l3Interfaces(project, deviceId).find((i) => i.ip === ip)
}

export function inSubnet(ip: number, l3: { ip: number; prefix: number }): boolean {
  return networkOf(ip, l3.prefix) === networkOf(l3.ip, l3.prefix)
}
