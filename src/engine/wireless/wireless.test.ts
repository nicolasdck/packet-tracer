import { describe, expect, it } from 'vitest'
import type { HomeRouterSettings, HostDevice, IosDevice } from '../model/types'
import { canConnect, linkAt } from '../project/topology'
import { network } from '../sim/testNetwork'
import { hostNic } from './association'
import { DEFAULT_HOME, validateHomeRouter } from './home'

const replies = (out: string) => out.split('\n').filter((l) => l.startsWith('Reply from') && !l.includes('unreachable'))

/**
 * Provider: ISP router g0/0 203.0.113.1/24 (DHCP for its customers) | g0/1 8.8.8.1 — Server 8.8.8.8
 * Home: Wireless Router Internet ↔ ISP g0/0, PC on Ethernet1, Laptop over Wi-Fi.
 * The ISP has no route to the private LAN: only NAT gets home traffic back.
 */
function home() {
  const n = network()
  const isp = n.add('router')
  const server = n.add('server')
  const ap = n.add('wireless-router')
  const pc = n.add('pc')
  const laptop = n.add('laptop')
  n.link(ap, 'Internet', isp, 'GigabitEthernet0/0')
  n.link(isp, 'GigabitEthernet0/1', server, 'FastEthernet0')
  n.link(pc, 'FastEthernet0', ap, 'Ethernet1')
  n.config(
    isp,
    'int g0/0', 'ip address 203.0.113.1 255.255.255.0', 'no shut',
    'int g0/1', 'ip address 8.8.8.1 255.255.255.0', 'no shut',
    'ip dhcp excluded-address 203.0.113.1',
    'ip dhcp pool CUSTOMERS', 'network 203.0.113.0 255.255.255.0', 'default-router 203.0.113.1', 'dns-server 8.8.8.8',
  )
  n.host(server, '8.8.8.8', '255.255.255.0', '8.8.8.1')
  n.settle()
  n.dhcp(pc)
  return { n, isp, server, ap, pc, laptop }
}

const router = (n: ReturnType<typeof network>, id: string) => n.project.devices[id] as IosDevice
const host = (n: ReturnType<typeof network>, id: string) => n.project.devices[id] as HostDevice
const settingsOf = (n: ReturnType<typeof network>, id: string): HomeRouterSettings => structuredClone(router(n, id).home!)

describe('home Wi-Fi router', () => {
  it('ships with a LAN, a DHCP server and NAT to the Internet port', () => {
    const { n, ap } = home()
    const cfg = router(n, ap).running
    expect(cfg.interfaces['Vlan1']).toMatchObject({ ip: { address: '192.168.0.1', mask: '255.255.255.0' }, nat: 'inside' })
    expect(cfg.interfaces['Ethernet1']!.switchport?.mode).toBe('access')
    expect(cfg.interfaces['Wireless0']!.switchport?.mode).toBe('access')
    expect(cfg.interfaces['Internet']!.nat).toBe('outside')
    expect(cfg.nat.dynamic).toEqual([{ acl: '1', iface: 'Internet', overload: true }])
    expect(router(n, ap).home).toEqual(DEFAULT_HOME)
  })

  it('gets its Internet address from the provider by DHCP', () => {
    const { n, ap } = home()
    expect(router(n, ap).runtime.wanLease).toMatchObject({ ip: '203.0.113.2', gateway: '203.0.113.1', dns: '8.8.8.8' })
    expect(router(n, ap).running.interfaces['Internet']!.ip?.address).toBe('203.0.113.2')
    expect(router(n, ap).running.staticRoutes).toEqual([{ network: '0.0.0.0', mask: '0.0.0.0', nextHop: '203.0.113.1', distance: 1 }])
  })

  it('gives LAN addresses from its DHCP range, with itself as gateway and the provider DNS', () => {
    const { n, pc } = home()
    expect(host(n, pc).runtime.lease).toMatchObject({ ip: '192.168.0.100', gateway: '192.168.0.1', dns: '8.8.8.8' })
  })

  it('lets the LAN reach the Internet through NAT', () => {
    const { n, pc } = home()
    n.pc(pc, 'ping 8.8.8.8')
    expect(replies(n.pc(pc, 'ping 8.8.8.8'))).toEqual(Array(4).fill('Reply from 8.8.8.8: bytes=32 time<1ms TTL=126'))
  })

  it('accepts a static Internet address', () => {
    const { n, ap, pc } = home()
    const settings = settingsOf(n, ap)
    settings.wan = { mode: 'static', ip: '203.0.113.50', mask: '255.255.255.0', gateway: '203.0.113.1', dns: '1.1.1.1' }
    n.home(ap, settings)
    expect(router(n, ap).runtime.wanLease).toBeUndefined()
    expect(router(n, ap).running.interfaces['Internet']!.ip?.address).toBe('203.0.113.50')
    n.pc(pc, 'ping 8.8.8.8')
    expect(replies(n.pc(pc, 'ping 8.8.8.8'))).toHaveLength(4)
  })

  it('validates its settings', () => {
    const base = structuredClone(DEFAULT_HOME)
    expect(validateHomeRouter(base)).toEqual({})
    expect(validateHomeRouter({ ...base, lan: { ip: '192.168.0.0', mask: '255.255.255.0' } }).lan).toBeDefined()
    expect(validateHomeRouter({ ...base, dhcp: { enabled: true, start: 250, max: 50 } }).dhcp).toBe(
      'The DHCP range must stay within the LAN (offsets 1 to 254)',
    )
    expect(validateHomeRouter({ ...base, wan: { mode: 'static', ip: 'x', mask: '255.255.255.0' } }).wan).toBeDefined()
    expect(validateHomeRouter({ ...base, wifi: { ssid: '', security: 'open' } }).ssid).toBeDefined()
    expect(validateHomeRouter({ ...base, wifi: { ssid: 'Home', security: 'wpa2', passphrase: 'short' } }).passphrase).toBe(
      'Passphrase must be 8 to 63 characters',
    )
  })

  it('cannot be cabled on its radio slots', () => {
    const { n, ap, laptop } = home()
    expect(canConnect(n.project, { deviceId: laptop, port: 'Wireless0' }, { deviceId: ap, port: 'Wireless3' })).toMatch(/automatically/)
  })
})

