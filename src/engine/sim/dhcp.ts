import { produce } from 'immer'
import { isHostDevice, isIosDevice } from '../model/catalog'
import { broadcastOf, formatIpv4, maskToPrefix, networkOf, parseIpv4 } from '../model/ipv4'
import type { DhcpLease, IosDevice, Project } from '../model/types'
import { homeRouterConfig } from '../wireless/home'
import { forward } from './forward'
import { l2Reach } from './l2'
import { l3Interfaces } from './l3'
import { interfaceStatus } from './linkState'
import { hostNic } from '../wireless/association'
import { createRouting } from './rib'

const SERVER_PORT = 67
/** A client retries its DISCOVER; that also gets past the relay's first ARP. */
const RELAY_ATTEMPTS = 3

/**
 * Picks an address for `mac` in the pool serving the subnet of `gateway` (the
 * address of the interface the request arrived on, or of the relay agent).
 */
function allocate(server: IosDevice, gateway: number, mac: string): DhcpLease | null {
  const { dhcp } = server.running
  for (const pool of dhcp.pools) {
    const network = pool.network ? parseIpv4(pool.network) : null
    const mask = pool.mask ? parseIpv4(pool.mask) : null
    const prefix = mask === null ? null : maskToPrefix(mask)
    if (network === null || prefix === null || networkOf(gateway, prefix) !== network) continue

    const lease = (ip: string): DhcpLease => ({
      ip,
      mask: pool.mask!,
      gateway: pool.defaultRouter,
      dns: pool.dnsServer,
      serverId: server.id,
    })
    const bindings = server.runtime.dhcpBindings
    const known = bindings.find((b) => b.mac === mac && b.pool === pool.name)
    if (known) return lease(known.ip)

    const excluded = (ip: number) =>
      dhcp.excluded.some((e) => ip >= (parseIpv4(e.low) ?? 0) && ip <= (parseIpv4(e.high) ?? 0))
    const own = new Set(Object.values(server.running.interfaces).flatMap((i) => (i.ip ? [i.ip.address] : [])))
    const bound = new Set(bindings.map((b) => b.ip))
    for (let ip = network + 1; ip < broadcastOf(network, prefix); ip++) {
      const text = formatIpv4(ip)
      if (ip === gateway || excluded(ip) || own.has(text) || bound.has(text)) continue
      bindings.push({ ip: text, mac, pool: pool.name })
      return lease(text)
    }
  }
  return null
}

/** True if a relayed request reaches `serverIp` from the relay and the answer comes back. */
function relayReaches(project: Project, relayId: string, relayIp: number, serverIp: number): string | null {
  const routing = createRouting(project)
  for (let attempt = 0; attempt < RELAY_ATTEMPTS; attempt++) {
    const base = { ttl: 255, proto: 'udp' as const, id: SERVER_PORT, dstPort: SERVER_PORT }
    const there = forward(project, relayId, { ...base, src: relayIp, dst: serverIp }, routing)
    if (there.kind !== 'delivered') continue
    const back = forward(project, there.deviceId, { ...base, src: serverIp, dst: relayIp }, routing)
    if (back.kind === 'delivered' && back.deviceId === relayId) return there.deviceId
  }
  return null
}

/**
 * DHCP exchange for a host: its broadcast reaches every layer 3 interface of
 * its VLAN; the first one that is a DHCP server for that subnet, or relays to
 * one (`ip helper-address`), answers. Mutates the project. Returns true on success.
 */
export function dhcpRequest(project: Project, hostId: string): boolean {
  const host = project.devices[hostId]
  if (!host || !isHostDevice(host)) return false
  const nic = hostNic(project, host)
  const lease = obtainLease(project, hostId, nic.name, nic.mac)
  if (!lease) return false
  host.runtime.lease = lease
  host.runtime.arp = []
  return true
}

/** DHCP exchange for any client port (a host's card, a home router's Internet port). */
function obtainLease(project: Project, clientId: string, port: string, mac: string): DhcpLease | null {
  if (interfaceStatus(project, clientId, port).protocol !== 'up') return null
  for (const target of l2Reach(project, clientId, port)) {
    const device = project.devices[target.deviceId]
    if (!device || !isIosDevice(device)) continue
    const l3 = l3Interfaces(project, device.id).find((i) => i.iface === target.iface)
    if (!l3) continue

    let lease = allocate(device, l3.ip, mac)
    for (const helper of device.running.interfaces[target.iface]?.helperAddresses ?? []) {
      if (lease) break
      const serverIp = parseIpv4(helper)
      const serverId = serverIp === null ? null : relayReaches(project, device.id, l3.ip, serverIp)
      const server = serverId ? project.devices[serverId] : undefined
      if (server && isIosDevice(server)) lease = allocate(server, l3.ip, mac)
    }
    if (lease) return lease
  }
  return null
}

/**
 * Internet port of a home router in DHCP mode: asks the provider for an
 * address, then regenerates the router configuration with it.
 */
export function wanRequest(project: Project, routerId: string): boolean {
  const router = project.devices[routerId]
  if (!router || router.kind !== 'wireless-router' || !isIosDevice(router) || !router.home) return false
  const mac = router.ports.find((p) => p.name === 'Internet')!.mac
  const lease = obtainLease(project, routerId, 'Internet', mac)
  if (!lease) return false
  router.runtime.wanLease = lease
  router.running = homeRouterConfig(router.model, router.home, lease)
  return true
}

/** Gives the lease back to the server. Mutates the project. */
export function dhcpRelease(project: Project, hostId: string) {
  const host = project.devices[hostId]
  if (!host || !isHostDevice(host) || !host.runtime.lease) return
  const server = project.devices[host.runtime.lease.serverId]
  if (server && isIosDevice(server)) {
    // Bindings are per MAC: release those of both network cards.
    const macs = host.ports.map((p) => p.mac)
    server.runtime.dhcpBindings = server.runtime.dhcpBindings.filter((b) => !macs.includes(b.mac))
  }
  delete host.runtime.lease
  host.runtime.arp = []
}

/**
 * Lets every DHCP client without a lease try again, like real clients that keep
 * retrying. Called after each change so a PC gets its address as soon as the
 * network allows it. Pure: returns the same project when nothing changed.
 */
export function dhcpSettle(project: Project): Project {
  const devices = Object.values(project.devices)
  // Home routers first: once they have their Internet address, their LAN clients can follow.
  const routers = devices.filter(
    (d) => d.kind === 'wireless-router' && isIosDevice(d) && d.home?.wan.mode === 'dhcp' && !d.runtime.wanLease,
  )
  const waiting = devices.filter((d) => isHostDevice(d) && d.net.mode === 'dhcp' && !d.runtime.lease)
  if (!routers.length && !waiting.length) return project
  return produce(project, (draft) => {
    for (const router of routers) wanRequest(draft, router.id)
    for (const host of waiting) dhcpRequest(draft, host.id)
  })
}
