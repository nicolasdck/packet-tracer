import { describe, expect, it } from 'vitest'
import type { IosDevice } from '../model/types'
import { migrateProject } from '../project/migrate'
import { network } from '../sim/testNetwork'
import { TestConsole } from './testing'

const MARKER_MSG = "% Invalid input detected at '^' marker."

function configured(kind: 'router' | 'switch-l2' | 'switch-l3') {
  const t = TestConsole.of(kind)
  t.runAll('enable', 'configure terminal')
  return t
}

describe('vlan database', () => {
  it('creates and names a VLAN in config-vlan mode', () => {
    const t = configured('switch-l2')
    t.run('vlan 10')
    expect(t.prompt).toBe('Switch(config-vlan)#')
    t.runAll('name SALES', 'exit')
    expect(t.prompt).toBe('Switch(config)#')
    expect(t.device.running.vlans[10]).toEqual({ name: 'SALES' })
  })

  it('uses VLANxxxx as the default name', () => {
    const t = configured('switch-l2')
    t.runAll('vlan 20', 'exit')
    expect(t.device.running.vlans[20]).toEqual({ name: 'VLAN0020' })
  })

  it('show vlan brief lists VLANs with their access ports, 4 per line', () => {
    const t = configured('switch-l2')
    t.runAll('vlan 10', 'name SALES', 'int fa0/5', 'switchport mode access', 'switchport access vlan 10', 'end')
    const lines = t.run('show vlan brief').split('\n')
    expect(lines[0]).toBe('VLAN Name                             Status    Ports')
    expect(lines[1]).toBe('---- -------------------------------- --------- -------------------------------')
    expect(lines[2]).toBe('1    default                          active    Fa0/1, Fa0/2, Fa0/3, Fa0/4')
    expect(lines[3]).toBe(' '.repeat(48) + 'Fa0/6, Fa0/7, Fa0/8, Fa0/9')
    expect(lines).toContain('10   SALES                            active    Fa0/5')
    expect(lines).toContain('1002 fddi-default                     active    ')
    expect(lines.at(-1)).toBe('1005 trnet-default                    active    ')
  })

  it('deletes VLANs but not the default ones', () => {
    const t = configured('switch-l2')
    t.runAll('vlan 10', 'exit')
    expect(t.run('no vlan 1')).toBe('%Default VLAN 1 may not be deleted.')
    expect(t.run('no vlan 1002')).toBe('%Default VLAN 1002 may not be deleted.')
    t.run('no vlan 10')
    expect(t.device.running.vlans[10]).toBeUndefined()
  })

  it('is not available on a router', () => {
    const t = configured('router')
    expect(t.run('vlan 10')).toContain(MARKER_MSG)
  })

  it('is not part of the running-config and survives a reload', () => {
    const t = configured('switch-l2')
    t.runAll('vlan 10', 'name SALES', 'end')
    expect(t.run('show running-config')).not.toMatch(/^vlan 10$/m)
    t.runAll('reload', 'no', '', '')
    expect(t.device.running.vlans[10]).toEqual({ name: 'SALES' })
  })
})