describe('laptops over Wi-Fi', () => {
  it('join an open network with the same SSID and get an address', () => {
    const { n, ap, laptop } = home()
    n.dhcp(laptop)
    n.wifi(laptop, { ssid: 'Default', security: 'open' })
    const link = linkAt(n.project, { deviceId: laptop, port: 'Wireless0' })!
    expect(link.b).toEqual({ deviceId: ap, port: 'Wireless0' })
    expect(hostNic(n.project, host(n, laptop)).name).toBe('Wireless0')
    expect(host(n, laptop).runtime.lease?.ip).toBe('192.168.0.101')
    expect(n.pc(laptop, 'ipconfig')).toContain('Wireless0 Connection:(default port)')
  })

  it('reach the wired PC, the Internet, and each other', () => {
    const { n, laptop, pc } = home()
    const laptop2 = n.add('laptop')
    for (const l of [laptop, laptop2]) {
      n.dhcp(l)
      n.wifi(l, { ssid: 'Default', security: 'open' })
    }
    const pcIp = host(n, pc).runtime.lease!.ip
    const otherIp = host(n, laptop2).runtime.lease!.ip
    expect(replies(n.pc(laptop, `ping ${pcIp}`))).toHaveLength(4)
    expect(replies(n.pc(laptop, `ping ${otherIp}`))).toHaveLength(4)
    n.pc(laptop, 'ping 8.8.8.8')
    expect(replies(n.pc(laptop, 'ping 8.8.8.8'))).toHaveLength(4)
  })

  it('do not join another SSID', () => {
    const { n, laptop } = home()
    n.dhcp(laptop)
    n.wifi(laptop, { ssid: 'Neighbor', security: 'open' })
    expect(linkAt(n.project, { deviceId: laptop, port: 'Wireless0' })).toBeUndefined()
    expect(host(n, laptop).runtime.lease).toBeUndefined()
  })

  it('need the right WPA2 key', () => {
    const { n, ap, laptop } = home()
    const settings = settingsOf(n, ap)
    settings.wifi = { ssid: 'Home', security: 'wpa2', passphrase: 'correct horse' }
    n.home(ap, settings)
    n.dhcp(laptop)
    n.wifi(laptop, { ssid: 'Home', security: 'wpa2', passphrase: 'wrong key!' })
    expect(linkAt(n.project, { deviceId: laptop, port: 'Wireless0' })).toBeUndefined()
    n.wifi(laptop, { ssid: 'Home', security: 'open' })
    expect(linkAt(n.project, { deviceId: laptop, port: 'Wireless0' })).toBeUndefined()
    n.wifi(laptop, { ssid: 'Home', security: 'wpa2', passphrase: 'correct horse' })
    expect(linkAt(n.project, { deviceId: laptop, port: 'Wireless0' })).toBeDefined()
    expect(host(n, laptop).runtime.lease).toBeDefined()
  })

  it('are disconnected when the access point changes its SSID, and lose their lease', () => {
    const { n, ap, laptop } = home()
    n.dhcp(laptop)
    n.wifi(laptop, { ssid: 'Default', security: 'open' })
    const settings = settingsOf(n, ap)
    settings.wifi.ssid = 'Renamed'
    n.home(ap, settings)
    expect(linkAt(n.project, { deviceId: laptop, port: 'Wireless0' })).toBeUndefined()
    expect(host(n, laptop).runtime.lease).toBeUndefined()
    expect(router(n, ap).runtime.dhcpBindings.map((b) => b.ip)).not.toContain('192.168.0.101')
  })

  it('fall back to the Ethernet port without Wi-Fi', () => {
    const { n, ap, laptop } = home()
    n.link(laptop, 'FastEthernet0', ap, 'Ethernet2')
    n.dhcp(laptop)
    expect(hostNic(n.project, host(n, laptop)).name).toBe('FastEthernet0')
    expect(host(n, laptop).runtime.lease?.ip).toBe('192.168.0.101')
  })

  it('an access point accepts 16 clients', () => {
    const { n } = home()
    const laptops = Array.from({ length: 17 }, () => n.add('laptop'))
    for (const l of laptops) n.wifi(l, { ssid: 'Default', security: 'open' })
    const joined = laptops.filter((l) => linkAt(n.project, { deviceId: l, port: 'Wireless0' }))
    expect(joined).toHaveLength(16)
  })

  it('refuse Wi-Fi settings on a PC and a short WPA2 key', () => {
    const { n, pc, laptop } = home()
    expect(() => n.wifi(pc, { ssid: 'Default', security: 'open' })).toThrow('no wireless card')
    expect(() => n.wifi(laptop, { ssid: 'Home', security: 'wpa2', passphrase: 'short' })).toThrow('8 to 63')
  })
})
