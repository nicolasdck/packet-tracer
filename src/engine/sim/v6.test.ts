import { describe, expect, it } from 'vitest'
import { TestConsole } from '../cli/testing'
import type { HostDevice, IosDevice } from '../model/types'
import { canPing } from '../query'
import { network } from './testNetwork'

const MARKER_MSG = "% Invalid input detected at '^' marker."
const replies = (out: string) => out.split('\n').filter((l) => l.startsWith('Reply from') && !l.includes('unreachable'))
const timeouts = (out: string) => out.split('\n').filter((l) => l === 'Request timed out.')

/**
 * PC0 — R1 g0/0 2001:db8:1::1/64 | R1 g0/1 2001:db8:12::1/64 — 2001:db8:12::2/64 g0/0 R2 | R2 g0/1 2001:db8:2::1/64 — PC1
 * Devices are created in this order, so MACs (and EUI-64 addresses) are known:
 * R1 = 00d0.ba00.01xx, R2 = …02xx, PC0 = …0301, PC1 = …0401.
 */
function topology(opts: { routing?: boolean; routes?: boolean; hosts?: 'static' | 'auto' | 'none' } = {}) {
  const { routing = true, routes = true, hosts = 'static' } = opts
  const n = network()
  const r1 = n.add('router')
  const r2 = n.add('router')
  const pc0 = n.add('pc')
  const pc1 = n.add('pc')
  n.link(pc0, 'FastEthernet0', r1, 'GigabitEthernet0/0')
  n.link(r1, 'GigabitEthernet0/1', r2, 'GigabitEthernet0/0')
  n.link(r2, 'GigabitEthernet0/1', pc1, 'FastEthernet0')
  n.config(
    r1,
    ...(routing ? ['ipv6 unicast-routing'] : []),
    'int g0/0', 'ipv6 address 2001:db8:1::1/64', 'no shut',
    'int g0/1', 'ipv6 address 2001:db8:12::1/64', 'no shut',
    ...(routes ? ['ipv6 route 2001:db8:2::/64 2001:db8:12::2'] : []),
  )
  n.config(
    r2,
    ...(routing ? ['ipv6 unicast-routing'] : []),
    'int g0/0', 'ipv6 address 2001:db8:12::2/64', 'no shut',
    'int g0/1', 'ipv6 address 2001:db8:2::1/64', 'no shut',
    ...(routes ? ['ipv6 route 2001:db8:1::/64 2001:db8:12::1'] : []),
  )
  if (hosts === 'static') {
    n.host6(pc0, 'static', '2001:db8:1::10/64', '2001:db8:1::1')
    n.host6(pc1, 'static', '2001:db8:2::10/64', '2001:db8:2::1')
  } else if (hosts === 'auto') {
    n.host6(pc0, 'auto')
    n.host6(pc1, 'auto')
  }
  return { n, r1, r2, pc0, pc1 }
}

/** Runs a ping a few times so every neighbor on the path is resolved. */
function warm(n: ReturnType<typeof network>, pc: string, target: string) {
  for (let i = 0; i < 3; i++) n.pc(pc, `ping ${target}`)
}