describe('switchport', () => {
  it('access vlan creates a missing VLAN', () => {
    const t = configured('switch-l2')
    t.run('int fa0/1')
    expect(t.run('switchport access vlan 30')).toBe('% Access VLAN does not exist. Creating vlan 30')
    expect(t.device.running.vlans[30]).toEqual({ name: 'VLAN0030' })
    expect(t.run('switchport access vlan 30')).toBe('')
  })

  it('is shown in the running-config in IOS order', () => {
    const t = configured('switch-l2')
    t.runAll('int fa0/1', 'switchport mode access', 'switchport access vlan 10')
    t.runAll('int g0/1', 'switchport mode trunk', 'switchport trunk native vlan 99', 'switchport trunk allowed vlan 10,20,99')
    const run = t.run('do sh run')
    expect(run).toContain('interface FastEthernet0/1\n switchport access vlan 10\n switchport mode access\n!')
    expect(run).toContain(
      'interface GigabitEthernet0/1\n switchport trunk native vlan 99\n switchport trunk allowed vlan 10,20,99\n switchport mode trunk\n!',
    )
  })

  it('edits the allowed VLAN list', () => {
    const t = configured('switch-l2')
    t.runAll('int g0/1', 'switchport trunk allowed vlan 10,20')
    const allowed = () => t.device.running.interfaces['GigabitEthernet0/1']!.switchport!.allowedVlans
    expect(allowed()).toEqual([10, 20])
    t.run('switchport trunk allowed vlan add 30-31')
    expect(allowed()).toEqual([10, 20, 30, 31])
    t.run('switchport trunk allowed vlan remove 20')
    expect(allowed()).toEqual([10, 30, 31])
    t.run('switchport trunk allowed vlan none')
    expect(allowed()).toEqual([])
    expect(t.run('do sh run')).toContain(' switchport trunk allowed vlan none')
    t.run('switchport trunk allowed vlan all')
    expect(allowed()).toBe('all')
    t.runAll('switchport trunk allowed vlan remove 5', 'no switchport trunk allowed vlan')
    expect(allowed()).toBe('all')
  })

  it('rejects invalid VLAN lists', () => {
    const t = configured('switch-l2')
    t.run('int g0/1')
    expect(t.run('switchport trunk allowed vlan 10-5')).toContain(MARKER_MSG)
    expect(t.run('switchport access vlan 4095')).toContain(MARKER_MSG)
  })

  it('no forms restore the defaults', () => {
    const t = configured('switch-l2')
    t.runAll('int fa0/1', 'switchport mode trunk', 'switchport access vlan 10', 'switchport trunk native vlan 5')
    t.runAll('no switchport mode', 'no switchport access vlan', 'no switchport trunk native vlan')
    expect(t.device.running.interfaces['FastEthernet0/1']!.switchport).toEqual({
      mode: 'dynamic-auto',
      accessVlan: 1,
      nativeVlan: 1,
      allowedVlans: 'all',
    })
  })

  it('applies to every port of an interface range', () => {
    const t = configured('switch-l2')
    t.runAll('interface range fa0/1 - 3', 'switchport mode access', 'switchport access vlan 10')
    const sp = (n: number) => t.device.running.interfaces[`FastEthernet0/${n}`]!.switchport!
    expect([1, 2, 3].map((n) => sp(n).accessVlan)).toEqual([10, 10, 10])
    expect(sp(4).accessVlan).toBe(1)
  })

  it('is not available on a router interface', () => {
    const t = configured('router')
    t.run('int g0/0')
    expect(t.run('switchport mode access')).toContain(MARKER_MSG)
  })

  it('3560 needs trunk encapsulation before trunk mode', () => {
    const t = configured('switch-l3')
    t.run('int g0/1')
    expect(t.run('switchport mode trunk')).toBe(
      'Command rejected: An interface whose trunk encapsulation is "Auto" can not be configured to "trunk" mode.',
    )
    t.runAll('switchport trunk encapsulation dot1q', 'switchport mode trunk')
    expect(t.run('do sh run')).toContain(
      'interface GigabitEthernet0/1\n switchport trunk encapsulation dot1q\n switchport mode trunk\n!',
    )
  })

  it('trunk encapsulation does not exist on a 2960', () => {
    const t = configured('switch-l2')
    t.run('int g0/1')
    expect(t.run('switchport trunk encapsulation dot1q')).toContain(MARKER_MSG)
  })
})

