import { produce } from 'immer'
import { parseIpv4 } from '../model/ipv4'
import type { Project } from '../model/types'
import { ping } from '../sim/ping'
import { buildRib, lookupRoute, type Route } from '../sim/rib'

/**
 * Pure queries on the network state, for automatic lab checks.
 * They never modify the project passed in.
 */

/** True if `fromDeviceId` gets at least one reply out of 5 echoes to `ip`. */
export function canPing(project: Project, fromDeviceId: string, ip: string): boolean {
  const dst = parseIpv4(ip)
  if (dst === null) return false
  let ok = false
  produce(project, (draft) => {
    ok = ping(draft, fromDeviceId, dst, 5).echoes.some((e) => e.mark === '!')
  })
  return ok
}

/** The route a device would use for `ip` (longest prefix match), if any. */
export function getRoute(project: Project, deviceId: string, ip: string): Route | undefined {
  const dst = parseIpv4(ip)
  return dst === null ? undefined : lookupRoute(buildRib(project, deviceId), dst)
}