describe('IPv6 interfaces', () => {
  it('get an automatic EUI-64 link-local address', () => {
    const { n, r1 } = topology()
    expect(n.exec(r1, 'show ipv6 interface brief').split('\n')).toEqual([
      'GigabitEthernet0/0         [up/up]',
      '    FE80::2D0:BAFF:FE00:101',
      '    2001:DB8:1::1',
      'GigabitEthernet0/1         [up/up]',
      '    FE80::2D0:BAFF:FE00:102',
      '    2001:DB8:12::1',
      'Serial0/0/0                [administratively down/down]',
      '    unassigned',
      'Serial0/0/1                [administratively down/down]',
      '    unassigned',
    ])
  })

  it('ipv6 enable gives a link-local address only', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'conf t', 'int g0/0', 'ipv6 enable', 'end')
    expect(t.run('show ipv6 interface brief')).toContain('GigabitEthernet0/0         [administratively down/down]\n    FE80::2D0:BAFF:FE00:101\nGigabitEthernet0/1')
    t.runAll('conf t', 'int g0/0', 'no ipv6 enable')
    expect(t.device.running.interfaces['GigabitEthernet0/0']!.ipv6).toBeUndefined()
  })

  it('accept a manual link-local address and an EUI-64 global address', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'conf t', 'int g0/0')
    expect(t.run('ipv6 address 2001:db8::1 link-local')).toBe('% Invalid link-local address')
    t.runAll('ipv6 address fe80::1 link-local', 'ipv6 address 2001:db8:a::/64 eui-64')
    const brief = t.run('do show ipv6 interface brief')
    expect(brief).toContain('    FE80::1\n    2001:DB8:A:0:2D0:BAFF:FE00:101')
    expect(t.run('do show running-config')).toContain(
      'interface GigabitEthernet0/0\n no ip address\n ipv6 address FE80::1 link-local\n ipv6 address 2001:DB8:A::/64 eui-64\n duplex auto',
    )
  })

  it('refuse the same prefix on two interfaces', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'conf t', 'int g0/0', 'ipv6 address 2001:db8:1::1/64', 'int g0/1')
    expect(t.run('ipv6 address 2001:db8:1::2/64')).toBe(
      '%GigabitEthernet0/1: Error: 2001:DB8:1::/64 is overlapping with 2001:DB8:1::/64 on GigabitEthernet0/0',
    )
  })

  it('remove addresses with no', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'conf t', 'int g0/0', 'ipv6 address 2001:db8:1::1/64', 'ipv6 address 2001:db8:2::1/64')
    t.run('no ipv6 address 2001:db8:1::1/64')
    expect(t.device.running.interfaces['GigabitEthernet0/0']!.ipv6?.addresses).toEqual([{ address: '2001:DB8:2::1', prefix: 64 }])
    t.run('no ipv6 address')
    expect(t.device.running.interfaces['GigabitEthernet0/0']!.ipv6).toBeUndefined()
  })

  it('rejects malformed addresses and is not offered on switch ports', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'conf t', 'int g0/0')
    expect(t.run('ipv6 address 2001:db8::1')).toBe('% Incomplete command.\n')
    expect(t.run('ipv6 address 2001:zz8::1/64')).toContain(MARKER_MSG)
    const s = TestConsole.of('switch-l2')
    s.runAll('en', 'conf t', 'int fa0/1')
    expect(s.run('ipv6 address 2001:db8::1/64')).toContain(MARKER_MSG)
    s.run('interface vlan 1')
    expect(s.run('ipv6 address 2001:db8::1/64')).toBe('')
  })
})

