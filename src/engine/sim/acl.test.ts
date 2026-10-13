import { describe, expect, it } from 'vitest'
import { TestConsole } from '../cli/testing'
import type { IosDevice } from '../model/types'
import { network } from './testNetwork'

const MARKER_MSG = "% Invalid input detected at '^' marker."
const replies = (out: string) => out.split('\n').filter((l) => l.startsWith('Reply from') && !l.includes('unreachable'))
const timeouts = (out: string) => out.split('\n').filter((l) => l === 'Request timed out.')
const unreachable = (out: string) => out.split('\n').filter((l) => l.includes('Destination host unreachable'))

/**
 * PC0 (192.168.1.10), PC2 (192.168.1.20) — Switch — R1 g0/0 .1
 * R1 s0/0/0 10.0.12.1/30 — 10.0.12.2/30 s0/0/0 R2 | R2 g0/1 192.168.2.1 — PC1 (192.168.2.10)
 * Static routes both ways, ARP caches warmed up.
 */
function topology() {
  const n = network()
  const r1 = n.add('router')
  const r2 = n.add('router')
  const sw = n.add('switch-l2')
  const pc0 = n.add('pc')
  const pc2 = n.add('pc')
  const pc1 = n.add('pc')
  n.link(sw, 'GigabitEthernet0/1', r1, 'GigabitEthernet0/0')
  n.link(pc0, 'FastEthernet0', sw, 'FastEthernet0/1')
  n.link(pc2, 'FastEthernet0', sw, 'FastEthernet0/2')
  n.link(r1, 'Serial0/0/0', r2, 'Serial0/0/0')
  n.link(r2, 'GigabitEthernet0/1', pc1, 'FastEthernet0')
  n.config(
    r1,
    'int g0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shut',
    'int s0/0/0', 'ip address 10.0.12.1 255.255.255.252', 'no shut',
    'ip route 192.168.2.0 255.255.255.0 10.0.12.2',
  )
  n.config(
    r2,
    'int g0/1', 'ip address 192.168.2.1 255.255.255.0', 'no shut',
    'int s0/0/0', 'ip address 10.0.12.2 255.255.255.252', 'no shut',
    'ip route 192.168.1.0 255.255.255.0 10.0.12.1',
  )
  n.host(pc0, '192.168.1.10', '255.255.255.0', '192.168.1.1')
  n.host(pc2, '192.168.1.20', '255.255.255.0', '192.168.1.1')
  n.host(pc1, '192.168.2.10', '255.255.255.0', '192.168.2.1')
  n.pc(pc0, 'ping 192.168.2.10')
  n.pc(pc2, 'ping 192.168.2.10')
  return { n, r1, r2, pc0, pc1, pc2 }
}

describe('standard access lists', () => {
  it('filters by source address, close to the destination', () => {
    const { n, r2, pc0, pc2 } = topology()
    n.config(r2, 'access-list 10 deny host 192.168.1.10', 'access-list 10 permit any', 'int g0/1', 'ip access-group 10 out')
    expect(unreachable(n.pc(pc0, 'ping 192.168.2.10'))).toEqual(
      Array(4).fill('Reply from 10.0.12.2: Destination host unreachable.'),
    )
    expect(replies(n.pc(pc2, 'ping 192.168.2.10'))).toHaveLength(4)
  })

  it('ends with an implicit deny', () => {
    const { n, r2, pc0, pc2 } = topology()
    n.config(r2, 'access-list 1 permit host 192.168.1.20', 'int s0/0/0', 'ip access-group 1 in')
    expect(replies(n.pc(pc0, 'ping 192.168.2.10'))).toHaveLength(0)
    expect(replies(n.pc(pc2, 'ping 192.168.2.10'))).toHaveLength(4)
  })

  it('matches a subnet with a wildcard mask', () => {
    const { n, r2, pc0, pc1 } = topology()
    n.config(r2, 'access-list 5 deny 192.168.1.0 0.0.0.255', 'access-list 5 permit any', 'int s0/0/0', 'ip access-group 5 in')
    expect(replies(n.pc(pc0, 'ping 192.168.2.10'))).toHaveLength(0)
    // Traffic from the other side is not concerned by an inbound list on s0/0/0.
    expect(replies(n.pc(pc1, 'ping 192.168.2.1'))).toHaveLength(4)
  })

  it('a list that does not exist permits everything', () => {
    const { n, r2, pc0 } = topology()
    n.config(r2, 'int s0/0/0', 'ip access-group 99 in')
    expect(replies(n.pc(pc0, 'ping 192.168.2.10'))).toHaveLength(4)
  })

  it('does not filter packets the router itself sends', () => {
    const { n, r1 } = topology()
    n.config(r1, 'access-list 1 deny any', 'int s0/0/0', 'ip access-group 1 out')
    expect(n.exec(r1, 'ping 10.0.12.2')).toContain('!!!!!')
  })

  it('is removed with no access-list / no ip access-group', () => {
    const { n, r2, pc0 } = topology()
    n.config(r2, 'access-list 1 deny any', 'int s0/0/0', 'ip access-group 1 in')
    expect(replies(n.pc(pc0, 'ping 192.168.2.10'))).toHaveLength(0)
    n.config(r2, 'int s0/0/0', 'no ip access-group 1 in')
    expect((n.project.devices[r2] as IosDevice).running.interfaces['Serial0/0/0']!.accessGroup).toBeUndefined()
    expect(replies(n.pc(pc0, 'ping 192.168.2.10'))).toHaveLength(4)
    n.config(r2, 'no access-list 1')
    expect((n.project.devices[r2] as IosDevice).running.acls).toEqual({})
  })
})

