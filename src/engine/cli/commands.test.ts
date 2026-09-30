import { describe, expect, it } from 'vitest'
import { createProject } from '../project/create'
import { addDevice, connect } from '../project/topology'
import { type7 } from './crypto'
import { TestConsole } from './testing'

const MARKER_MSG = "% Invalid input detected at '^' marker."

function configured(kind: 'router' | 'switch-l2' | 'switch-l3' = 'router') {
  const t = TestConsole.of(kind)
  t.runAll('enable', 'configure terminal')
  return t
}

/** Router0 Gi0/0 ↔ Switch0 Fa0/1, Router0 Se0/0/0 (DCE) ↔ Router1 Se0/0/0. */
function lab() {
  let p = createProject('p', 'lab', 0)
  const r0 = addDevice(p, 'router', { x: 0, y: 0 })
  const r1 = addDevice(r0.project, 'router', { x: 0, y: 0 })
  const sw = addDevice(r1.project, 'switch-l2', { x: 0, y: 0 })
  p = sw.project
  p = connect(p, { deviceId: r0.deviceId, port: 'GigabitEthernet0/0' }, { deviceId: sw.deviceId, port: 'FastEthernet0/1' }).project
  p = connect(p, { deviceId: r0.deviceId, port: 'Serial0/0/0' }, { deviceId: r1.deviceId, port: 'Serial0/0/0' }).project
  return { p, r0: r0.deviceId, r1: r1.deviceId, sw: sw.deviceId }
}

describe('hostname', () => {
  it('changes the prompt', () => {
    const t = configured()
    t.run('hostname R1')
    expect(t.prompt).toBe('R1(config)#')
    expect(t.device.running.hostname).toBe('R1')
  })

  it('rejects illegal names', () => {
    const t = configured()
    expect(t.run('hostname 1abc')).toBe('% Hostname contains one or more illegal characters.')
    expect(t.run('hostname my_router')).toBe('% Hostname contains one or more illegal characters.')
    expect(t.prompt).toBe('Router(config)#')
  })

  it('no hostname restores the default', () => {
    const t = configured('switch-l2')
    t.runAll('hostname S1', 'no hostname')
    expect(t.prompt).toBe('Switch(config)#')
  })
})

describe('enable secret', () => {
  it('protects privileged EXEC with a password prompt', () => {
    const t = configured()
    t.runAll('enable secret class', 'end', 'disable')
    t.run('enable')
    expect(t.prompt).toBe('Password: ')
    expect(t.run('wrong')).toBe('')
    expect(t.prompt).toBe('Password: ')
    t.run('class')
    expect(t.prompt).toBe('Router#')
  })

  it('gives up after three wrong secrets', () => {
    const t = configured()
    t.runAll('enable secret class', 'end', 'disable', 'enable', 'a', 'b')
    expect(t.run('c')).toBe('% Bad secrets\n')
    expect(t.prompt).toBe('Router>')
  })

  it('is shown hashed as type 5 and removed by no', () => {
    const t = configured()
    t.run('enable secret class')
    const run = t.run('do show running-config')
    expect(run).toMatch(/^enable secret 5 \$1\$[./0-9A-Za-z]{4}\$[./0-9A-Za-z]{22}$/m)
    expect(run).not.toMatch(/\bclass\b/)
    t.run('no enable secret')
    expect(t.run('do show running-config')).not.toContain('enable secret')
  })
})

