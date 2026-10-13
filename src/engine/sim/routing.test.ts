import { describe, expect, it } from 'vitest'
import { TestConsole } from '../cli/testing'
import { getRoute } from '../query'
import { network } from './testNetwork'

const replies = (out: string) => out.split('\n').filter((l) => l.startsWith('Reply from') && !l.includes('unreachable'))
const timeouts = (out: string) => out.split('\n').filter((l) => l === 'Request timed out.')
const routeLines = (out: string) => out.split('\n').slice(out.split('\n').findIndex((l) => l.startsWith('Gateway')))

/**
 * PC0 (192.168.1.10) — R1 g0/0 .1 | R1 s0/0/0 10.0.12.1/30 — 10.0.12.2/30 s0/0/0 R2 | R2 g0/1 .1 — PC1 (192.168.2.10)
 */
function pair() {
  const n = network()
  const r1 = n.add('router')
  const r2 = n.add('router')
  const pc0 = n.add('pc')
  const pc1 = n.add('pc')
  n.link(pc0, 'FastEthernet0', r1, 'GigabitEthernet0/0')
  n.link(r1, 'Serial0/0/0', r2, 'Serial0/0/0')
  n.link(r2, 'GigabitEthernet0/1', pc1, 'FastEthernet0')
  n.config(
    r1,
    'int g0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shut',
    'int s0/0/0', 'ip address 10.0.12.1 255.255.255.252', 'no shut',
  )
  n.config(
    r2,
    'int g0/1', 'ip address 192.168.2.1 255.255.255.0', 'no shut',
    'int s0/0/0', 'ip address 10.0.12.2 255.255.255.252', 'no shut',
  )
  n.host(pc0, '192.168.1.10', '255.255.255.0', '192.168.1.1')
  n.host(pc1, '192.168.2.10', '255.255.255.0', '192.168.2.1')
  return { n, r1, r2, pc0, pc1 }
}

/** `pair()` extended with R3 behind R2: R2 g0/0 10.0.23.1/30 — 10.0.23.2/30 g0/0 R3 | R3 g0/1 192.168.3.1 — PC3. */
function chain() {
  const p = pair()
  const { n, r2 } = p
  const r3 = n.add('router')
  const pc3 = n.add('pc')
  n.link(r2, 'GigabitEthernet0/0', r3, 'GigabitEthernet0/0')
  n.link(r3, 'GigabitEthernet0/1', pc3, 'FastEthernet0')
  n.config(r2, 'int g0/0', 'ip address 10.0.23.1 255.255.255.252', 'no shut')
  n.config(
    r3,
    'int g0/0', 'ip address 10.0.23.2 255.255.255.252', 'no shut',
    'int g0/1', 'ip address 192.168.3.1 255.255.255.0', 'no shut',
  )
  n.host(pc3, '192.168.3.10', '255.255.255.0', '192.168.3.1')
  return { ...p, r3, pc3 }
}

/** `chain()` with OSPF area 0 on every network of the three routers. */
function ospfChain() {
  const c = chain()
  const { n, r1, r2, r3 } = c
  n.config(r1, 'router ospf 1', 'network 192.168.1.0 0.0.0.255 area 0', 'network 10.0.12.0 0.0.0.3 area 0')
  n.config(r2, 'router ospf 1', 'network 192.168.2.0 0.0.0.255 area 0', 'network 10.0.0.0 0.255.255.255 area 0')
  n.config(r3, 'router ospf 1', 'network 0.0.0.0 255.255.255.255 area 0')
  return c
}

