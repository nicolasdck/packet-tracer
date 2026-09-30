import { isIosDevice } from '../model/catalog'
import type { IfName, LinkEnd, Project } from '../model/types'
import { linkAt } from '../project/topology'
import { interfaceStatus } from './linkState'

function isUp(project: Project, end: LinkEnd): boolean {
  return interfaceStatus(project, end.deviceId, end.port).status === 'up'
}

function peerOf(project: Project, end: LinkEnd): LinkEnd | null {
  const link = linkAt(project, end)
  if (!link) return null
  return link.a.deviceId === end.deviceId && link.a.port === end.port ? link.b : link.a
}

/** A switch port forwards frames at layer 2 instead of terminating them. */
function isSwitchPort(project: Project, end: LinkEnd): boolean {
  const device = project.devices[end.deviceId]
  if (!device || !isIosDevice(device) || device.kind === 'router') return false
  return !!device.running.interfaces[end.port]?.switchport
}

/**
 * Layer 3 interfaces reachable at layer 2 from an interface (its broadcast domain),
 * flooding through switches. Loops are cut by remembering visited ports.
 */
export function l2Domain(project: Project, deviceId: string, iface: IfName): LinkEnd[] {
  const start = { deviceId, port: iface }
  if (!isUp(project, start)) return []
  const found: LinkEnd[] = []
  const visited = new Set<string>()
  const queue: LinkEnd[] = []
  const first = peerOf(project, start)
  if (first) queue.push(first)

  while (queue.length) {
    const end = queue.shift()!
    const key = `${end.deviceId}|${end.port}`
    if (visited.has(key) || !isUp(project, end)) continue
    visited.add(key)
    if (!isSwitchPort(project, end)) {
      found.push(end)
      continue
    }
    // Flood out of every other forwarding port of the switch.
    const sw = project.devices[end.deviceId]!
    for (const port of sw.ports) {
      if (port.name === end.port) continue
      const out = { deviceId: end.deviceId, port: port.name }
      if (!isSwitchPort(project, out) || !isUp(project, out)) continue
      visited.add(`${out.deviceId}|${out.port}`)
      const next = peerOf(project, out)
      if (next) queue.push(next)
    }
  }
  return found
}
