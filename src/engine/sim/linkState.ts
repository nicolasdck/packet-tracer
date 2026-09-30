import { isIosDevice } from '../model/catalog'
import { ifMedia } from '../model/ifname'
import type { IfName, LinkEnd, Project } from '../model/types'
import { linkAt } from '../project/topology'

export interface IfStatus {
  status: 'up' | 'down' | 'administratively down'
  protocol: 'up' | 'down'
}

const DOWN: IfStatus = { status: 'down', protocol: 'down' }
const ADMIN_DOWN: IfStatus = { status: 'administratively down', protocol: 'down' }
const UP: IfStatus = { status: 'up', protocol: 'up' }

/** True if the interface is administratively enabled (hosts are always enabled). */
function isEnabled(project: Project, end: LinkEnd): boolean {
  const device = project.devices[end.deviceId]
  if (!device) return false
  if (!isIosDevice(device)) return true
  return device.running.interfaces[end.port]?.shutdown === false
}

/**
 * Status of an interface as shown by `show ip interface brief`.
 * A physical link is up/up only when both ends are not shut down.
 */
export function interfaceStatus(project: Project, deviceId: string, ifName: IfName): IfStatus {
  const end = { deviceId, port: ifName }
  if (!isEnabled(project, end)) return ADMIN_DOWN
  // SVIs are handled with VLANs (lot 4); until then they stay down.
  if (ifMedia(ifName) === 'virtual') return DOWN
  const link = linkAt(project, end)
  if (!link) return DOWN
  const peer = link.a.deviceId === deviceId && link.a.port === ifName ? link.b : link.a
  return isEnabled(project, peer) ? UP : DOWN
}
