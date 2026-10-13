import { produce } from 'immer'
import { parseIpv4 } from '../model/ipv4'
import { parseIpv6 } from '../model/ipv6'
import type { Project } from '../model/types'
import { ping } from '../sim/ping'
import { buildRib, lookupRoute, type Route } from '../sim/rib'
import { ping6 } from '../sim/v6'

/**
 * Pure queries on the network state, for automatic lab checks.
 * They never modify the project passed in.
 */

/** True if `fromDeviceId` gets at least one reply out of 5 echoes to `ip` (IPv4 or IPv6). */
export function canPing(project: Project, fromDeviceId: string, ip: string): boolean {
  const dst = parseIpv4(ip)
  const dst6 = parseIpv6(ip)
  if (dst === null && dst6 === null) return false
  let ok = false
  produce(project, (draft) => {
    const result = dst !== null ? ping(draft, fromDeviceId, dst, 5) : ping6(draft, fromDeviceId, dst6!, 5)
    ok = result.echoes.some((e) => e.mark === '!')
  })
  return ok
}

/** The route a device would use for `ip` (longest prefix match), if any. */
export function getRoute(project: Project, deviceId: string, ip: string): Route | undefined {
  const dst = parseIpv4(ip)
  return dst === null ? undefined : lookupRoute(buildRib(project, deviceId), dst)
}