describe('routed ports and ip routing (3560)', () => {
  it('no switchport turns a port into a routed port', () => {
    const t = configured('switch-l3')
    t.run('int fa0/1')
    expect(t.run('ip address 10.0.0.1 255.255.255.0')).toBe('% IP addresses may not be configured on L2 links.')
    t.runAll('no switchport', 'ip address 10.0.0.1 255.255.255.0')
    expect(t.run('do sh run')).toContain('interface FastEthernet0/1\n no switchport\n ip address 10.0.0.1 255.255.255.0\n!')
    t.run('switchport')
    expect(t.device.running.interfaces['FastEthernet0/1']!.ip).toBeUndefined()
    expect(t.device.running.interfaces['FastEthernet0/1']!.switchport?.mode).toBe('dynamic-auto')
  })

  it('a 2960 port cannot become a routed port', () => {
    const t = configured('switch-l2')
    t.run('int fa0/1')
    expect(t.run('no switchport')).toBe('% Incomplete command.')
    expect(t.run('ip address 10.0.0.1 255.0.0.0')).toContain(MARKER_MSG)
  })

  it('ip routing is shown in the running-config and removable', () => {
    const t = configured('switch-l3')
    t.run('ip routing')
    expect(t.device.running.ipRouting).toBe(true)
    expect(t.run('do sh run')).toMatch(/^ip routing$/m)
    t.run('no ip routing')
    expect(t.run('do sh run')).not.toMatch(/^ip routing$/m)
  })

  it('ip routing is not available on a 2960', () => {
    const t = configured('switch-l2')
    expect(t.run('ip routing')).toContain(MARKER_MSG)
  })
})

describe('SVIs', () => {
  it('interface vlan creates an SVI and enters it', () => {
    const t = configured('switch-l2')
    t.run('interface vlan 10')
    expect(t.prompt).toBe('Switch(config-if)#')
    t.run('ip address 192.168.10.2 255.255.255.0')
    expect(t.device.running.interfaces['Vlan10']).toMatchObject({ shutdown: false, ip: { address: '192.168.10.2' } })
    expect(t.run('do sh run')).toContain('interface Vlan1\n no ip address\n shutdown\n!\ninterface Vlan10\n ip address 192.168.10.2 255.255.255.0\n!')
  })

  it('an SVI is down until a port in its VLAN is up', () => {
    const n = network()
    const sw = n.add('switch-l2')
    const pc = n.add('pc')
    n.config(sw, 'interface vlan 1', 'no shutdown')
    expect(n.exec(sw, 'show ip interface brief')).toMatch(/^Vlan1\s+unassigned\s+YES unset\s+down\s+down$/m)
    n.link(pc, 'FastEthernet0', sw, 'FastEthernet0/1')
    expect(n.exec(sw, 'show ip interface brief')).toMatch(/^Vlan1\s+unassigned\s+YES unset\s+up\s+up$/m)
    n.config(sw, 'int fa0/1', 'switchport access vlan 10')
    expect(n.exec(sw, 'show ip interface brief')).toMatch(/^Vlan1\s+unassigned\s+YES unset\s+down\s+down$/m)
  })

  it('no interface vlan removes the SVI', () => {
    const t = configured('switch-l2')
    t.runAll('interface vlan 10', 'exit', 'no interface vlan 10')
    expect(t.device.running.interfaces['Vlan10']).toBeUndefined()
  })

  it('does not exist on routers', () => {
    const t = configured('router')
    expect(t.run('interface vlan 10')).toContain(MARKER_MSG)
  })
})

