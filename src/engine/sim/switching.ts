import { isIosDevice } from '../model/catalog'
import type { IfName, IosDevice, LinkEnd, Project, SwitchportConfig } from '../model/types'
import { linkAt } from '../project/topology'

/** Switch device and its switchport config, if this port is a layer 2 switch port. */
export function switchPort(project: Project, end: LinkEnd): { device: IosDevice; sp: SwitchportConfig } | null {
  const device = project.devices[end.deviceId]
  if (!device || !isIosDevice(device) || device.kind === 'router') return null
  const sp = device.running.interfaces[end.port]?.switchport
  return sp ? { device, sp } : null
}

export function peerOf(project: Project, end: LinkEnd): LinkEnd | null {
  const link = linkAt(project, end)
  if (!link) return null
  return link.a.deviceId === end.deviceId && link.a.port === end.port ? link.b : link.a
}

/**
 * Operational mode of a switch port. "dynamic auto" (DTP) becomes a trunk
 * only when the other end is configured as a trunk; otherwise it is an access port.
 */
export function operMode(project: Project, end: LinkEnd): 'access' | 'trunk' | null {
  const own = switchPort(project, end)
  if (!own) return null
  if (own.sp.mode !== 'dynamic-auto') return own.sp.mode
  const peer = peerOf(project, end)
  const other = peer && switchPort(project, peer)
  return other?.sp.mode === 'trunk' ? 'trunk' : 'access'
}

export function vlanExists(device: IosDevice, vlan: number): boolean {
  return device.running.vlans[vlan] !== undefined
}

function allowed(sp: SwitchportConfig, vlan: number): boolean {
  return sp.allowedVlans === 'all' || sp.allowedVlans.includes(vlan)
}

/**
 * How a port sends frames of `vlan`: untagged (tag null), tagged, or not at all (undefined).
 */
export function egressTag(project: Project, end: LinkEnd, vlan: number): number | null | undefined {
  const own = switchPort(project, end)
  if (!own || !vlanExists(own.device, vlan)) return undefined
  const mode = operMode(project, end)
  if (mode === 'access') return own.sp.accessVlan === vlan ? null : undefined
  if (!allowed(own.sp, vlan)) return undefined
  return vlan === own.sp.nativeVlan ? null : vlan
}

/** VLAN a frame belongs to when it enters a switch port, or null if the port drops it. */
export function ingressVlan(project: Project, end: LinkEnd, tag: number | null): number | null {
  const own = switchPort(project, end)
  if (!own) return null
  const mode = operMode(project, end)
  let vlan: number | null
  if (mode === 'access') vlan = tag === null ? own.sp.accessVlan : null
  else vlan = tag === null ? own.sp.nativeVlan : allowed(own.sp, tag) ? tag : null
  return vlan !== null && vlanExists(own.device, vlan) ? vlan : null
}

/** Switch ports of a device, in catalog order. */
export function switchPorts(device: IosDevice): IfName[] {
  return device.ports.map((p) => p.name).filter((n) => device.running.interfaces[n]?.switchport)
}
