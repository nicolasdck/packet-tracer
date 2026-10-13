import { describe, expect, it } from 'vitest'
import { interfaceStatus } from '../sim/linkState'
import { network } from '../sim/testNetwork'
import { migrateProject } from './migrate'
import { canConnect, connect, consoleTarget, isConsoleLink, linkAt, listPorts } from './topology'

function lab() {
  const n = network()
  const r = n.add('router')
  const sw = n.add('switch-l2')
  const pc = n.add('pc')
  const pc2 = n.add('pc')
  return { n, r, sw, pc, pc2 }
}

describe('console cable', () => {
  it('every device has a console port', () => {
    const { n, r, sw, pc } = lab()
    const last = (id: string) => listPorts(n.project, id).at(-1)?.name
    expect(last(r)).toBe('Console')
    expect(last(sw)).toBe('Console')
    expect(last(pc)).toBe('RS232')
  })

  it('links a PC RS232 port to a router or switch Console port', () => {
    const { n, r, pc } = lab()
    n.link(pc, 'RS232', r, 'Console')
    const link = linkAt(n.project, { deviceId: pc, port: 'RS232' })!
    expect(isConsoleLink(link)).toBe(true)
    expect(link.dce).toBeUndefined()
    expect(consoleTarget(n.project, pc)).toBe(r)
  })

  it('works in either direction and reports no target without a cable', () => {
    const { n, sw, pc, pc2 } = lab()
    n.link(sw, 'Console', pc, 'RS232')
    expect(consoleTarget(n.project, pc)).toBe(sw)
    expect(consoleTarget(n.project, pc2)).toBeNull()
  })

  it('refuses anything else', () => {
    const { n, r, sw, pc, pc2 } = lab()
    const p = n.project
    expect(canConnect(p, { deviceId: r, port: 'Console' }, { deviceId: sw, port: 'Console' })).toBe(
      'A console cable links an RS232 port to a Console port',
    )
    expect(canConnect(p, { deviceId: pc, port: 'RS232' }, { deviceId: pc2, port: 'RS232' })).toBe(
      'A console cable links an RS232 port to a Console port',
    )
    expect(canConnect(p, { deviceId: pc, port: 'RS232' }, { deviceId: r, port: 'GigabitEthernet0/0' })).toBe('Incompatible ports')
    expect(canConnect(p, { deviceId: pc, port: 'FastEthernet0' }, { deviceId: r, port: 'Console' })).toBe('Incompatible ports')
  })

  it('one cable per console port', () => {
    const { n, r, pc, pc2 } = lab()
    n.link(pc, 'RS232', r, 'Console')
    expect(() => connect(n.project, { deviceId: pc2, port: 'RS232' }, { deviceId: r, port: 'Console' })).toThrow(/already in use/)
  })

  it('carries no network traffic and does not affect interfaces', () => {
    const { n, r, pc } = lab()
    n.link(pc, 'RS232', r, 'Console')
    n.config(r, 'int g0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shut')
    n.host(pc, '192.168.1.10', '255.255.255.0')
    expect(n.pc(pc, 'ping 192.168.1.1')).toContain('Lost = 4 (100% loss)')
    expect(interfaceStatus(n.project, pc, 'FastEthernet0').status).toBe('down')
    // The console port is not an interface: it never shows up in the configuration.
    expect(n.exec(r, 'show ip interface brief')).not.toContain('Console')
    expect(n.exec(r, 'show running-config')).not.toContain('interface Console')
  })

  it('is added to devices saved before console ports existed', () => {
    const { n, r, pc } = lab()
    const old = structuredClone(n.project)
    for (const d of Object.values(old.devices)) d.ports.pop()
    const migrated = migrateProject(old)
    expect(migrated.devices[r]!.ports.at(-1)?.name).toBe('Console')
    expect(migrated.devices[pc]!.ports.at(-1)?.name).toBe('RS232')
    const macs = Object.values(migrated.devices).flatMap((d) => d.ports.map((p) => p.mac))
    expect(new Set(macs).size).toBe(macs.length)
    expect(migrateProject(migrated)).toBe(migrated)
  })
})