describe('extended access lists', () => {
  it('filter by protocol, source and destination, close to the source', () => {
    const { n, r1, pc0, pc2 } = topology()
    n.config(
      r1,
      'access-list 100 deny icmp host 192.168.1.10 host 192.168.2.10',
      'access-list 100 permit ip any any',
      'int g0/0', 'ip access-group 100 in',
    )
    expect(unreachable(n.pc(pc0, 'ping 192.168.2.10'))).toEqual(
      Array(4).fill('Reply from 192.168.1.1: Destination host unreachable.'),
    )
    expect(replies(n.pc(pc0, 'ping 10.0.12.2'))).toHaveLength(4)
    expect(replies(n.pc(pc2, 'ping 192.168.2.10'))).toHaveLength(4)
  })

  it('tell echo from echo-reply', () => {
    const { n, r1, pc0, pc1 } = topology()
    // Replies from the LAN are dropped: the LAN can still be pinged *from*, not *to*.
    n.config(r1, 'access-list 110 deny icmp any any echo-reply', 'access-list 110 permit ip any any', 'int g0/0', 'ip access-group 110 in')
    expect(timeouts(n.pc(pc1, 'ping 192.168.1.10'))).toHaveLength(4)
    expect(replies(n.pc(pc0, 'ping 192.168.2.10'))).toHaveLength(4)
  })

  it('a TCP rule does not stop pings', () => {
    const { n, r1, pc0 } = topology()
    n.config(r1, 'access-list 120 deny tcp any any eq 80', 'access-list 120 permit ip any any', 'int g0/0', 'ip access-group 120 in')
    expect(replies(n.pc(pc0, 'ping 192.168.2.10'))).toHaveLength(4)
    expect(n.exec(r1, 'show access-lists')).toContain('    10 deny tcp any any eq www')
  })

  it('IOS traceroute uses UDP and ping ICMP: a UDP rule only stops the former', () => {
    const { n, r1, r2 } = topology()
    n.config(r2, 'access-list 130 deny udp any any', 'access-list 130 permit ip any any', 'int s0/0/0', 'ip access-group 130 in')
    expect(n.exec(r1, 'ping 192.168.2.10')).toContain('!!!!!')
    expect(n.exec(r1, 'traceroute 192.168.2.10')).toContain('  1 10.0.12.2 !H')
  })

  it('IOS shows U.U.U when a list denies its pings', () => {
    const { n, r1, r2 } = topology()
    n.config(r2, 'access-list 140 deny icmp any any', 'int s0/0/0', 'ip access-group 140 in')
    expect(n.exec(r1, 'ping 192.168.2.10')).toContain('\nU.U.U\n')
  })

  it('show access-lists prints entries with their match counters', () => {
    const { n, r1, pc0, pc2 } = topology()
    n.config(
      r1,
      'access-list 10 permit 192.168.1.0 0.0.0.255',
      'access-list 100 deny icmp host 192.168.1.10 host 192.168.2.10 echo',
      'access-list 100 permit udp any eq domain 192.168.2.0 0.0.0.255',
      'access-list 100 permit ip any any',
      'int g0/0', 'ip access-group 100 in',
    )
    n.pc(pc0, 'ping 192.168.2.10')
    n.pc(pc2, 'ping 192.168.2.10')
    expect(n.exec(r1, 'show access-lists').split('\n')).toEqual([
      'Standard IP access list 10',
      '    10 permit 192.168.1.0, wildcard bits 0.0.0.255',
      'Extended IP access list 100',
      '    10 deny icmp host 192.168.1.10 host 192.168.2.10 echo (4 matches)',
      '    20 permit udp any eq domain 192.168.2.0 0.0.0.255',
      '    30 permit ip any any (4 matches)',
    ])
    expect(n.exec(r1, 'show access-lists 10').split('\n')).toHaveLength(2)
  })
})

