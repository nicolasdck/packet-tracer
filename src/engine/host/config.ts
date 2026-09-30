import { produce } from 'immer'
import { isHostDevice } from '../model/catalog'
import { broadcastOf, maskToPrefix, networkOf, parseIpv4 } from '../model/ipv4'
import type { HostDevice, Project } from '../model/types'

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
    const host = hostDevice(draft, deviceId)
    host.net = { mode: 'static', ip: value(input.ip), mask: value(input.mask), gateway: value(input.gateway) }
    if (!host.net.ip) delete host.net.ip
    if (!host.net.mask) delete host.net.mask
    if (!host.net.gateway) delete host.net.gateway
    host.runtime.arp = []
  })
}
