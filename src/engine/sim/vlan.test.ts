import { describe, expect, it } from 'vitest'
import { TestConsole } from '../cli/testing'
import type { IosDevice } from '../model/types'
import { network } from './testNetwork'

const replies = (out: string) => out.split('\n').filter((l) => l.startsWith('Reply from') && !l.includes('unreachable'))
const timeouts = (out: string) => out.split('\n').filter((l) => l === 'Request timed out.')

/** Two PCs on one 2960, in the same subnet. */
function oneSwitch() {
  const n = network()
  const sw = n.add('switch-l2')
  const pc0 = n.add('pc')
  const pc1 = n.add('pc')
  n.link(pc0, 'FastEthernet0', sw, 'FastEthernet0/1')
  n.link(pc1, 'FastEthernet0', sw, 'FastEthernet0/2')
  n.host(pc0, '192.168.10.1', '255.255.255.0')
  n.host(pc1, '192.168.10.2', '255.255.255.0')
  return { n, sw, pc0, pc1 }
}

/** PC0 — SW0 ==(Gi0/1)== SW1 — PC1, both PCs in VLAN 10. */
function twoSwitches(trunkA: string[] = ['switchport mode trunk'], trunkB: string[] = []) {
  const n = network()
  const s0 = n.add('switch-l2')
  const s1 = n.add('switch-l2')
  const pc0 = n.add('pc')
  const pc1 = n.add('pc')
  n.link(pc0, 'FastEthernet0', s0, 'FastEthernet0/1')
  n.link(pc1, 'FastEthernet0', s1, 'FastEthernet0/1')
  n.link(s0, 'GigabitEthernet0/1', s1, 'GigabitEthernet0/1')
  n.config(s0, 'int fa0/1', 'switchport mode access', 'switchport access vlan 10', 'int g0/1', ...trunkA)
  n.config(s1, 'int fa0/1', 'switchport mode access', 'switchport access vlan 10', 'int g0/1', ...trunkB)
  n.host(pc0, '192.168.10.1', '255.255.255.0')
  n.host(pc1, '192.168.10.2', '255.255.255.0')
  return { n, s0, s1, pc0, pc1 }
}

/**
 * Router-on-a-stick: PC10 (VLAN 10) and PC20 (VLAN 20) on a 2960,
 * trunk Gi0/1 to Router0 Gi0/0 with subinterfaces .10 and .20.
 */
function roas(opts: { trunk?: boolean; vlan20Tag?: number } = {}) {
  const n = network()
  const sw = n.add('switch-l2')
  const r = n.add('router')
  const pc10 = n.add('pc')
  const pc20 = n.add('pc')
  n.link(pc10, 'FastEthernet0', sw, 'FastEthernet0/1')
  n.link(pc20, 'FastEthernet0', sw, 'FastEthernet0/2')
  n.link(sw, 'GigabitEthernet0/1', r, 'GigabitEthernet0/0')
  n.config(
    sw,
    'int fa0/1', 'switchport mode access', 'switchport access vlan 10',
    'int fa0/2', 'switchport mode access', 'switchport access vlan 20',
    'int g0/1', ...(opts.trunk === false ? [] : ['switchport mode trunk']),
  )
  n.config(
    r,
    'int g0/0', 'no shutdown',
    'int g0/0.10', 'encapsulation dot1Q 10', 'ip address 192.168.10.254 255.255.255.0',
    'int g0/0.20', `encapsulation dot1Q ${opts.vlan20Tag ?? 20}`, 'ip address 192.168.20.254 255.255.255.0',
  )
  n.host(pc10, '192.168.10.1', '255.255.255.0', '192.168.10.254')
  n.host(pc20, '192.168.20.1', '255.255.255.0', '192.168.20.254')
  return { n, sw, r, pc10, pc20 }
}