describe('banner motd', () => {
  it('stores a single-line banner and shows it on login', () => {
    const t = configured()
    t.run('banner motd #Authorized access only#')
    expect(t.device.running.bannerMotd).toEqual({ delimiter: '#', text: 'Authorized access only' })
    expect(t.run('do show run')).toContain('banner motd ^CAuthorized access only^C')
    t.runAll('end', 'exit')
    expect(t.run('')).toContain('Authorized access only')
  })

  it('reads a multi-line banner until the delimiter', () => {
    const t = configured()
    expect(t.run('banner motd $')).toBe("Enter TEXT message.  End with the character '$'.")
    expect(t.prompt).toBe('')
    t.runAll('Line one', 'Line two$')
    expect(t.device.running.bannerMotd?.text).toBe('Line one\nLine two')
    expect(t.prompt).toBe('Router(config)#')
  })

  it('no banner motd removes it', () => {
    const t = configured()
    t.runAll('banner motd #Hi#', 'no banner motd')
    expect(t.device.running.bannerMotd).toBeUndefined()
  })
})

describe('line console / vty', () => {
  it('asks for the console password when login is set', () => {
    const t = configured()
    t.runAll('line console 0', 'password cisco', 'login', 'end', 'exit')
    expect(t.run('')).toContain('User Access Verification')
    expect(t.prompt).toBe('Password: ')
    t.run('cisco')
    expect(t.prompt).toBe('Router>')
  })

  it('drops the session after three bad login passwords', () => {
    const t = configured()
    t.runAll('line con 0', 'password cisco', 'login', 'end', 'exit', '', 'a', 'b')
    expect(t.run('c')).toBe('% Bad passwords\n')
    expect(t.prompt).toBe('')
  })

  it('configures vty lines and shows them', () => {
    const t = configured('switch-l2')
    t.runAll('line vty 0 15', 'password telnet', 'exit')
    const run = t.run('do sh run')
    expect(run).toContain('line vty 0 4\n password telnet\n login\nline vty 5 15\n password telnet\n login')
  })

  it('validates line numbers', () => {
    const t = configured()
    expect(t.run('line console 1')).toContain(MARKER_MSG)
    expect(t.run('line vty 0 16')).toContain(MARKER_MSG)
  })

  it('no password / no login', () => {
    const t = configured()
    t.runAll('line con 0', 'password cisco', 'login', 'no password', 'no login')
    expect(t.device.running.lines.console).toEqual({ login: false })
  })
})

describe('service password-encryption', () => {
  it('encrypts existing and new passwords as type 7, and keeps them encrypted', () => {
    const t = configured()
    t.runAll('line con 0', 'password cisco', 'exit', 'service password-encryption')
    expect(t.run('do sh run')).toContain(`line con 0\n password 7 ${type7('cisco')}`)
    t.runAll('line vty 0 4', 'password other', 'exit', 'no service password-encryption')
    const run = t.run('do sh run')
    expect(run).toContain('no service password-encryption')
    expect(run).toContain(` password 7 ${type7('cisco')}`)
    expect(run).toContain(` password 7 ${type7('other')}`)
  })

  it('produces a valid Cisco type 7 string', () => {
    // Seed = sum of char codes % 16, then XOR with the public key.
    expect(type7('cisco')).toMatch(/^\d{2}[0-9A-F]{10}$/)
    expect(type7('cisco')).toBe(type7('cisco'))
  })
})

