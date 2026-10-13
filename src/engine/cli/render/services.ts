import type { IosConfig, IosDevice, NatEntry } from '../../model/types'

export function showIpDhcpBinding(device: IosDevice): string[] {
  const out = [
    'IP address       Client-ID/              Lease expiration        Type',
    '                 Hardware address',
  ]
  for (const b of device.runtime.dhcpBindings) {
    out.push(`${b.ip.padEnd(17)}${b.mac.padEnd(24)}${'--'.padEnd(24)}Automatic`)
  }
  return out
}

/** Columns keep at least one space when a value is wider than its column. */
const col = (text: string, width: number) => (text.length >= width ? `${text} ` : text.padEnd(width))

export function showIpNatTranslations(device: IosDevice): string[] {
  const row = (pro: string, insideGlobal: string, insideLocal: string, outsideLocal: string, outsideGlobal: string) =>
    `${col(pro, 5)}${col(insideGlobal, 18)}${col(insideLocal, 19)}${col(outsideLocal, 19)}${outsideGlobal}`
  const withId = (ip: string, id?: number) => (id === undefined ? ip : `${ip}:${id}`)
  const dynamic = (e: NatEntry) => {
    if (e.proto === undefined) return row('---', e.insideGlobal, e.insideLocal, '---', '---')
    const outside = withId(e.outside ?? '', e.outsideId)
    return row(e.proto, withId(e.insideGlobal, e.globalId), withId(e.insideLocal, e.localId), outside, outside)
  }
  const lines = [
    ...device.running.nat.statics.map((s) => row('---', s.global, s.local, '---', '---')),
    ...device.runtime.natTranslations.map(dynamic),
  ]
  if (!lines.length) return []
  return [row('Pro', 'Inside global', 'Inside local', 'Outside local', 'Outside global'), ...lines, '']
}

/** DHCP server configuration as it appears in the running-config. */
export function dhcpConfigLines(config: IosConfig): string[] {
  const out: string[] = []
  for (const e of config.dhcp.excluded) {
    out.push(`ip dhcp excluded-address ${e.low}${e.high !== e.low ? ` ${e.high}` : ''}`)
  }
  if (out.length) out.push('!')
  for (const pool of config.dhcp.pools) {
    out.push(`ip dhcp pool ${pool.name}`)
    if (pool.network) out.push(` network ${pool.network} ${pool.mask}`)
    if (pool.defaultRouter) out.push(` default-router ${pool.defaultRouter}`)
    if (pool.dnsServer) out.push(` dns-server ${pool.dnsServer}`)
    out.push('!')
  }
  return out
}

/** NAT configuration as it appears in the running-config. */
export function natConfigLines(config: IosConfig): string[] {
  const { nat } = config
  return [
    ...nat.pools.map((p) => `ip nat pool ${p.name} ${p.start} ${p.end} netmask ${p.netmask}`),
    ...nat.dynamic.map(
      (r) =>
        `ip nat inside source list ${r.acl} ${r.pool ? `pool ${r.pool}` : `interface ${r.iface}`}${r.overload ? ' overload' : ''}`,
    ),
    ...nat.statics.map((s) => `ip nat inside source static ${s.local} ${s.global}`),
  ]
}