/** 3560 with SVIs 10 and 20 as gateways for PC10 and PC20. */
function multilayer(routing = true) {
  const n = network()
  const ml = n.add('switch-l3')
  const pc10 = n.add('pc')
  const pc20 = n.add('pc')
  n.link(pc10, 'FastEthernet0', ml, 'FastEthernet0/1')
  n.link(pc20, 'FastEthernet0', ml, 'FastEthernet0/2')
  n.config(
    ml,
    ...(routing ? ['ip routing'] : []),
    'int fa0/1', 'switchport mode access', 'switchport access vlan 10',
    'int fa0/2', 'switchport mode access', 'switchport access vlan 20',
    'interface vlan 10', 'ip address 192.168.10.254 255.255.255.0',
    'interface vlan 20', 'ip address 192.168.20.254 255.255.255.0',
  )
  n.host(pc10, '192.168.10.1', '255.255.255.0', '192.168.10.254')
  n.host(pc20, '192.168.20.1', '255.255.255.0', '192.168.20.254')
  return { n, ml, pc10, pc20 }
}

describe('access VLANs on one switch', () => {
  it('PCs in the same VLAN reach each other', () => {
    const { n, sw, pc0 } = oneSwitch()
    n.config(sw, 'int range fa0/1 - 2', 'switchport mode access', 'switchport access vlan 10')
    expect(replies(n.pc(pc0, 'ping 192.168.10.2'))).toHaveLength(4)
  })

  it('PCs in different VLANs do not, even in the same subnet', () => {
    const { n, sw, pc0 } = oneSwitch()
    n.config(sw, 'int fa0/2', 'switchport access vlan 20')
    expect(timeouts(n.pc(pc0, 'ping 192.168.10.2'))).toHaveLength(4)
  })

  it('a port in a deleted VLAN is inactive', () => {
    const { n, sw, pc0 } = oneSwitch()
    n.config(sw, 'int range fa0/1 - 2', 'switchport access vlan 10', 'exit', 'no vlan 10')
    expect(timeouts(n.pc(pc0, 'ping 192.168.10.2'))).toHaveLength(4)
  })
})

describe('trunks between switches', () => {
  it('carry a VLAN across two switches', () => {
    const { n, pc0 } = twoSwitches()
    expect(replies(n.pc(pc0, 'ping 192.168.10.2'))).toHaveLength(4)
  })

  it('two dynamic auto ports do not form a trunk: VLAN 10 is cut', () => {
    const { n, pc0 } = twoSwitches([], [])
    expect(timeouts(n.pc(pc0, 'ping 192.168.10.2'))).toHaveLength(4)
  })

  it('a VLAN removed from the allowed list is cut', () => {
    const { n, pc0 } = twoSwitches(['switchport mode trunk', 'switchport trunk allowed vlan 1,20'])
    expect(timeouts(n.pc(pc0, 'ping 192.168.10.2'))).toHaveLength(4)
  })

  it('the native VLAN crosses untagged: a mismatch leaks between VLANs', () => {
    // Both ends send VLAN 10 untagged, so it still works when both natives are 10...
    const ok = twoSwitches(
      ['switchport mode trunk', 'switchport trunk native vlan 10'],
      ['switchport mode trunk', 'switchport trunk native vlan 10'],
    )
    expect(replies(ok.n.pc(ok.pc0, 'ping 192.168.10.2'))).toHaveLength(4)
    // ...but SW1 puts untagged frames in VLAN 1: VLAN 10 no longer reaches its PC.
    const bad = twoSwitches(['switchport mode trunk', 'switchport trunk native vlan 10'], ['switchport mode trunk'])
    expect(timeouts(bad.n.pc(bad.pc0, 'ping 192.168.10.2'))).toHaveLength(4)
  })

  it('survives a loop of two trunks', () => {
    const { n, s0, s1, pc0 } = twoSwitches()
    n.link(s0, 'GigabitEthernet0/2', s1, 'GigabitEthernet0/2')
    n.config(s0, 'int g0/2', 'switchport mode trunk')
    expect(replies(n.pc(pc0, 'ping 192.168.10.2'))).toHaveLength(4)
  })
})