describe('static routes', () => {
  it('without a route the first router answers unreachable', () => {
    const { n, pc0 } = pair()
    expect(n.pc(pc0, 'ping 192.168.2.10')).toContain('Reply from 192.168.1.1: Destination host unreachable.')
  })

  it('a route in one direction only is not enough', () => {
    const { n, r1, pc0 } = pair()
    n.config(r1, 'ip route 192.168.2.0 255.255.255.0 10.0.12.2')
    expect(timeouts(n.pc(pc0, 'ping 192.168.2.10'))).toHaveLength(4)
  })

  it('routes in both directions give end-to-end connectivity', () => {
    const { n, r1, r2, pc0 } = pair()
    n.config(r1, 'ip route 192.168.2.0 255.255.255.0 10.0.12.2')
    n.config(r2, 'ip route 192.168.1.0 255.255.255.0 10.0.12.1')
    n.pc(pc0, 'ping 192.168.2.10')
    expect(replies(n.pc(pc0, 'ping 192.168.2.10'))).toEqual(
      Array(4).fill('Reply from 192.168.2.10: bytes=32 time<1ms TTL=126'),
    )
    const trace = n.pc(pc0, 'tracert 192.168.2.10')
    expect(trace).toContain('  1   0 ms      0 ms      0 ms      192.168.1.1')
    expect(trace).toContain('  2   0 ms      0 ms      0 ms      10.0.12.2')
    expect(trace).toContain('  3   0 ms      0 ms      0 ms      192.168.2.10')
  })

  it('show ip route prints the IOS table', () => {
    const { n, r1 } = pair()
    n.config(r1, 'ip route 192.168.2.0 255.255.255.0 10.0.12.2')
    const out = n.exec(r1, 'show ip route')
    expect(out.split('\n')[0]).toBe('Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP')
    expect(routeLines(out)).toEqual([
      'Gateway of last resort is not set',
      '',
      '     10.0.0.0/8 is variably subnetted, 2 subnets, 2 masks',
      'C       10.0.12.0/30 is directly connected, Serial0/0/0',
      'L       10.0.12.1/32 is directly connected, Serial0/0/0',
      '     192.168.1.0/24 is variably subnetted, 2 subnets, 2 masks',
      'C       192.168.1.0/24 is directly connected, GigabitEthernet0/0',
      'L       192.168.1.1/32 is directly connected, GigabitEthernet0/0',
      'S    192.168.2.0/24 [1/0] via 10.0.12.2',
      '',
    ])
  })

  it('a default route is shown as S* with the gateway of last resort', () => {
    const { n, r1, r2, pc0 } = pair()
    n.config(r1, 'ip route 0.0.0.0 0.0.0.0 10.0.12.2')
    n.config(r2, 'ip route 0.0.0.0 0.0.0.0 10.0.12.1')
    const out = n.exec(r1, 'show ip route')
    expect(out).toContain('Gateway of last resort is 10.0.12.2 to network 0.0.0.0')
    expect(out.trimEnd().split('\n').at(-1)).toBe('S*   0.0.0.0/0 [1/0] via 10.0.12.2')
    n.pc(pc0, 'ping 192.168.2.10')
    expect(replies(n.pc(pc0, 'ping 192.168.2.10'))).toHaveLength(4)
  })

  it('accepts an exit interface, with or without a next hop', () => {
    const { n, r1, r2, pc0 } = pair()
    n.config(r1, 'ip route 192.168.2.0 255.255.255.0 s0/0/0')
    n.config(r2, 'ip route 192.168.1.0 255.255.255.0 Serial0/0/0 10.0.12.1')
    expect(n.exec(r1, 'show ip route')).toContain('S    192.168.2.0/24 is directly connected, Serial0/0/0')
    expect(n.exec(r2, 'show ip route')).toContain('S    192.168.1.0/24 [1/0] via 10.0.12.1, Serial0/0/0')
    n.pc(pc0, 'ping 192.168.2.10')
    expect(replies(n.pc(pc0, 'ping 192.168.2.10'))).toHaveLength(4)
  })

  it('is not installed while its next hop is unreachable', () => {
    const { n, r1 } = pair()
    n.config(r1, 'ip route 192.168.2.0 255.255.255.0 10.0.12.2', 'int s0/0/0', 'shutdown')
    expect(n.exec(r1, 'show ip route')).not.toContain('192.168.2.0')
    expect(n.exec(r1, 'show running-config')).toContain('ip route 192.168.2.0 255.255.255.0 10.0.12.2')
    n.config(r1, 'int s0/0/0', 'no shutdown')
    expect(n.exec(r1, 'show ip route')).toContain('S    192.168.2.0/24 [1/0] via 10.0.12.2')
  })

  it('shows a custom administrative distance', () => {
    const { n, r1 } = pair()
    n.config(r1, 'ip route 192.168.2.0 255.255.255.0 10.0.12.2 200')
    expect(n.exec(r1, 'show ip route')).toContain('S    192.168.2.0/24 [200/0] via 10.0.12.2')
    expect(n.exec(r1, 'show running-config')).toContain('ip route 192.168.2.0 255.255.255.0 10.0.12.2 200')
  })

  it('validates the route', () => {
    const { n, r1 } = pair()
    const t = new TestConsole(n.project, r1)
    t.runAll('en', 'conf t')
    expect(t.run('ip route 192.168.2.1 255.255.255.0 10.0.12.2')).toBe('%Inconsistent address and mask')
    expect(t.run('ip route 192.168.2.0 255.0.255.0 10.0.12.2')).toBe('%Inconsistent address and mask')
    expect(t.run('ip route 192.168.2.0 255.255.255.0 10.0.12.1')).toBe("%Invalid next hop address (it's this router)")
    expect(t.run('ip route 192.168.2.0 255.255.255.0')).toBe('% Incomplete command.\n')
    expect(t.device.running.staticRoutes).toEqual([])
  })

  it('no ip route removes one target or the whole prefix', () => {
    const { n, r1 } = pair()
    const t = new TestConsole(n.project, r1)
    t.runAll('en', 'conf t', 'ip route 172.16.0.0 255.255.0.0 10.0.12.2', 'ip route 172.16.0.0 255.255.0.0 s0/0/0')
    expect(t.device.running.staticRoutes).toHaveLength(2)
    t.run('no ip route 172.16.0.0 255.255.0.0 10.0.12.2')
    expect(t.device.running.staticRoutes).toEqual([
      { network: '172.16.0.0', mask: '255.255.0.0', iface: 'Serial0/0/0', distance: 1 },
    ])
    t.run('no ip route 172.16.0.0 255.255.0.0')
    expect(t.device.running.staticRoutes).toEqual([])
    expect(t.run('no ip route 172.16.0.0 255.255.0.0')).toBe('%No matching route to delete')
  })

  it('IOS ping shows U.U.U when a router on the path has no route', () => {
    const { n, r1 } = pair()
    n.config(r1, 'ip route 0.0.0.0 0.0.0.0 10.0.12.2')
    const out = n.exec(r1, 'ping 172.16.0.1')
    expect(out).toContain('\nU.U.U\nSuccess rate is 0 percent (0/5)')
  })

  it('a layer 2 switch has no routing table', () => {
    const n = network()
    const sw = n.add('switch-l2')
    expect(n.exec(sw, 'show ip route').split('\n')[0]).toBe('Default gateway is not set')
    const t = new TestConsole(n.project, sw)
    t.runAll('en', 'conf t')
    expect(t.run('ip route 0.0.0.0 0.0.0.0 10.0.0.1')).toContain("% Invalid input detected at '^' marker.")
  })
})