describe('named access lists', () => {
  it('are edited in their own mode, with sequence numbers', () => {
    const { n, r1 } = topology()
    const t = new TestConsole(n.project, r1)
    t.runAll('en', 'conf t', 'ip access-list extended BLOCK-PING')
    expect(t.prompt).toBe('Router(config-ext-nacl)#')
    t.runAll('deny icmp any host 192.168.2.10', 'permit ip any any', '5 permit icmp host 192.168.1.20 any')
    expect(t.run('do show access-lists')).toBe(
      [
        'Extended IP access list BLOCK-PING',
        '    5 permit icmp host 192.168.1.20 any',
        '    10 deny icmp any host 192.168.2.10',
        '    20 permit ip any any',
      ].join('\n'),
    )
    t.run('no 10')
    expect(t.device.running.acls['BLOCK-PING']!.entries.map((e) => e.seq)).toEqual([5, 20])
    t.runAll('exit', 'ip access-list standard ADMINS')
    expect(t.prompt).toBe('Router(config-std-nacl)#')
    t.run('permit host 192.168.1.20')
    expect(t.device.running.acls['ADMINS']).toMatchObject({ type: 'standard' })
  })

  it('work like numbered lists once applied', () => {
    const { n, r1, pc0, pc2 } = topology()
    n.config(
      r1,
      'ip access-list extended ONLY-PC2', 'permit icmp host 192.168.1.20 any', 'exit',
      'int g0/0', 'ip access-group ONLY-PC2 in',
    )
    expect(replies(n.pc(pc0, 'ping 192.168.2.10'))).toHaveLength(0)
    expect(replies(n.pc(pc2, 'ping 192.168.2.10'))).toHaveLength(4)
  })

  it('refuse to change the type of an existing list', () => {
    const { n, r1 } = topology()
    const t = new TestConsole(n.project, r1)
    t.runAll('en', 'conf t', 'ip access-list standard X', 'exit')
    expect(t.run('ip access-list extended X')).toBe('% Access-list type conflicts with prior definition')
  })
})

describe('access list syntax', () => {
  it('normalizes addresses like IOS', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'conf t', 'access-list 10 permit 192.168.1.5', 'access-list 10 deny 192.168.1.77 0.0.0.255', 'access-list 10 permit any')
    expect(t.device.running.acls['10']!.entries.map((e) => e.src)).toEqual([
      { address: '192.168.1.5', wildcard: '0.0.0.0' },
      { address: '192.168.1.0', wildcard: '0.0.0.255' },
      { address: '0.0.0.0', wildcard: '255.255.255.255' },
    ])
  })

  it('rejects incomplete or out-of-range commands', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'conf t')
    expect(t.run('access-list 150 permit ip any')).toBe('% Incomplete command.\n')
    expect(t.run('access-list 200 permit any')).toContain(MARKER_MSG)
    expect(t.run('access-list 10 permit ip any any')).toContain(MARKER_MSG)
    expect(t.run('access-list 100 permit icmp any any eq 80')).toContain(MARKER_MSG)
    expect(t.run('access-list 100 permit tcp any any eq 70000')).toContain(MARKER_MSG)
  })

  it('is written to the running-config, numbered then named', () => {
    const t = TestConsole.of('router')
    t.runAll(
      'en', 'conf t',
      'access-list 10 permit host 192.168.1.5',
      'access-list 100 permit tcp 192.168.1.0 0.0.0.255 any eq 443',
      'ip access-list standard ADMINS', 'permit 10.0.0.0 0.255.255.255', 'exit',
      'int g0/0', 'ip access-group 100 in', 'ip access-group ADMINS out',
    )
    const run = t.run('do show running-config')
    expect(run).toContain(
      [
        'access-list 10 permit 192.168.1.5',
        'access-list 100 permit tcp 192.168.1.0 0.0.0.255 any eq 443',
        'ip access-list standard ADMINS',
        ' permit 10.0.0.0 0.255.255.255',
        '!',
      ].join('\n'),
    )
    expect(run).toContain(' ip access-group 100 in\n ip access-group ADMINS out\n')
  })
})