describe('router-on-a-stick', () => {
  it('routes between VLANs through subinterfaces', () => {
    const { n, pc10 } = roas()
    const first = n.pc(pc10, 'ping 192.168.20.1')
    expect(timeouts(first)).toHaveLength(1)
    expect(replies(first)).toEqual(Array(3).fill('Reply from 192.168.20.1: bytes=32 time<1ms TTL=127'))
    expect(replies(n.pc(pc10, 'ping 192.168.20.1'))).toHaveLength(4)
  })

  it('PC reaches its gateway subinterface', () => {
    const { n, pc10 } = roas()
    expect(replies(n.pc(pc10, 'ping 192.168.10.254'))).toHaveLength(4)
  })

  it('fails when the switch port to the router is not a trunk', () => {
    const { n, pc10 } = roas({ trunk: false })
    expect(timeouts(n.pc(pc10, 'ping 192.168.10.254'))).toHaveLength(4)
  })

  it('fails when a subinterface uses the wrong VLAN tag', () => {
    const { n, pc10 } = roas({ vlan20Tag: 30 })
    const out = n.pc(pc10, 'ping 192.168.20.1')
    expect(replies(out)).toHaveLength(0)
  })

  it('native subinterface receives untagged frames', () => {
    const { n, sw, r } = roas()
    const pc1 = n.add('pc')
    n.link(pc1, 'FastEthernet0', sw, 'FastEthernet0/3')
    n.config(r, 'int g0/0.1', 'encapsulation dot1Q 1 native', 'ip address 192.168.1.254 255.255.255.0')
    n.host(pc1, '192.168.1.1', '255.255.255.0', '192.168.1.254')
    expect(replies(n.pc(pc1, 'ping 192.168.1.254'))).toHaveLength(4)
  })

  it('traceroute shows the subinterface as the first hop', () => {
    const { n, pc10 } = roas()
    n.pc(pc10, 'ping 192.168.20.1')
    const out = n.pc(pc10, 'tracert 192.168.20.1')
    expect(out).toContain('  1   0 ms      0 ms      0 ms      192.168.10.254')
    expect(out).toContain('  2   0 ms      0 ms      0 ms      192.168.20.1')
  })
})

describe('multilayer switch (3560)', () => {
  it('routes between SVIs with ip routing', () => {
    const { n, pc10 } = multilayer()
    n.pc(pc10, 'ping 192.168.20.1')
    expect(replies(n.pc(pc10, 'ping 192.168.20.1'))).toEqual(
      Array(4).fill('Reply from 192.168.20.1: bytes=32 time<1ms TTL=127'),
    )
  })

  it('does not route without ip routing, but still answers on its SVIs', () => {
    const { n, pc10 } = multilayer(false)
    expect(replies(n.pc(pc10, 'ping 192.168.10.254'))).toHaveLength(4)
    expect(replies(n.pc(pc10, 'ping 192.168.20.1'))).toHaveLength(0)
  })

  it('a routed port talks to a router', () => {
    const n = network()
    const ml = n.add('switch-l3')
    const r = n.add('router')
    n.link(ml, 'GigabitEthernet0/1', r, 'GigabitEthernet0/0')
    n.config(ml, 'int g0/1', 'no switchport', 'ip address 10.0.0.1 255.255.255.252')
    n.config(r, 'int g0/0', 'ip address 10.0.0.2 255.255.255.252', 'no shutdown')
    expect(n.exec(ml, 'ping 10.0.0.2')).toContain('.!!!!')
    // Back to a switch port: the address is gone, nothing answers.
    n.config(ml, 'int g0/1', 'switchport')
    expect(n.exec(r, 'ping 10.0.0.1')).toContain('Success rate is 0 percent')
  })
})