describe('interface configuration', () => {
  it('sets and removes an IP address', () => {
    const t = configured()
    t.runAll('int g0/0', 'ip address 192.168.1.1 255.255.255.0')
    expect(t.device.running.interfaces['GigabitEthernet0/0']?.ip).toEqual({
      address: '192.168.1.1',
      mask: '255.255.255.0',
      method: 'manual',
    })
    expect(t.run('do sh run')).toContain('interface GigabitEthernet0/0\n ip address 192.168.1.1 255.255.255.0')
    t.run('no ip address')
    expect(t.device.running.interfaces['GigabitEthernet0/0']?.ip).toBeUndefined()
  })

  it('rejects non-contiguous masks, network and broadcast addresses', () => {
    const t = configured()
    t.run('int g0/0')
    expect(t.run('ip address 10.0.0.1 255.0.255.0')).toBe('Bad mask 0xFF00FF00 for address 10.0.0.1')
    expect(t.run('ip address 192.168.1.0 255.255.255.0')).toBe('Bad mask /24 for address 192.168.1.0')
    expect(t.run('ip address 192.168.1.255 255.255.255.0')).toBe('Bad mask /24 for address 192.168.1.255')
    expect(t.run('ip address 10.0.0.0 255.255.255.254')).toBe('')
  })

  it('rejects overlapping subnets on the same device', () => {
    const t = configured()
    t.runAll('int g0/0', 'ip address 192.168.1.1 255.255.255.0', 'int g0/1')
    expect(t.run('ip address 192.168.1.2 255.255.0.0')).toBe('% 192.168.0.0 overlaps with GigabitEthernet0/0')
    expect(t.device.running.interfaces['GigabitEthernet0/1']?.ip).toBeUndefined()
  })

  it('does not accept an IP address on a switch port', () => {
    const t = configured('switch-l2')
    t.run('int fa0/1')
    expect(t.run('ip address 10.0.0.1 255.0.0.0')).toContain(MARKER_MSG)
  })

  it('sets description, duplex and speed', () => {
    const t = configured()
    t.runAll('int g0/0', 'description Link to LAN', 'duplex full', 'speed 100')
    expect(t.device.running.interfaces['GigabitEthernet0/0']).toMatchObject({
      description: 'Link to LAN',
      duplex: 'full',
      speed: 100,
    })
    expect(t.run('do sh run')).toContain(
      'interface GigabitEthernet0/0\n description Link to LAN\n no ip address\n duplex full\n speed 100\n shutdown',
    )
    t.runAll('no description', 'no duplex', 'no speed')
    expect(t.device.running.interfaces['GigabitEthernet0/0']).toMatchObject({ duplex: 'auto', speed: 'auto' })
    expect(t.device.running.interfaces['GigabitEthernet0/0']?.description).toBeUndefined()
  })

  it('only offers speed 1000 on gigabit ports', () => {
    const t = configured('switch-l2')
    t.run('int fa0/1')
    expect(t.run('speed 1000')).toContain(MARKER_MSG)
    t.run('int g0/1')
    expect(t.run('speed 1000')).toBe('')
  })

  it('switch ports only show non-default duplex/speed in the running-config', () => {
    const t = configured('switch-l2')
    expect(t.run('do sh run')).toContain('interface FastEthernet0/1\n!\ninterface FastEthernet0/2\n!')
    t.runAll('int fa0/2', 'duplex half')
    expect(t.run('do sh run')).toContain('interface FastEthernet0/2\n duplex half\n!')
  })
})