describe('IPv6 on hosts', () => {
  it('always have a link-local address, shown by ipconfig', () => {
    const { n, pc0 } = topology({ hosts: 'none' })
    const out = n.pc(pc0, 'ipconfig')
    expect(out).toContain('   Link-local IPv6 Address.........: FE80::2D0:BAFF:FE00:301')
    expect(out).toContain('   IPv6 Address....................: ::')
    expect(out).toContain('   Default Gateway.................: 0.0.0.0')
  })

  it('static address and gateway', () => {
    const { n, pc0 } = topology()
    n.host(pc0, '192.168.1.10', '255.255.255.0', '192.168.1.1')
    const out = n.pc(pc0, 'ipconfig')
    expect(out).toContain('   IPv6 Address....................: 2001:DB8:1::10')
    // IPv6 gateway first, IPv4 gateway on the next line, like Windows.
    expect(out).toContain(`   Default Gateway.................: 2001:DB8:1::1\n${' '.repeat(37)}192.168.1.1`)
    // Changing the IPv4 settings keeps the IPv6 ones.
    expect((n.project.devices[pc0] as HostDevice).net.ipv6).toEqual({
      mode: 'static',
      address: '2001:DB8:1::10',
      prefix: 64,
      gateway: '2001:DB8:1::1',
    })
  })

  it('SLAAC builds the address from the router prefix once it routes IPv6', () => {
    const { n, r1, pc0 } = topology({ routing: false, hosts: 'auto' })
    expect(n.pc(pc0, 'ipconfig')).toContain('   IPv6 Address....................: ::')
    n.config(r1, 'ipv6 unicast-routing')
    const out = n.pc(pc0, 'ipconfig')
    expect(out).toContain('   IPv6 Address....................: 2001:DB8:1:0:2D0:BAFF:FE00:301')
    expect(out).toContain('   Default Gateway.................: FE80::2D0:BAFF:FE00:101')
  })

  it('validates static settings', () => {
    const { n, pc0 } = topology({ hosts: 'none' })
    expect(() => n.host6(pc0, 'static', 'nonsense', '')).toThrow('Invalid IPv6 address')
    expect(() => n.host6(pc0, 'static', '2001:db8:1::10/64', 'x')).toThrow('Invalid IPv6 address')
    n.host6(pc0, 'static', '2001:db8:1::10', '')
    expect((n.project.devices[pc0] as HostDevice).net.ipv6).toEqual({ mode: 'static', address: '2001:DB8:1::10', prefix: 64 })
  })
})

describe('IPv6 ping', () => {
  it('PC reaches its gateway, by global and link-local address', () => {
    const { n, pc0 } = topology()
    expect(replies(n.pc(pc0, 'ping 2001:db8:1::1'))).toEqual(
      Array(4).fill('Reply from 2001:DB8:1::1: bytes=32 time<1ms TTL=255'),
    )
    expect(replies(n.pc(pc0, 'ping fe80::2d0:baff:fe00:101'))).toHaveLength(4)
  })

  it('crosses two routers with static routes', () => {
    const { n, pc0 } = topology()
    warm(n, pc0, '2001:db8:2::10')
    expect(replies(n.pc(pc0, 'ping 2001:db8:2::10'))).toEqual(
      Array(4).fill('Reply from 2001:DB8:2::10: bytes=32 time<1ms TTL=126'),
    )
    expect(canPing(n.project, pc0, '2001:db8:2::10')).toBe(true)
  })

  it('works end to end with SLAAC hosts', () => {
    const { n, pc0 } = topology({ hosts: 'auto' })
    warm(n, pc0, '2001:db8:2:0:2d0:baff:fe00:401')
    expect(replies(n.pc(pc0, 'ping 2001:db8:2:0:2d0:baff:fe00:401'))).toHaveLength(4)
  })

  it('routers do not forward without ipv6 unicast-routing', () => {
    const { n, pc0 } = topology({ routing: false })
    warm(n, pc0, '2001:db8:2::10')
    expect(replies(n.pc(pc0, 'ping 2001:db8:2::10'))).toHaveLength(0)
    // The router still answers for its own addresses.
    expect(replies(n.pc(pc0, 'ping 2001:db8:1::1'))).toHaveLength(4)
  })

  it('a router without route answers unreachable', () => {
    const { n, pc0 } = topology({ routes: false })
    expect(n.pc(pc0, 'ping 2001:db8:2::10')).toContain('Reply from 2001:DB8:1::1: Destination host unreachable.')
    expect(canPing(n.project, pc0, '2001:db8:2::10')).toBe(false)
  })

  it('times out without a gateway', () => {
    const { n, pc0 } = topology()
    n.host6(pc0, 'static', '2001:db8:1::10/64', '')
    expect(timeouts(n.pc(pc0, 'ping 2001:db8:2::10'))).toHaveLength(4)
  })

  it('IOS loses the first echo to neighbor discovery, then none', () => {
    const { n, r1 } = topology()
    expect(n.exec(r1, 'ping 2001:db8:1::10')).toBe(
      [
        'Type escape sequence to abort.',
        'Sending 5, 100-byte ICMP Echos to 2001:DB8:1::10, timeout is 2 seconds:',
        '.!!!!',
        'Success rate is 80 percent (4/5), round-trip min/avg/max = 0/0/0 ms',
        '',
      ].join('\n'),
    )
    expect(n.exec(r1, 'ping ipv6 2001:db8:1::10')).toContain('!!!!!')
  })

  it('IOS asks for the output interface of a link-local target', () => {
    const { n, r1 } = topology()
    const t = new TestConsole(n.project, r1)
    t.run('enable')
    expect(t.run('ping fe80::2d0:baff:fe00:201')).toBe('')
    expect(t.prompt).toBe('Output Interface: ')
    expect(t.run('g0/1')).toContain('Sending 5, 100-byte ICMP Echos to FE80::2D0:BAFF:FE00:201')
    expect(t.prompt).toBe('Router#')
    expect(t.run('ping fe80::2d0:baff:fe00:201')).toBe('')
    expect(t.run('GigabitEthernet0/1')).toContain('!!!!!')
    t.run('ping fe80::2d0:baff:fe00:201')
    expect(t.run('nope')).toBe('% Invalid interface\n')
    // Wrong link: the neighbor is not there.
    t.run('ping fe80::2d0:baff:fe00:201')
    expect(t.run('g0/0')).toContain('Success rate is 0 percent')
  })

  it('needs no neighbor discovery on a serial link', () => {
    const n = network()
    const a = n.add('router')
    const b = n.add('router')
    n.link(a, 'Serial0/0/0', b, 'Serial0/0/0')
    n.config(a, 'int s0/0/0', 'ipv6 address 2001:db8:ab::1/64', 'no shut')
    n.config(b, 'int s0/0/0', 'ipv6 address 2001:db8:ab::2/64', 'no shut')
    expect(n.exec(a, 'ping 2001:db8:ab::2')).toContain('!!!!!')
  })

  it('runs alongside IPv4 (dual stack)', () => {
    const { n, r1, pc0 } = topology()
    n.config(r1, 'int g0/0', 'ip address 192.168.1.1 255.255.255.0')
    n.host(pc0, '192.168.1.10', '255.255.255.0', '192.168.1.1')
    expect(replies(n.pc(pc0, 'ping 192.168.1.1'))).toHaveLength(4)
    expect(replies(n.pc(pc0, 'ping 2001:db8:1::1'))).toHaveLength(4)
  })
})

