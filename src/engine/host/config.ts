import { produce } from 'immer'
import { isHostDevice } from '../model/catalog'
import { broadcastOf, maskToPrefix, networkOf, parseIpv4 } from '../model/ipv4'
import { formatIpv6, parseIpv6, parseIpv6Prefix } from '../model/ipv6'
import type { HostDevice, Project } from '../model/types'
import { dhcpRelease, dhcpRequest } from '../sim/dhcp'

export interface HostNetInput {
  ip: string
  mask: string
  gateway: string
}

export type HostNetErrors = Partial<Record<keyof HostNetInput, string>>

/** Validates a static IP configuration; empty fields mean "not set". */
export function validateHostNet(input: HostNetInput): HostNetErrors {
  const errors: HostNetErrors = {}
  const ip = input.ip.trim()
  const mask = input.mask.trim()
  const gateway = input.gateway.trim()

  const ipValue = ip ? parseIpv4(ip) : null
  if (ip && ipValue === null) errors.ip = 'Invalid IPv4 address'

  const maskValue = mask ? parseIpv4(mask) : null
  const prefix = maskValue === null ? null : maskToPrefix(maskValue)
  if (mask && (maskValue === null || prefix === null)) errors.mask = 'Invalid subnet mask'
  else if (ip && !mask) errors.mask = 'Subnet mask is required'

  if (ipValue !== null && prefix !== null && prefix < 31) {
    if (ipValue === networkOf(ipValue, prefix)) errors.ip = 'This is the network address'
    else if (ipValue === broadcastOf(ipValue, prefix)) errors.ip = 'This is the broadcast address'
  }

  if (gateway && parseIpv4(gateway) === null) errors.gateway = 'Invalid IPv4 address'
  return errors
}

function hostDevice(project: Project, deviceId: string): HostDevice {
  const device = project.devices[deviceId]
  if (!device || !isHostDevice(device)) throw new Error(`Not a host: ${deviceId}`)
  return device
}

/** Applies a static IP configuration (throws if invalid). Clears the host's ARP cache. */
export function setHostNet(project: Project, deviceId: string, input: HostNetInput): Project {
  hostDevice(project, deviceId)
  const errors = validateHostNet(input)
  const first = Object.values(errors)[0]
  if (first) throw new Error(first)
  const value = (s: string) => s.trim() || undefined
  return produce(project, (draft) => {
    // Going back to a static address gives the DHCP lease back.
    dhcpRelease(draft, deviceId)
    const host = hostDevice(draft, deviceId)
    const ipv6 = host.net.ipv6
    host.net = { mode: 'static', ip: value(input.ip), mask: value(input.mask), gateway: value(input.gateway) }
    if (ipv6) host.net.ipv6 = ipv6
    if (!host.net.ip) delete host.net.ip
    if (!host.net.mask) delete host.net.mask
    if (!host.net.gateway) delete host.net.gateway
    host.runtime.arp = []
  })
}

/**
 * Switches a host to DHCP and asks for an address right away. Without an
 * answer the host stays without address and retries later (see dhcpSettle).
 */
export function setHostDhcp(project: Project, deviceId: string): Project {
  hostDevice(project, deviceId)
  return produce(project, (draft) => {
    const host = hostDevice(draft, deviceId)
    // IPv6 settings are independent of the IPv4 mode.
    host.net = host.net.ipv6 ? { mode: 'dhcp', ipv6: host.net.ipv6 } : { mode: 'dhcp' }
    host.runtime.arp = []
    dhcpRequest(draft, deviceId)
  })
}

export interface HostIpv6Input {
  mode: 'auto' | 'static'
  /** "2001:db8:1::10/64"; the prefix length defaults to 64. */
  address: string
  gateway: string
}

export type HostIpv6Errors = Partial<Record<'address' | 'gateway', string>>

function parseHostAddress(text: string): { address: bigint; length: number } | null {
  const value = text.trim()
  if (value.includes('/')) return parseIpv6Prefix(value)
  const address = parseIpv6(value)
  return address === null ? null : { address, length: 64 }
}

/** Validates a static IPv6 configuration; empty fields mean "not set". */
export function validateHostIpv6(input: HostIpv6Input): HostIpv6Errors {
  const errors: HostIpv6Errors = {}
  if (input.mode !== 'static') return errors
  if (input.address.trim() && !parseHostAddress(input.address)) errors.address = 'Invalid IPv6 address'
  if (input.gateway.trim() && parseIpv6(input.gateway.trim()) === null) errors.gateway = 'Invalid IPv6 address'
  return errors
}

/** Applies the IPv6 settings of a host (throws if invalid). Clears its neighbor cache. */
export function setHostIpv6(project: Project, deviceId: string, input: HostIpv6Input): Project {
  hostDevice(project, deviceId)
  const first = Object.values(validateHostIpv6(input))[0]
  if (first) throw new Error(first)
  return produce(project, (draft) => {
    const host = hostDevice(draft, deviceId)
    host.runtime.neighbors = []
    if (input.mode === 'auto') {
      host.net.ipv6 = { mode: 'auto' }
      return
    }
    const parsed = input.address.trim() ? parseHostAddress(input.address) : null
    const gateway = input.gateway.trim() ? parseIpv6(input.gateway.trim()) : null
    host.net.ipv6 = { mode: 'static' }
    if (parsed) {
      host.net.ipv6.address = formatIpv6(parsed.address)
      host.net.ipv6.prefix = parsed.length
    }
    if (gateway !== null) host.net.ipv6.gateway = formatIpv6(gateway)
  })
}
