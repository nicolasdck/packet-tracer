import { describe, expect, it } from 'vitest'
import { TestConsole } from '../cli/testing'
import type { IosDevice } from '../model/types'
import { network } from './testNetwork'

const replies = (out: string) => out.split('\n').filter((l) => l.startsWith('Reply from') && !l.includes('unreachable'))
const timeouts = (out: string) => out.split('\n').filter((l) => l === 'Request timed out.')

/**
 * Inside:  PC0 (192.168.1.10), PC2 (192.168.1.20) — Switch — R1 g0/0 192.168.1.1
 * Outside: R1 g0/1 209.165.200.225/29 — 209.165.200.230/29 g0/0 ISP | ISP g0/1 8.8.8.1 — Server (8.8.8.8)
 * R1 has a default route to the ISP; the ISP has no route to the private LAN.
 */
function topology() {
  const n = network()
  const r1 = n.add('router')
  const isp = n.add('router')
  const sw = n.add('switch-l2')
  const pc0 = n.add('pc')
  const pc2 = n.add('pc')
  const server = n.add('server')
  n.link(sw, 'GigabitEthernet0/1', r1, 'GigabitEthernet0/0')
  n.link(pc0, 'FastEthernet0', sw, 'FastEthernet0/1')
  n.link(pc2, 'FastEthernet0', sw, 'FastEthernet0/2')
  n.link(r1, 'GigabitEthernet0/1', isp, 'GigabitEthernet0/0')
  n.link(isp, 'GigabitEthernet0/1', server, 'FastEthernet0')
  n.config(
    r1,
    'int g0/0', 'ip address 192.168.1.1 255.255.255.0', 'ip nat inside', 'no shut',
    'int g0/1', 'ip address 209.165.200.225 255.255.255.248', 'ip nat outside', 'no shut',
    'ip route 0.0.0.0 0.0.0.0 209.165.200.230',
    'access-list 1 permit 192.168.1.0 0.0.0.255',
  )
  n.config(
    isp,
    'int g0/0', 'ip address 209.165.200.230 255.255.255.248', 'no shut',
    'int g0/1', 'ip address 8.8.8.1 255.255.255.0', 'no shut',
  )
  n.host(pc0, '192.168.1.10', '255.255.255.0', '192.168.1.1')
  n.host(pc2, '192.168.1.20', '255.255.255.0', '192.168.1.1')
  n.host(server, '8.8.8.8', '255.255.255.0', '8.8.8.1')
  return { n, r1, isp, pc0, pc2, server }
}

const translations = (n: ReturnType<typeof network>, id: string) => (n.project.devices[id] as IosDevice).runtime.natTranslations

describe('without NAT', () => {
  it('private addresses get no answer from the outside', () => {
    const { n, pc0 } = topology()
    n.pc(pc0, 'ping 8.8.8.8')
    expect(timeouts(n.pc(pc0, 'ping 8.8.8.8'))).toHaveLength(4)
  })
})

describe('PAT (overload)', () => {
  it('lets the LAN out behind the outside interface address', () => {
    const { n, r1, pc0 } = topology()
    n.config(r1, 'ip nat inside source list 1 interface g0/1 overload')
    n.pc(pc0, 'ping 8.8.8.8')
    n.config(r1, 'do clear ip nat translation *')
    expect(replies(n.pc(pc0, 'ping 8.8.8.8'))).toEqual(Array(4).fill('Reply from 8.8.8.8: bytes=32 time<1ms TTL=126'))
    expect(n.exec(r1, 'show ip nat translations').split('\n').slice(0, 3)).toEqual([
      'Pro  Inside global     Inside local       Outside local      Outside global',
      'icmp 209.165.200.225:1 192.168.1.10:1     8.8.8.8:1          8.8.8.8:1',
      'icmp 209.165.200.225:2 192.168.1.10:2     8.8.8.8:2          8.8.8.8:2',
    ])
  })

  it('gives a new id to a second host using the same one', () => {
    const { n, r1, pc0, pc2 } = topology()
    n.config(r1, 'ip nat inside source list 1 interface g0/1 overload')
    n.pc(pc0, 'ping 8.8.8.8')
    expect(replies(n.pc(pc2, 'ping 8.8.8.8'))).toHaveLength(4)
    const second = translations(n, r1).filter((e) => e.insideLocal === '192.168.1.20')
    expect(second.map((e) => [e.localId, e.globalId])).toEqual([
      [1, 1024],
      [2, 1025],
      [3, 1026],
      [4, 1027],
    ])
  })

  it('works with a pool of global addresses', () => {
    const { n, r1, pc0 } = topology()
    n.config(
      r1,
      'ip nat pool PUBLIC 209.165.200.226 209.165.200.227 netmask 255.255.255.248',
      'ip nat inside source list 1 pool PUBLIC overload',
    )
    n.pc(pc0, 'ping 8.8.8.8')
    expect(replies(n.pc(pc0, 'ping 8.8.8.8'))).toHaveLength(4)
    expect(translations(n, r1).every((e) => e.insideGlobal === '209.165.200.226')).toBe(true)
  })

  it('only translates sources permitted by the access list', () => {
    const { n, r1, pc0, pc2 } = topology()
    n.config(r1, 'no access-list 1', 'access-list 1 permit host 192.168.1.10', 'ip nat inside source list 1 interface g0/1 overload')
    n.pc(pc0, 'ping 8.8.8.8')
    expect(replies(n.pc(pc0, 'ping 8.8.8.8'))).toHaveLength(4)
    expect(replies(n.pc(pc2, 'ping 8.8.8.8'))).toHaveLength(0)
  })

  it('needs inside and outside interfaces', () => {
    const { n, r1, pc0 } = topology()
    n.config(r1, 'ip nat inside source list 1 interface g0/1 overload', 'int g0/1', 'no ip nat outside')
    n.pc(pc0, 'ping 8.8.8.8')
    expect(replies(n.pc(pc0, 'ping 8.8.8.8'))).toHaveLength(0)
  })

  it('translates ICMP errors back: traceroute works through PAT', () => {
    const { n, r1, pc0 } = topology()
    n.config(r1, 'ip nat inside source list 1 interface g0/1 overload')
    n.pc(pc0, 'ping 8.8.8.8')
    const out = n.pc(pc0, 'tracert 8.8.8.8')
    expect(out).toContain('  1   0 ms      0 ms      0 ms      192.168.1.1')
    expect(out).toContain('  2   0 ms      0 ms      0 ms      209.165.200.230')
    expect(out).toContain('  3   0 ms      0 ms      0 ms      8.8.8.8')
  })
})