describe('OSPF', () => {
  it('forms adjacencies and reports them', () => {
    const { n, r1, r2 } = chain()
    n.config(r1, 'router ospf 1', 'network 10.0.12.0 0.0.0.3 area 0')
    const t = new TestConsole(n.project, r2)
    t.runAll('en', 'conf t', 'router ospf 1')
    expect(t.prompt).toBe('Router(config-router)#')
    expect(t.run('network 10.0.12.0 0.0.0.3 area 0')).toBe(
      '%OSPF-5-ADJCHG: Process 1, Nbr 192.168.1.1 on Serial0/0/0 from LOADING to FULL, Loading Done\n',
    )
  })

  it('show ip ospf neighbor lists neighbors with DR/BDR roles', () => {
    const { n, r2, r3 } = ospfChain()
    expect(n.exec(r2, 'show ip ospf neighbor').split('\n')).toEqual([
      '',
      'Neighbor ID     Pri   State           Dead Time   Address         Interface',
      '192.168.1.1       0   FULL/  -        00:00:35    10.0.12.1       Serial0/0/0',
      '192.168.3.1       1   FULL/DR         00:00:35    10.0.23.2       GigabitEthernet0/0',
    ])
    // R3 has the highest router ID on the Ethernet segment: it is the DR, R2 the BDR.
    expect(n.exec(r3, 'show ip ospf neighbor')).toContain('192.168.2.1       1   FULL/BDR        00:00:35    10.0.23.1       GigabitEthernet0/0')
  })

  it('installs O routes with cost = 10^8 / bandwidth summed along the path', () => {
    const { n, r1, r3 } = ospfChain()
    const out = n.exec(r1, 'show ip route')
    // Serial = 64, GigabitEthernet = 1.
    expect(out).toContain('O       10.0.23.0/30 [110/65] via 10.0.12.2, 00:00:10, Serial0/0/0')
    expect(out).toContain('O    192.168.2.0/24 [110/65] via 10.0.12.2, 00:00:10, Serial0/0/0')
    expect(out).toContain('O    192.168.3.0/24 [110/66] via 10.0.12.2, 00:00:10, Serial0/0/0')
    expect(n.exec(r3, 'show ip route')).toContain('O    192.168.1.0/24 [110/66] via 10.0.23.1, 00:00:10, GigabitEthernet0/0')
    expect(getRoute(n.project, r1, '192.168.3.77')).toMatchObject({ code: 'O', ad: 110, metric: 66 })
  })

  it('gives end-to-end connectivity across three routers', () => {
    const { n, pc0 } = ospfChain()
    n.pc(pc0, 'ping 192.168.3.10')
    expect(replies(n.pc(pc0, 'ping 192.168.3.10'))).toEqual(
      Array(4).fill('Reply from 192.168.3.10: bytes=32 time<1ms TTL=125'),
    )
  })

  it('a passive interface is still advertised but forms no adjacency', () => {
    const { n, r1, r2, r3 } = ospfChain()
    n.config(r3, 'router ospf 1', 'passive-interface g0/1')
    expect(n.exec(r1, 'show ip route')).toContain('O    192.168.3.0/24 [110/66]')
    n.config(r2, 'router ospf 1', 'passive-interface s0/0/0')
    expect(n.exec(r2, 'show ip ospf neighbor')).not.toContain('Serial0/0/0')
    expect(n.exec(r1, 'show ip route')).not.toMatch(/^O /m)
    expect(n.exec(r1, 'show ip ospf neighbor')).toBe('')
  })

  it('needs matching areas', () => {
    const { n, r1, r2 } = chain()
    n.config(r1, 'router ospf 1', 'network 10.0.12.0 0.0.0.3 area 0')
    n.config(r2, 'router ospf 1', 'network 10.0.12.0 0.0.0.3 area 1')
    expect(n.exec(r1, 'show ip ospf neighbor')).toBe('')
    n.config(r2, 'router ospf 1', 'network 10.0.12.0 0.0.0.3 area 0')
    expect(n.exec(r1, 'show ip ospf neighbor')).toContain('FULL/  -')
  })

  it('loses its routes when the link goes down, and says so', () => {
    const { n, r1, r2, pc0 } = ospfChain()
    const t = new TestConsole(n.project, r2)
    t.runAll('en', 'conf t', 'int s0/0/0')
    expect(t.run('shutdown')).toContain(
      '%OSPF-5-ADJCHG: Process 1, Nbr 192.168.1.1 on Serial0/0/0 from FULL to DOWN, Neighbor Down: Interface down or detached',
    )
    n.project = t.project
    expect(n.exec(r1, 'show ip route')).not.toMatch(/^O /m)
    expect(replies(n.pc(pc0, 'ping 192.168.3.10'))).toHaveLength(0)
  })

  it('uses the configured router-id', () => {
    const { n, r1, r2 } = ospfChain()
    const t = new TestConsole(n.project, r1)
    t.runAll('en', 'conf t', 'router ospf 1')
    expect(t.run('router-id 1.1.1.1')).toContain('Reload or use "clear ip ospf process" command, for this to take effect')
    n.project = t.project
    expect(n.exec(r2, 'show ip ospf neighbor')).toContain('1.1.1.1           0   FULL/  -')
  })

  it('a static route beats OSPF, a floating static does not', () => {
    const { n, r1 } = ospfChain()
    n.config(r1, 'ip route 192.168.3.0 255.255.255.0 10.0.12.2 200')
    expect(n.exec(r1, 'show ip route')).toContain('O    192.168.3.0/24 [110/66]')
    n.config(r1, 'ip route 192.168.3.0 255.255.255.0 10.0.12.2')
    expect(n.exec(r1, 'show ip route')).toContain('S    192.168.3.0/24 [1/0] via 10.0.12.2')
  })

  it('is written to the running-config and removed by no router ospf', () => {
    const { n, r1 } = ospfChain()
    n.config(r1, 'router ospf 1', 'router-id 1.1.1.1', 'passive-interface g0/0')
    expect(n.exec(r1, 'show running-config')).toContain(
      [
        'router ospf 1',
        ' router-id 1.1.1.1',
        ' log-adjacency-changes',
        ' passive-interface GigabitEthernet0/0',
        ' network 192.168.1.0 0.0.0.255 area 0',
        ' network 10.0.12.0 0.0.0.3 area 0',
        '!',
        'ip classless',
      ].join('\n'),
    )
    n.config(r1, 'no router ospf 1')
    expect(n.exec(r1, 'show running-config')).not.toContain('router ospf')
    expect(n.exec(r1, 'show ip route')).not.toMatch(/^O /m)
  })

  it('normalizes network statements and removes them with no', () => {
    const { n, r1 } = chain()
    const t = new TestConsole(n.project, r1)
    t.runAll('en', 'conf t', 'router ospf 10', 'network 192.168.1.1 0.0.0.255 area 0')
    expect(t.device.running.ospf?.networks).toEqual([{ address: '192.168.1.0', wildcard: '0.0.0.255', area: 0 }])
    t.run('no network 192.168.1.0 0.0.0.255 area 0')
    expect(t.device.running.ospf?.networks).toEqual([])
    expect(t.run('network 192.168.1.0 0.0.0.255')).toBe('% Incomplete command.\n')
  })

  it('keeps a single process', () => {
    const { n, r1 } = chain()
    const t = new TestConsole(n.project, r1)
    t.runAll('en', 'conf t', 'router ospf 1', 'exit')
    expect(t.run('router ospf 2')).toBe('% Only one OSPF process is supported (process 1 is configured)')
    expect(t.prompt).toBe('Router(config)#')
  })

  it('runs on a 3560 only once ip routing is enabled', () => {
    const n = network()
    const ml = n.add('switch-l3')
    const r = n.add('router')
    n.link(ml, 'GigabitEthernet0/1', r, 'GigabitEthernet0/0')
    n.config(
      r,
      'int g0/0', 'ip address 10.0.0.2 255.255.255.252', 'no shut',
      'int g0/1', 'ip address 192.168.9.1 255.255.255.0', 'no shut',
      'router ospf 1', 'network 0.0.0.0 255.255.255.255 area 0',
    )
    n.config(
      ml,
      'int g0/1', 'no switchport', 'ip address 10.0.0.1 255.255.255.252',
      'router ospf 1', 'network 10.0.0.0 0.0.0.3 area 0',
    )
    expect(n.exec(ml, 'show ip ospf neighbor')).toBe('')
    n.config(ml, 'ip routing')
    expect(n.exec(ml, 'show ip ospf neighbor')).toContain('FULL/')
    // Router g0/1 has no cable, so only its transit network is up: nothing new to learn yet.
    const pc = n.add('pc')
    n.link(pc, 'FastEthernet0', r, 'GigabitEthernet0/1')
    expect(n.exec(ml, 'show ip route')).toContain('O    192.168.9.0/24 [110/2] via 10.0.0.2, 00:00:10, GigabitEthernet0/1')
  })
})
