import { isIosDevice } from '../model/catalog'
import { parentIf, sviVlan } from '../model/ifname'
import type { IfName, LinkEnd, Project } from '../model/types'
import { interfaceStatus } from './linkState'
import { egressTag, ingressVlan, peerOf, switchPort, switchPorts } from './switching'

/** A frame crossing a switch: in on `inPort`, out on `outPort` (a port or an SVI), in `vlan`. */
export interface L2Hop {
  deviceId: string
  inPort: IfName
  outPort: IfName
  vlan: number
}

/** A layer 3 interface reached at layer 2, with the switches crossed to get there. */
export interface L2Target {
  deviceId: string
  iface: IfName
  path: L2Hop[]
}

const isUp = (project: Project, end: LinkEnd) => interfaceStatus(project, end.deviceId, end.port).protocol === 'up'

/**
 * Layer 3 interfaces that accept a frame arriving untagged (tag null) or with an
 * 802.1Q tag on a physical port of a router, host or routed switch port.
 */
function acceptingInterfaces(project: Project, end: LinkEnd, tag: number | null): IfName[] {
  const device = project.devices[end.deviceId]
  if (!device) return []
  if (!isIosDevice(device)) return tag === null ? [end.port] : []
  const out: IfName[] = []
  for (const [name, cfg] of Object.entries(device.running.interfaces)) {
    if (parentIf(name) !== end.port || cfg.switchport) continue
    const enc = cfg.encapsulation
    const accepts = name === end.port
      ? tag === null
      : enc !== undefined && (enc.vlan === tag || (enc.native && tag === null))
    if (accepts && isUp(project, { deviceId: end.deviceId, port: name })) out.push(name)
  }
  return out
}

interface Frame {
  at: LinkEnd
  tag: number | null
  path: L2Hop[]
}

/**
 * Broadcast domain of a layer 3 interface: every layer 3 interface its frames
 * reach, flooding through switches (VLAN and trunk aware). Each switch floods a
 * VLAN once, which also protects against switching loops.
 */
export function l2Reach(project: Project, deviceId: string, iface: IfName): L2Target[] {
  if (!isUp(project, { deviceId, port: iface })) return []
  const device = project.devices[deviceId]!
  const targets: L2Target[] = []
  const flooded = new Set<string>()
  const delivered = new Set<string>()
  const queue: Frame[] = []

  /** Sends a frame of `vlan` out of every forwarding port of switch `swId` except `inPort`. */
  const flood = (swId: string, vlan: number, inPort: IfName | null, path: L2Hop[]) => {
    const sw = project.devices[swId]
    if (!sw || !isIosDevice(sw)) return
    for (const port of switchPorts(sw)) {
      const out = { deviceId: swId, port }
      if (port === inPort || !isUp(project, out)) continue
      const tag = egressTag(project, out, vlan)
      const peer = peerOf(project, out)
      if (tag === undefined || !peer) continue
      const hop = inPort === null ? [] : [{ deviceId: swId, inPort, outPort: port, vlan }]
      queue.push({ at: peer, tag, path: [...path, ...hop] })
    }
    // The switch's own SVI in this VLAN (not when the frame comes from it).
    const svi = `Vlan${vlan}`
    if (inPort !== null && sw.running.interfaces[svi] && isUp(project, { deviceId: swId, port: svi })) {
      targets.push({ deviceId: swId, iface: svi, path: [...path, { deviceId: swId, inPort, outPort: svi, vlan }] })
    }
  }

  const vlan = sviVlan(iface)
  if (vlan !== null && isIosDevice(device)) {
    // An SVI sends inside its own switch.
    flooded.add(`${deviceId}|${vlan}`)
    flood(deviceId, vlan, null, [])
  } else {
    const physical = parentIf(iface)
    const enc = isIosDevice(device) ? device.running.interfaces[iface]?.encapsulation : undefined
    const tag = enc && !enc.native ? enc.vlan : null
    const peer = peerOf(project, { deviceId, port: physical })
    if (peer) queue.push({ at: peer, tag, path: [] })
  }

  while (queue.length) {
    const { at, tag, path } = queue.shift()!
    if (!isUp(project, at)) continue
    if (switchPort(project, at)) {
      const v = ingressVlan(project, at, tag)
      if (v === null) continue
      const key = `${at.deviceId}|${v}`
      if (flooded.has(key)) continue
      flooded.add(key)
      flood(at.deviceId, v, at.port, path)
      continue
    }
    for (const name of acceptingInterfaces(project, at, tag)) {
      const key = `${at.deviceId}|${name}`
      if (delivered.has(key) || (at.deviceId === deviceId && name === iface)) continue
      delivered.add(key)
      targets.push({ deviceId: at.deviceId, iface: name, path })
    }
  }
  return targets
}