describe('static NAT', () => {
  it('makes an inside host reachable from the outside', () => {
    const { n, r1, pc0, server } = topology()
    n.config(r1, 'ip nat inside source static 192.168.1.10 209.165.200.226')
    n.pc(server, 'ping 209.165.200.226')
    expect(replies(n.pc(server, 'ping 209.165.200.226'))).toEqual(
      Array(4).fill('Reply from 209.165.200.226: bytes=32 time<1ms TTL=126'),
    )
    // And the host goes out with its public address.
    expect(replies(n.pc(pc0, 'ping 8.8.8.8'))).toHaveLength(4)
    expect(n.exec(r1, 'show ip nat translations').split('\n')).toEqual([
      'Pro  Inside global     Inside local       Outside local      Outside global',
      '---  209.165.200.226   192.168.1.10       ---                ---',
      '',
    ])
  })

  it('is removed with no', () => {
    const { n, r1, server } = topology()
    n.config(r1, 'ip nat inside source static 192.168.1.10 209.165.200.226', 'no ip nat inside source static 192.168.1.10 209.165.200.226')
    expect(replies(n.pc(server, 'ping 209.165.200.226'))).toHaveLength(0)
    expect(n.exec(r1, 'show ip nat translations')).toBe('')
  })
})

describe('dynamic NAT (pool without overload)', () => {
  it('gives one global address per host until the pool is empty', () => {
    const { n, r1, pc0, pc2 } = topology()
    n.config(
      r1,
      'ip nat pool ONE 209.165.200.227 209.165.200.227 netmask 255.255.255.248',
      'ip nat inside source list 1 pool ONE',
    )
    n.pc(pc0, 'ping 8.8.8.8')
    expect(replies(n.pc(pc0, 'ping 8.8.8.8'))).toHaveLength(4)
    expect(replies(n.pc(pc2, 'ping 8.8.8.8'))).toHaveLength(0)
    expect(n.exec(r1, 'show ip nat translations')).toContain('---  209.165.200.227   192.168.1.10       ---                ---')
    // Clearing the table frees the address for the other host.
    n.config(r1, 'do clear ip nat translation *')
    expect(replies(n.pc(pc2, 'ping 8.8.8.8'))).toHaveLength(4)
  })
})

describe('NAT configuration', () => {
  it('is written to the running-config', () => {
    const { n, r1 } = topology()
    n.config(
      r1,
      'ip nat pool PUBLIC 209.165.200.226 209.165.200.227 netmask 255.255.255.248',
      'ip nat inside source list 1 pool PUBLIC overload',
      'ip nat inside source static 192.168.1.10 209.165.200.228',
    )
    const run = n.exec(r1, 'show running-config')
    expect(run).toContain(
      [
        'ip nat pool PUBLIC 209.165.200.226 209.165.200.227 netmask 255.255.255.248',
        'ip nat inside source list 1 pool PUBLIC overload',
        'ip nat inside source static 192.168.1.10 209.165.200.228',
      ].join('\n'),
    )
    expect(run).toContain('interface GigabitEthernet0/0\n ip address 192.168.1.1 255.255.255.0\n ip nat inside\n')
    expect(run).toContain(' ip nat outside\n')
  })

  it('checks pools', () => {
    const { n, r1 } = topology()
    const t = new TestConsole(n.project, r1)
    t.runAll('en', 'conf t')
    expect(t.run('ip nat inside source list 1 pool NOPE overload')).toBe('%Pool NOPE not found')
    expect(t.run('ip nat pool P 10.0.0.9 10.0.0.1 netmask 255.255.255.0')).toBe('%End address less than start address')
    t.runAll('ip nat pool P 10.0.0.1 10.0.0.9 netmask 255.255.255.0', 'ip nat inside source list 1 pool P')
    expect(t.run('no ip nat pool P')).toBe('%Pool P in use, cannot destroy')
    t.runAll('no ip nat inside source list 1', 'no ip nat pool P')
    expect(t.device.running.nat).toEqual({ statics: [], pools: [], dynamic: [] })
  })

  it('does not exist on switches', () => {
    const t = TestConsole.of('switch-l3')
    t.runAll('en', 'conf t')
    expect(t.run('ip nat pool P 10.0.0.1 10.0.0.9 netmask 255.255.255.0')).toContain("% Invalid input detected at '^' marker.")
  })

  it('reload clears the translation table', () => {
    const { n, r1, pc0 } = topology()
    n.config(r1, 'ip nat inside source list 1 interface g0/1 overload')
    n.pc(pc0, 'ping 8.8.8.8')
    const t = new TestConsole(n.project, r1)
    t.runAll('en', 'wr', 'reload', '')
    expect((t.project.devices[r1] as IosDevice).runtime.natTranslations).toEqual([])
  })
})