describe('shutdown and link state', () => {
  it('prints LINK/LINEPROTO messages when a connected interface comes up', () => {
    const { p, r0 } = lab()
    const t = new TestConsole(p, r0)
    t.runAll('en', 'conf t', 'int g0/0')
    expect(t.run('no shutdown')).toBe(
      [
        '',
        '%LINK-5-CHANGED: Interface GigabitEthernet0/0, changed state to up',
        '',
        '%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0/0, changed state to up',
        '',
      ].join('\n'),
    )
    expect(t.run('shutdown')).toBe(
      [
        '',
        '%LINK-5-CHANGED: Interface GigabitEthernet0/0, changed state to administratively down',
        '',
        '%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0/0, changed state to down',
        '',
      ].join('\n'),
    )
  })

  it('prints nothing when an unconnected interface is enabled', () => {
    const t = configured()
    t.run('int g0/1')
    expect(t.run('no shutdown')).toBe('')
    expect(t.device.running.interfaces['GigabitEthernet0/1']?.shutdown).toBe(false)
  })

  it('show ip interface brief reflects both ends of the link', () => {
    const { p, r0, sw } = lab()
    const s = new TestConsole(p, sw)
    s.run('en')
    expect(s.run('show ip interface brief')).toMatch(/^FastEthernet0\/1\s+unassigned\s+YES unset\s+down\s+down$/m)
    expect(s.run('show ip interface brief')).toMatch(/^Vlan1\s+unassigned\s+YES unset\s+administratively down\s+down$/m)

    const r = new TestConsole(s.project, r0)
    r.runAll('en', 'conf t', 'int g0/0', 'ip address 10.0.0.1 255.255.255.0', 'no shut', 'end')
    const brief = r.run('show ip interface brief')
    expect(brief.split('\n')[0]).toBe('Interface              IP-Address      OK? Method Status                Protocol')
    expect(brief).toContain('GigabitEthernet0/0     10.0.0.1        YES manual up                    up')
    expect(brief).toMatch(/^GigabitEthernet0\/1\s+unassigned\s+YES unset\s+administratively down\s+down$/m)

    const s2 = new TestConsole(r.project, sw)
    s2.run('en')
    expect(s2.run('show ip interface brief')).toMatch(/^FastEthernet0\/1\s+unassigned\s+YES unset\s+up\s+up$/m)
  })

  it('interface range applies to every interface', () => {
    const t = configured('switch-l2')
    t.run('interface range fa0/1 - 3')
    expect(t.prompt).toBe('Switch(config-if-range)#')
    t.run('shutdown')
    const ifs = t.device.running.interfaces
    expect([1, 2, 3, 4].map((i) => ifs[`FastEthernet0/${i}`]?.shutdown)).toEqual([true, true, true, false])
  })

  it('interface range accepts lists and compact ranges', () => {
    const t = configured('switch-l2')
    t.run('interface range f0/1-2 , g0/1')
    expect(t.session.ifContext).toEqual(['FastEthernet0/1', 'FastEthernet0/2', 'GigabitEthernet0/1'])
    t.run('exit')
    expect(t.run('interface range fa0/1 - 30')).toContain(MARKER_MSG)
  })
})

describe('clock rate', () => {
  it('is accepted on the DCE end only', () => {
    const { p, r0, r1 } = lab()
    const dce = new TestConsole(p, r0)
    dce.runAll('en', 'conf t', 'int s0/0/0')
    expect(dce.run('clock rate 64000')).toBe('')
    expect(dce.device.running.interfaces['Serial0/0/0']?.clockRate).toBe(64000)
    expect(dce.run('do sh run')).toContain('interface Serial0/0/0\n no ip address\n clock rate 64000\n shutdown')

    const dte = new TestConsole(dce.project, r1)
    dte.runAll('en', 'conf t', 'int s0/0/0')
    expect(dte.run('clock rate 64000')).toBe('%Error: This command applies only to DCE interfaces')
  })

  it('rejects rates that are not in the IOS list', () => {
    const t = configured()
    t.run('int s0/0/1')
    expect(t.run('clock rate 12345')).toBe('%Error: Invalid clock rate')
    t.runAll('clock rate 2000000', 'no clock rate')
    expect(t.device.running.interfaces['Serial0/0/1']?.clockRate).toBeUndefined()
  })
})

describe('show commands', () => {
  it('show running-config has the IOS structure', () => {
    const t = configured()
    const run = t.run('do show running-config')
    const lines = run.split('\n')
    expect(lines[0]).toBe('Building configuration...')
    expect(lines[2]).toMatch(/^Current configuration : \d+ bytes$/)
    expect(run).toContain('version 15.1\n')
    expect(run).toContain('hostname Router\n')
    expect(run).toContain('interface GigabitEthernet0/0\n no ip address\n duplex auto\n speed auto\n shutdown\n!')
    expect(run).toContain('line con 0\n!\nline aux 0\n!\nline vty 0 4\n login\n')
    expect(run.trimEnd().endsWith('end')).toBe(true)
  })

  it('show interfaces describes one or all interfaces', () => {
    const { p, r0 } = lab()
    const t = new TestConsole(p, r0)
    t.run('en')
    const one = t.run('show interfaces g0/0')
    expect(one.split('\n')[0]).toBe('GigabitEthernet0/0 is administratively down, line protocol is down (disabled)')
    expect(one).toMatch(/Hardware is CN Gigabit Ethernet, address is [0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}/)
    expect(one).toContain('BW 1000000 Kbit')
    expect(one).not.toContain('Serial')
    const all = t.run('show interfaces')
    expect(all).toContain('Serial0/0/1 is administratively down')
    expect(all).toContain('Encapsulation HDLC')
  })

  it('show version identifies the platform', () => {
    const r = TestConsole.of('router')
    expect(r.run('show version')).toContain('C1900 Software')
    expect(r.run('show version')).toContain('Router uptime is')
    const s = TestConsole.of('switch-l3')
    expect(s.run('show version')).toContain('C3560 Software')
    expect(s.run('show version')).toContain('24 FastEthernet interfaces')
  })

  it('show running-config is not available in user EXEC', () => {
    const t = TestConsole.of('router')
    expect(t.run('show running-config')).toContain(MARKER_MSG)
  })
})

