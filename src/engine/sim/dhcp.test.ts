import { describe, expect, it } from 'vitest'
import type { HostDevice, IosDevice } from '../model/types'
import { network } from './testNetwork'

const replies = (out: string) => out.split('\n').filter((l) => l.startsWith('Reply from') && !l.includes('unreachable'))

/** PC0, PC1 — Switch — Router g0/0 192.168.1.1, DHCP server for the LAN. */
function lan(pool: string[] = ['network 192.168.1.0 255.255.255.0', 'default-router 192.168.1.1', 'dns-server 8.8.8.8']) {
  const n = network()
  const r = n.add('router')
  const sw = n.add('switch-l2')
  const pc0 = n.add('pc')
  const pc1 = n.add('pc')
  n.link(sw, 'GigabitEthernet0/1', r, 'GigabitEthernet0/0')
  n.link(pc0, 'FastEthernet0', sw, 'FastEthernet0/1')
  n.link(pc1, 'FastEthernet0', sw, 'FastEthernet0/2')
  n.config(r, 'int g0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shut')
  if (pool.length) {
    n.config(r, 'ip dhcp excluded-address 192.168.1.1 192.168.1.10', 'ip dhcp pool LAN', ...pool)
  }
  return { n, r, sw, pc0, pc1 }
}

const lease = (n: ReturnType<typeof network>, id: string) => (n.project.devices[id] as HostDevice).runtime.lease

describe('DHCP server', () => {
  it('gives a PC its address, mask, gateway and DNS', () => {
    const { n, r, pc0 } = lan()
    n.dhcp(pc0)
    expect(lease(n, pc0)).toEqual({
      ip: '192.168.1.11',
      mask: '255.255.255.0',
      gateway: '192.168.1.1',
      dns: '8.8.8.8',
      serverId: r,
    })
    const all = n.pc(pc0, 'ipconfig /all')
    expect(all).toContain('   DHCP Enabled....................: Yes')
    expect(all).toContain('   IPv4 Address....................: 192.168.1.11')
    expect(all).toContain('   Default Gateway.................: 192.168.1.1')
    expect(all).toContain('   DNS Servers.....................: 8.8.8.8')
    expect(replies(n.pc(pc0, 'ping 192.168.1.1'))).toHaveLength(4)
  })

  it('skips excluded addresses and gives each client its own', () => {
    const { n, r, pc0, pc1 } = lan()
    n.dhcp(pc0)
    n.dhcp(pc1)
    expect(lease(n, pc0)?.ip).toBe('192.168.1.11')
    expect(lease(n, pc1)?.ip).toBe('192.168.1.12')
    const mac0 = n.project.devices[pc0]!.ports[0]!.mac
    expect(n.exec(r, 'show ip dhcp binding').split('\n')).toEqual([
      'IP address       Client-ID/              Lease expiration        Type',
      '                 Hardware address',
      `192.168.1.11     ${mac0}          --                      Automatic`,
      expect.stringMatching(/^192\.168\.1\.12 /),
    ])
  })

  it('a client without server has no address, then gets one when a pool appears', () => {
    const { n, r, pc0 } = lan([])
    n.dhcp(pc0)
    expect(lease(n, pc0)).toBeUndefined()
    expect(n.pc(pc0, 'ipconfig')).toContain('IPv4 Address....................: 0.0.0.0')
    expect(n.pc(pc0, 'ipconfig /renew')).toBe('DHCP request failed. ')
    n.config(r, 'ip dhcp pool LAN', 'network 192.168.1.0 255.255.255.0')
    n.settle()
    expect(lease(n, pc0)?.ip).toBe('192.168.1.2')
  })

  it('settle does nothing when every client has a lease', () => {
    const { n, pc0 } = lan()
    n.dhcp(pc0)
    const before = n.project
    n.settle()
    expect(n.project).toBe(before)
  })

  it('ipconfig /release and /renew', () => {
    const { n, r, pc0 } = lan()
    n.dhcp(pc0)
    expect(n.pc(pc0, 'ipconfig /release')).toContain('IPv4 Address....................: 0.0.0.0')
    expect((n.project.devices[r] as IosDevice).runtime.dhcpBindings).toEqual([])
    expect(n.pc(pc0, 'ipconfig /renew')).toContain('IPv4 Address....................: 192.168.1.11')
  })

  it('ipconfig /renew is refused on a static host', () => {
    const { n, pc0 } = lan()
    n.host(pc0, '192.168.1.50', '255.255.255.0')
    expect(n.pc(pc0, 'ipconfig /renew')).toBe('Port is not DHCP enabled, static IP address is configured.')
    expect(n.pc(pc0, 'ipconfig /all')).toContain('DHCP Enabled....................: No')
  })

  it('going back to a static address frees the lease', () => {
    const { n, r, pc0 } = lan()
    n.dhcp(pc0)
    n.host(pc0, '192.168.1.50', '255.255.255.0', '192.168.1.1')
    expect(lease(n, pc0)).toBeUndefined()
    expect((n.project.devices[r] as IosDevice).runtime.dhcpBindings).toEqual([])
    expect(n.pc(pc0, 'ipconfig')).toContain('IPv4 Address....................: 192.168.1.50')
  })

  it('stops when the pool is exhausted', () => {
    // /30: .1 is the router, .2 the only address left.
    const { n, r, pc0, pc1 } = lan([])
    n.config(r, 'int g0/0', 'ip address 192.168.1.1 255.255.255.252', 'ip dhcp pool TINY', 'network 192.168.1.0 255.255.255.252')
    n.dhcp(pc0)
    n.dhcp(pc1)
    expect(lease(n, pc0)?.ip).toBe('192.168.1.2')
    expect(lease(n, pc1)).toBeUndefined()
  })

  it('serves each VLAN from the pool of its subinterface', () => {
    const { n, r, sw, pc0, pc1 } = lan([])
    n.config(
      sw,
      'int fa0/1', 'switchport mode access', 'switchport access vlan 10',
      'int fa0/2', 'switchport mode access', 'switchport access vlan 20',
      'int g0/1', 'switchport mode trunk',
    )
    n.config(
      r,
      'int g0/0', 'no ip address',
      'int g0/0.10', 'encapsulation dot1Q 10', 'ip address 192.168.10.1 255.255.255.0',
      'int g0/0.20', 'encapsulation dot1Q 20', 'ip address 192.168.20.1 255.255.255.0',
      'ip dhcp pool V10', 'network 192.168.10.0 255.255.255.0', 'default-router 192.168.10.1',
      'ip dhcp pool V20', 'network 192.168.20.0 255.255.255.0', 'default-router 192.168.20.1',
    )
    n.dhcp(pc0)
    n.dhcp(pc1)
    expect(lease(n, pc0)).toMatchObject({ ip: '192.168.10.2', gateway: '192.168.10.1' })
    expect(lease(n, pc1)).toMatchObject({ ip: '192.168.20.2', gateway: '192.168.20.1' })
    n.pc(pc0, 'ping 192.168.20.2')
    expect(replies(n.pc(pc0, 'ping 192.168.20.2'))).toHaveLength(4)
  })

  it('is written to the running-config', () => {
    const { n, r } = lan()
    expect(n.exec(r, 'show running-config')).toContain(
      [
        'ip dhcp excluded-address 192.168.1.1 192.168.1.10',
        '!',
        'ip dhcp pool LAN',
        ' network 192.168.1.0 255.255.255.0',
        ' default-router 192.168.1.1',
        ' dns-server 8.8.8.8',
        '!',
      ].join('\n'),
    )
  })

  it('removes pools (with their leases) and exclusions', () => {
    const { n, r, pc0 } = lan()
    n.dhcp(pc0)
    n.config(r, 'no ip dhcp excluded-address 192.168.1.1 192.168.1.10', 'no ip dhcp pool LAN')
    const cfg = (n.project.devices[r] as IosDevice).running.dhcp
    expect(cfg).toEqual({ pools: [], excluded: [] })
    expect((n.project.devices[r] as IosDevice).runtime.dhcpBindings).toEqual([])
  })
})

