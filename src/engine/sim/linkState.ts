import { isIosDevice } from '../model/catalog'
import { isSubinterface, parentIf, sviVlan } from '../model/ifname'
import type { IfName, LinkEnd, Project } from '../model/types'
import { linkAt } from '../project/topology'
import { egressTag, switchPorts } from './switching'

export interface IfStatus {
  status: 'up' | 'down' | 'administratively down'
  protocol: 'up' | 'down'
}

const DOWN: IfStatus = { status: 'down', protocol: 'down' }
const ADMIN_DOWN: IfStatus = { status: 'administratively down', protocol: 'down' }
const UP: IfStatus = { status: 'up', protocol: 'up' }

/** True if the interface exists and is administratively enabled (hosts are always enabled). */
function isEnabled(project: Project, end: LinkEnd): boolean {
  const device = project.devices[end.deviceId]
  if (!device) return false
  if (!isIosDevice(device)) return true
  return device.running.interfaces[end.port]?.shutdown === false
}

/** A physical port is up/up when it is cabled and both ends are not shut down. */
function physicalStatus(project: Project, end: LinkEnd): IfStatus {
  const link = linkAt(project, end)
  if (!link) return DOWN
  const peer = link.a.deviceId === end.deviceId && link.a.port === end.port ? link.b : link.a
  return isEnabled(project, peer) ? UP : DOWN
}

/**
 * Status of an interface as shown by `show ip interface brief`:
 * - physical: up/up when cabled and both ends are enabled;
 * - subinterface: follows its physical interface;
 * - SVI: up/up when its VLAN exists and at least one up switch port carries it.
 */
export function interfaceStatus(project: Project, deviceId: string, ifName: IfName): IfStatus {
  const end = { deviceId, port: ifName }
  if (!isEnabled(project, end)) return ADMIN_DOWN
  if (isSubinterface(ifName)) {
    return interfaceStatus(project, deviceId, parentIf(ifName)).protocol === 'up' ? UP : DOWN
  }
  const vlan = sviVlan(ifName)
  if (vlan !== null) {
    const device = project.devices[deviceId]
    if (!device || !isIosDevice(device)) return DOWN
    const active = switchPorts(device).some((port) => {
      const p = { deviceId, port }
      return isEnabled(project, p) && physicalStatus(project, p) === UP && egressTag(project, p, vlan) !== undefined
    })
    return active ? UP : DOWN
  }
  return physicalStatus(project, end)
}