describe('startup-config, write and reload', () => {
  it('has no startup-config out of the box', () => {
    const t = TestConsole.of('router')
    t.run('en')
    expect(t.run('show startup-config')).toBe('startup-config is not present')
  })

  it('copy running-config startup-config asks for the destination', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'conf t', 'hostname R1', 'end')
    expect(t.run('copy running-config startup-config')).toBe('')
    expect(t.prompt).toBe('Destination filename [startup-config]? ')
    expect(t.run('')).toBe('Building configuration...\n[OK]')
    expect(t.prompt).toBe('R1#')
    expect(t.run('show startup-config')).toMatch(/^Using \d+ bytes\n!\nversion 15.1/)
    expect(t.run('show startup-config')).toContain('hostname R1')
  })

  it('write memory and write save immediately', () => {
    const t = TestConsole.of('router')
    t.run('en')
    expect(t.run('write memory')).toBe('Building configuration...\n[OK]')
    expect(t.device.startup).not.toBeNull()
    expect(t.run('wr')).toBe('Building configuration...\n[OK]')
  })

  it('startup-config is a snapshot, independent of later changes', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'conf t', 'hostname R1', 'end', 'wr', 'conf t', 'hostname R2', 'end')
    expect(t.device.startup?.hostname).toBe('R1')
    expect(t.device.running.hostname).toBe('R2')
  })

  it('reload restores the startup-config', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'conf t', 'hostname R1', 'int g0/0', 'ip address 10.0.0.1 255.0.0.0', 'end', 'wr')
    t.runAll('conf t', 'hostname Changed', 'end')
    t.run('reload')
    expect(t.prompt).toBe('System configuration has been modified. Save? [yes/no]: ')
    t.run('no')
    expect(t.prompt).toBe('Proceed with reload? [confirm]')
    expect(t.run('')).toContain('Press RETURN to get started!')
    t.run('')
    expect(t.prompt).toBe('R1>')
    expect(t.device.running.interfaces['GigabitEthernet0/0']?.ip?.method).toBe('NVRAM')
  })

  it('reload can save first', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'conf t', 'hostname R9', 'end', 'reload')
    expect(t.run('yes')).toBe('Building configuration...\n[OK]')
    t.runAll('', '')
    expect(t.prompt).toBe('R9>')
  })

  it('reload without startup-config returns to factory defaults', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'conf t', 'hostname R9', 'end', 'reload', 'no', '', '')
    expect(t.prompt).toBe('Router>')
  })

  it('reload skips the save question when nothing changed, and can be cancelled', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'wr', 'reload')
    expect(t.prompt).toBe('Proceed with reload? [confirm]')
    t.run('n')
    expect(t.prompt).toBe('Router#')
  })

  it('reload asks again on an invalid answer', () => {
    const t = TestConsole.of('router')
    t.runAll('en', 'reload')
    expect(t.run('maybe')).toBe("% Please answer 'yes' or 'no'.")
    expect(t.prompt).toBe('System configuration has been modified. Save? [yes/no]: ')
  })
})
