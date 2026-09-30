import { produce } from 'immer'
import { CATALOG } from '../model/catalog'
import { ifMedia } from '../model/ifname'
import type { Device, DeviceKind, IfName, Link, LinkEnd, Position, Project } from '../model/types'
import { createDevice } from './create'

export class TopologyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TopologyError'
  }
}

export const MAX_LABEL_LENGTH = 32

function getDevice(project: Project, deviceId: string): Device {
  const device = project.devices[deviceId]
  if (!device) throw new TopologyError(`Unknown device: ${deviceId}`)
  return device
}

/** Lowest unused label for a prefix: "Router0", then "Router1"… (reuses gaps). */
export function nextLabel(project: Project, prefix: string): string {
  const used = new Set(Object.values(project.devices).map((d) => d.label))
  let i = 0
  while (used.has(`${prefix}${i}`)) i++
  return `${prefix}${i}`
}

export function addDevice(
  project: Project,
  kind: DeviceKind,
  position: Position,
): { project: Project; deviceId: string } {
  const seq = project.seq + 1
  const device = createDevice(kind, seq, nextLabel(project, CATALOG[kind].labelPrefix), position)
  const next = produce(project, (draft) => {
    draft.seq = seq
    draft.devices[device.id] = device
  })
  return { project: next, deviceId: device.id }
}

export function moveDevice(project: Project, deviceId: string, position: Position): Project {
  getDevice(project, deviceId)
  return produce(project, (draft) => {
    draft.devices[deviceId]!.position = { x: position.x, y: position.y }
  })
}

export function renameDevice(project: Project, deviceId: string, label: string): Project {
  getDevice(project, deviceId)
  const trimmed = label.trim()
  if (!trimmed) throw new TopologyError('Name cannot be empty')
  if (trimmed.length > MAX_LABEL_LENGTH) {
    throw new TopologyError(`Name cannot exceed ${MAX_LABEL_LENGTH} characters`)
  }
  return produce(project, (draft) => {
    draft.devices[deviceId]!.label = trimmed
  })
}

/** Links attached to a device. */
export function deviceLinks(project: Project, deviceId: string): Link[] {
  return Object.values(project.links).filter(
    (l) => l.a.deviceId === deviceId || l.b.deviceId === deviceId,
  )
}

/** Removes the device and every link attached to it. */
export function removeDevice(project: Project, deviceId: string): Project {
  getDevice(project, deviceId)
  const linkIds = deviceLinks(project, deviceId).map((l) => l.id)
  return produce(project, (draft) => {
    delete draft.devices[deviceId]
    for (const id of linkIds) delete draft.links[id]
  })
}

/** The link plugged into a port, if any. */
export function linkAt(project: Project, end: LinkEnd): Link | undefined {
  return Object.values(project.links).find(
    (l) =>
      (l.a.deviceId === end.deviceId && l.a.port === end.port) ||
      (l.b.deviceId === end.deviceId && l.b.port === end.port),
  )
}

export interface PortInfo {
  name: IfName
  linkId?: string
}

/** All physical ports of a device, in catalog order, with their link if used. */
export function listPorts(project: Project, deviceId: string): PortInfo[] {
  const device = getDevice(project, deviceId)
  return device.ports.map((p) => {
    const link = linkAt(project, { deviceId, port: p.name })
    return link ? { name: p.name, linkId: link.id } : { name: p.name }
  })
}

/** Returns why two ports cannot be linked, or null if they can. */
export function canConnect(project: Project, a: LinkEnd, b: LinkEnd): string | null {
  const devA = project.devices[a.deviceId]
  const devB = project.devices[b.deviceId]
  if (!devA || !devB) return 'Unknown device'
  if (a.deviceId === b.deviceId) return 'Cannot link a device to itself'
  if (!devA.ports.some((p) => p.name === a.port)) return `Unknown port ${a.port} on ${devA.label}`
  if (!devB.ports.some((p) => p.name === b.port)) return `Unknown port ${b.port} on ${devB.label}`
  if (linkAt(project, a)) return `${devA.label} ${a.port} is already in use`
  if (linkAt(project, b)) return `${devB.label} ${b.port} is already in use`
  if (ifMedia(a.port) !== ifMedia(b.port)) return 'Incompatible ports (serial ↔ ethernet)'
  return null
}

/** Links two free, compatible ports. On serial links, end `a` is the DCE. */
export function connect(
  project: Project,
  a: LinkEnd,
  b: LinkEnd,
): { project: Project; linkId: string } {
  const error = canConnect(project, a, b)
  if (error) throw new TopologyError(error)
  const seq = project.seq + 1
  const link: Link = { id: `l${seq}`, a: { ...a }, b: { ...b } }
  if (ifMedia(a.port) === 'serial') link.dce = 'a'
  const next = produce(project, (draft) => {
    draft.seq = seq
    draft.links[link.id] = link
  })
  return { project: next, linkId: link.id }
}

export function disconnect(project: Project, linkId: string): Project {
  if (!project.links[linkId]) throw new TopologyError(`Unknown link: ${linkId}`)
  return produce(project, (draft) => {
    delete draft.links[linkId]
  })
}