describe('subinterfaces', () => {
  it('interface g0/0.10 creates a subinterface in config-subif mode', () => {
    const t = configured('router')
    t.run('int g0/0.10')
    expect(t.prompt).toBe('Router(config-subif)#')
    expect(t.session.ifContext).toEqual(['GigabitEthernet0/0.10'])
  })

  it('needs an encapsulation before an IP address', () => {
    const t = configured('router')
    t.run('int g0/0.10')
    expect(t.run('ip address 192.168.10.1 255.255.255.0')).toMatch(/^% Configuring IP routing on a LAN subinterface/)
    t.runAll('encapsulation dot1Q 10', 'ip address 192.168.10.1 255.255.255.0')
    expect(t.run('do sh run')).toContain(
      'interface GigabitEthernet0/0.10\n encapsulation dot1Q 10\n ip address 192.168.10.1 255.255.255.0\n!',
    )
  })

  it('supports the native keyword', () => {
    const t = configured('router')
    t.runAll('int g0/0.1', 'encapsulation dot1Q 1 native')
    expect(t.device.running.interfaces['GigabitEthernet0/0.1']!.encapsulation).toEqual({ vlan: 1, native: true })
    expect(t.run('do sh run')).toContain(' encapsulation dot1Q 1 native')
  })

  it('is listed after its parent and follows its state', () => {
    const t = configured('router')
    t.runAll('int g0/0.20', 'encapsulation dot1Q 20', 'int g0/0.10', 'encapsulation dot1Q 10', 'end')
    const brief = t.run('show ip interface brief').split('\n').map((l) => l.split(/\s+/)[0])
    expect(brief.slice(1, 4)).toEqual(['GigabitEthernet0/0', 'GigabitEthernet0/0.10', 'GigabitEthernet0/0.20'])
    expect(t.run('show ip interface brief')).toMatch(/^GigabitEthernet0\/0\.10\s+unassigned\s+YES unset\s+down\s+down$/m)
    expect(t.run('show interfaces g0/0.10')).toContain('Encapsulation 802.1Q Virtual LAN, Vlan ID  10.')
  })

  it('can be removed, unlike physical interfaces', () => {
    const t = configured('router')
    t.runAll('int g0/0.10', 'exit')
    expect(t.run('no interface g0/0')).toBe('% Physical interfaces cannot be removed.')
    t.run('no interface g0/0.10')
    expect(t.device.running.interfaces['GigabitEthernet0/0.10']).toBeUndefined()
  })

  it('does not exist on switches', () => {
    const t = configured('switch-l3')
    expect(t.run('int g0/1.10')).toContain(MARKER_MSG)
  })
})

describe('show interfaces trunk', () => {
  function trunkPair(modeA: string[], modeB: string[]) {
    const n = network()
    const a = n.add('switch-l2')
    const b = n.add('switch-l2')
    n.link(a, 'GigabitEthernet0/1', b, 'GigabitEthernet0/1')
    n.config(a, 'vlan 10', 'exit', 'int g0/1', ...modeA)
    n.config(b, 'int g0/1', ...modeB)
    return { n, a, b }
  }

  it('lists operational trunks with their VLANs', () => {
    const { n, a } = trunkPair(['switchport mode trunk', 'switchport trunk allowed vlan 1,10,20'], [])
    expect(n.exec(a, 'show interfaces trunk')).toBe(
      [
        'Port        Mode         Encapsulation  Status        Native vlan',
        'Gi0/1       on           802.1q         trunking      1',
        '',
        'Port        Vlans allowed on trunk',
        'Gi0/1       1,10,20',
        '',
        'Port        Vlans allowed and active in management domain',
        'Gi0/1       1,10',
        '',
        'Port        Vlans in spanning tree forwarding state and not pruned',
        'Gi0/1       1,10',
      ].join('\n'),
    )
  })

  it('a dynamic auto port facing a trunk becomes a trunk (mode auto)', () => {
    const { n, b } = trunkPair(['switchport mode trunk'], [])
    expect(n.exec(b, 'show interfaces trunk')).toContain('Gi0/1       auto         802.1q         trunking      1')
    expect(n.exec(b, 'show interfaces trunk')).toContain('Gi0/1       1-4094')
  })

  it('two dynamic auto ports stay access ports', () => {
    const { n, a } = trunkPair([], [])
    expect(n.exec(a, 'show interfaces trunk')).toBe('')
  })
})

describe('migration', () => {
  it('fills ip routing for projects saved before lot 4', () => {
    const n = network()
    const r = n.add('router')
    const s = n.add('switch-l3')
    const old = structuredClone(n.project)
    delete (old.devices[r] as { running: { ipRouting?: boolean } }).running.ipRouting
    delete (old.devices[s] as { running: { ipRouting?: boolean } }).running.ipRouting
    const migrated = migrateProject(old)
    expect((migrated.devices[r] as IosDevice).running.ipRouting).toBe(true)
    expect((migrated.devices[s] as IosDevice).running.ipRouting).toBe(false)
    expect(migrateProject(migrated)).toBe(migrated)
  })
})