describe('DHCP relay (ip helper-address)', () => {
  /** PC0 — R1 g0/0 192.168.1.1 | R1 s0/0/0 10.0.12.1 — 10.0.12.2 s0/0/0 R2 (DHCP server for 192.168.1.0/24). */
  function relayed(helper = true) {
    const n = network()
    const r1 = n.add('router')
    const r2 = n.add('router')
    const pc0 = n.add('pc')
    n.link(pc0, 'FastEthernet0', r1, 'GigabitEthernet0/0')
    n.link(r1, 'Serial0/0/0', r2, 'Serial0/0/0')
    n.config(
      r1,
      'int g0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shut', ...(helper ? ['ip helper-address 10.0.12.2'] : []),
      'int s0/0/0', 'ip address 10.0.12.1 255.255.255.252', 'no shut',
    )
    n.config(
      r2,
      'int s0/0/0', 'ip address 10.0.12.2 255.255.255.252', 'no shut',
      'ip route 192.168.1.0 255.255.255.0 10.0.12.1',
      'ip dhcp excluded-address 192.168.1.1',
      'ip dhcp pool REMOTE', 'network 192.168.1.0 255.255.255.0', 'default-router 192.168.1.1',
    )
    return { n, r1, r2, pc0 }
  }

  it('relays the request to a server in another network', () => {
    const { n, r1, r2, pc0 } = relayed()
    n.dhcp(pc0)
    expect(lease(n, pc0)).toMatchObject({ ip: '192.168.1.2', gateway: '192.168.1.1', serverId: r2 })
    expect(n.exec(r1, 'show running-config')).toContain(
      'interface GigabitEthernet0/0\n ip address 192.168.1.1 255.255.255.0\n ip helper-address 10.0.12.2\n',
    )
  })

  it('fails without a helper address', () => {
    const { n, pc0 } = relayed(false)
    n.dhcp(pc0)
    expect(lease(n, pc0)).toBeUndefined()
  })

  it('fails when the server cannot route the answer back', () => {
    const { n, r2, pc0 } = relayed()
    n.config(r2, 'no ip route 192.168.1.0 255.255.255.0')
    n.dhcp(pc0)
    expect(lease(n, pc0)).toBeUndefined()
  })
})
