import { produce } from 'immer'
import { isHostDevice } from '../model/catalog'
import { ifMedia } from '../model/ifname'
import type { HostDevice, IosDevice, Link, Port, Project, WifiSettings } from '../model/types'
import { linkAt } from '../project/topology'
import { dhcpRelease } from '../sim/dhcp'

const WIRELESS_NIC = 'Wireless0'

/**
 * Network card a host uses: a laptop uses its wireless card once associated
 * with an access point, its Ethernet port otherwise.
 */
export function hostNic(project: Project, host: HostDevice): Port {
  const wireless = host.ports.find((p) => p.name === WIRELESS_NIC)
  if (wireless && linkAt(project, { deviceId: host.id, port: WIRELESS_NIC })) return wireless
  return host.ports[0]!
}

export function isWirelessLink(link: Link): boolean {
  return ifMedia(link.a.port) === 'wireless'
}

/** A laptop joins an access point with the same SSID and security (and key, with WPA2). */
function accepts(ap: WifiSettings, client: WifiSettings): boolean {
  if (ap.ssid !== client.ssid || ap.security !== client.security) return false
  return ap.security === 'open' || ap.passphrase === client.passphrase
}

/**
 * Associates every laptop with the access point matching its Wi-Fi settings
 * (radio range is not simulated), and drops associations that no longer match.
 * An association is a link from the laptop's Wireless0 to a free radio slot
 * of the router. Pure: returns the same project when nothing changes.
 */
export function wirelessSettle(project: Project): Project {
  const routers = Object.values(project.devices).filter((d): d is IosDevice => d.kind === 'wireless-router')
  const laptops = Object.values(project.devices).filter(
    (d): d is HostDevice => isHostDevice(d) && d.ports.some((p) => p.name === WIRELESS_NIC),
  )

  const changes: { laptop: HostDevice; drop?: Link; joinRouterId?: string }[] = []
  for (const laptop of laptops) {
    const current = linkAt(project, { deviceId: laptop.id, port: WIRELESS_NIC })
    const currentRouter = current && (current.a.deviceId === laptop.id ? current.b.deviceId : current.a.deviceId)
    const wifi = laptop.net.wifi
    const target = wifi ? routers.find((r) => r.home && accepts(r.home.wifi, wifi)) : undefined
    if (current && currentRouter === target?.id) continue
    if (!current && !target) continue
    changes.push({ laptop, drop: current, joinRouterId: target?.id })
  }
  if (!changes.length) return project

  return produce(project, (draft) => {
    for (const { laptop, drop, joinRouterId } of changes) {
      if (drop) delete draft.links[drop.id]
      if (joinRouterId) {
        const router = draft.devices[joinRouterId]!
        const slot = router.ports.find(
          (p) => ifMedia(p.name) === 'wireless' && !linkAt(draft, { deviceId: router.id, port: p.name }),
        )
        // Every radio slot is taken: the access point refuses more clients.
        if (slot) {
          draft.seq++
          const id = `l${draft.seq}`
          draft.links[id] = { id, a: { deviceId: laptop.id, port: WIRELESS_NIC }, b: { deviceId: router.id, port: slot.name } }
        }
      }
      // The laptop switched network card or network: it starts over (address, caches).
      const host = draft.devices[laptop.id] as HostDevice
      dhcpRelease(draft, laptop.id)
      host.runtime.arp = []
      host.runtime.neighbors = []
    }
  })
}