describe('IPv6 routing table and neighbors', () => {
  it('show ipv6 route prints connected, local and static routes', () => {
    const { n, r1 } = topology()
    const lines = n.exec(r1, 'show ipv6 route').split('\n')
    expect(lines[0]).toBe('IPv6 Routing Table - default - 6 entries')
    expect(lines[1]).toBe('Codes: C - Connected, L - Local, S - Static, U - Per-user Static route')
    expect(lines.slice(7)).toEqual([
      'C   2001:DB8:1::/64 [0/0]',
      '     via GigabitEthernet0/0, directly connected',
      'L   2001:DB8:1::1/128 [0/0]',
      '     via GigabitEthernet0/0, receive',
      'S   2001:DB8:2::/64 [1/0]',
      '     via 2001:DB8:12::2',
      'C   2001:DB8:12::/64 [0/0]',
      '     via GigabitEthernet0/1, directly connected',
      'L   2001:DB8:12::1/128 [0/0]',
      '     via GigabitEthernet0/1, receive',
      'L   FF00::/8 [0/0]',
      '     via Null0, receive',
    ])
  })

  it('is empty before IPv6 is configured', () => {
    const t = TestConsole.of('router')
    expect(t.run('show ipv6 route').split('\n')[0]).toBe('IPv6 Routing Table - default - 0 entries')
  })

  it('accepts a default route and a link-local next hop with its interface', () => {
    const { n, r1, pc0 } = topology({ routes: false })
    const t = new TestConsole(n.project, r1)
    t.runAll('en', 'conf t')
    expect(t.run('ipv6 route ::/0 fe80::2d0:baff:fe00:201')).toBe('% Interface has to be specified for a link-local nexthop')
    t.run('ipv6 route ::/0 g0/1 fe80::2d0:baff:fe00:201')
    expect(t.run('do show ipv6 route')).toContain('S   ::/0 [1/0]\n     via FE80::2D0:BAFF:FE00:201, GigabitEthernet0/1')
    expect(t.run('do show running-config')).toContain('ipv6 route ::/0 GigabitEthernet0/1 FE80::2D0:BAFF:FE00:201')
    n.project = t.project
    const r2 = Object.values(n.project.devices).filter((d) => d.kind === 'router')[1]!.id
    n.config(r2, 'ipv6 route ::/0 2001:db8:12::1')
    warm(n, pc0, '2001:db8:2::10')
    expect(replies(n.pc(pc0, 'ping 2001:db8:2::10'))).toHaveLength(4)
  })

  it('a static route is not installed while its next hop is unreachable', () => {
    const { n, r1 } = topology()
    n.config(r1, 'int g0/1', 'shutdown')
    expect(n.exec(r1, 'show ipv6 route')).not.toContain('2001:DB8:2::/64')
    expect(n.exec(r1, 'show running-config')).toContain('ipv6 route 2001:DB8:2::/64 2001:DB8:12::2')
  })

  it('no ipv6 route removes it', () => {
    const { n, r1 } = topology()
    const t = new TestConsole(n.project, r1)
    t.runAll('en', 'conf t', 'no ipv6 route 2001:db8:2::/64')
    expect(t.device.running.ipv6StaticRoutes).toEqual([])
    expect(t.run('no ipv6 route 2001:db8:2::/64')).toBe('%No matching route to delete')
  })

  it('show ipv6 neighbors lists what was learned', () => {
    const { n, r1, pc0 } = topology()
    n.pc(pc0, 'ping 2001:db8:1::1')
    const mac = n.project.devices[pc0]!.ports[0]!.mac
    expect(n.exec(r1, 'show ipv6 neighbors').split('\n')).toEqual([
      'IPv6 Address                              Age Link-layer Addr State Interface',
      `${'2001:DB8:1::10'.padEnd(42)}  0 ${mac}  REACH Gi0/0`,
    ])
    expect((n.project.devices[pc0] as HostDevice).runtime.neighbors.map((e) => e.ip)).toEqual(['2001:DB8:1::1'])
  })

  it('traceroute lists the routers on the way', () => {
    const { n, r1, pc0 } = topology()
    warm(n, pc0, '2001:db8:2::10')
    const out = n.pc(pc0, 'tracert 2001:db8:2::10')
    expect(out).toContain('  1   0 ms      0 ms      0 ms      2001:DB8:1::1')
    expect(out).toContain('  2   0 ms      0 ms      0 ms      2001:DB8:12::2')
    expect(out).toContain('  3   0 ms      0 ms      0 ms      2001:DB8:2::10')
    expect(n.exec(r1, 'traceroute 2001:db8:2::10')).toContain('  1 2001:DB8:12::2 0 msec 0 msec 0 msec')
  })

  it('ipv6 unicast-routing is saved and unavailable on a 2960', () => {
    const { n, r1 } = topology()
    expect(n.exec(r1, 'show running-config')).toMatch(/^ipv6 unicast-routing$/m)
    expect((n.project.devices[r1] as IosDevice).running.ipv6Routing).toBe(true)
    const s = TestConsole.of('switch-l2')
    s.runAll('en', 'conf t')
    expect(s.run('ipv6 unicast-routing')).toContain(MARKER_MSG)
  })

  it('reload clears the neighbor cache', () => {
    const { n, r1, pc0 } = topology()
    n.pc(pc0, 'ping 2001:db8:1::1')
    const t = new TestConsole(n.project, r1)
    t.runAll('en', 'wr', 'reload', '')
    expect((t.project.devices[r1] as IosDevice).runtime.neighbors).toEqual([])
  })
})