describe('switch management SVI (2960)', () => {
  it('a PC pings the switch on its VLAN 1 address', () => {
    const { n, sw, pc0 } = oneSwitch()
    n.config(sw, 'interface vlan 1', 'ip address 192.168.10.100 255.255.255.0', 'no shutdown')
    expect(replies(n.pc(pc0, 'ping 192.168.10.100'))).toEqual(
      Array(4).fill('Reply from 192.168.10.100: bytes=32 time<1ms TTL=255'),
    )
    expect(n.exec(sw, 'ping 192.168.10.2')).toContain('.!!!!')
  })

  it('fails while the SVI is shut down', () => {
    const { n, sw, pc0 } = oneSwitch()
    n.config(sw, 'interface vlan 1', 'ip address 192.168.10.100 255.255.255.0')
    expect(timeouts(n.pc(pc0, 'ping 192.168.10.100'))).toHaveLength(4)
  })
})

describe('MAC address table', () => {
  it('learns both PCs on their ports and VLAN', () => {
    const { n, s0, s1, pc0, pc1 } = twoSwitches()
    n.pc(pc0, 'ping 192.168.10.2')
    const mac0 = n.project.devices[pc0]!.ports[0]!.mac
    const mac1 = n.project.devices[pc1]!.ports[0]!.mac
    const table = (id: string) =>
      (n.project.devices[id] as IosDevice).runtime.mac.map((e) => `${e.vlan} ${e.mac} ${e.port}`).sort()
    expect(table(s0)).toEqual([`10 ${mac0} FastEthernet0/1`, `10 ${mac1} GigabitEthernet0/1`].sort())
    expect(table(s1)).toEqual([`10 ${mac0} GigabitEthernet0/1`, `10 ${mac1} FastEthernet0/1`].sort())
  })

  it('show mac address-table prints the IOS table', () => {
    const { n, s0, pc0 } = twoSwitches()
    n.pc(pc0, 'ping 192.168.10.2')
    const out = n.exec(s0, 'show mac address-table')
    const lines = out.split('\n')
    expect(lines.slice(0, 6)).toEqual([
      '          Mac Address Table',
      '-------------------------------------------',
      '',
      'Vlan    Mac Address       Type        Ports',
      '----    -----------       --------    -----',
      '',
    ])
    const mac0 = n.project.devices[pc0]!.ports[0]!.mac
    expect(lines).toContain(`  10    ${mac0}    DYNAMIC     Fa0/1`)
    expect(n.exec(s0, 'show mac-address-table')).toBe(out)
  })

  it('is empty before any traffic and cleared by reload', () => {
    const { n, s0, pc0 } = twoSwitches()
    expect(n.exec(s0, 'show mac address-table').split('\n')).toHaveLength(6)
    n.pc(pc0, 'ping 192.168.10.2')
    expect((n.project.devices[s0] as IosDevice).runtime.mac).toHaveLength(2)
    const t = new TestConsole(n.project, s0)
    t.runAll('enable', 'write memory', 'reload', '')
    expect((t.project.devices[s0] as IosDevice).runtime.mac).toEqual([])
  })

  it('is not available on a router', () => {
    const { n, r } = roas()
    expect(n.exec(r, 'show mac address-table')).toContain("% Invalid input detected at '^' marker.")
  })
})

describe('show arp', () => {
  it('lists own interfaces (age -) and learned entries (age 0)', () => {
    const { n, r, pc10 } = roas()
    n.pc(pc10, 'ping 192.168.10.254')
    const out = n.exec(r, 'show arp')
    const pcMac = n.project.devices[pc10]!.ports[0]!.mac
    const rMac = n.project.devices[r]!.ports[0]!.mac
    expect(out.split('\n')).toEqual([
      'Protocol  Address          Age (min)  Hardware Addr   Type   Interface',
      `Internet  192.168.10.1             0   ${pcMac}  ARPA   GigabitEthernet0/0.10`,
      `Internet  192.168.10.254           -   ${rMac}  ARPA   GigabitEthernet0/0.10`,
      `Internet  192.168.20.254           -   ${rMac}  ARPA   GigabitEthernet0/0.20`,
    ])
    expect(n.exec(r, 'show ip arp')).toBe(out)
  })
})
