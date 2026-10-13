import { describe, expect, it } from 'vitest'
import { TestConsole } from '../cli/testing'
import { createProject } from '../project/create'
import { addDevice } from '../project/topology'
import { network } from '../sim/testNetwork'
import { CATALOG, MODELS, findModel, modelOf } from './catalog'
import type { DeviceKind, IosDevice } from './types'

/** A console on a freshly added device of the given model. */
function consoleOf(kind: DeviceKind, model: string) {
  const { project, deviceId } = addDevice(createProject('p', 't', 0), kind, { x: 0, y: 0 }, model)
  return new TestConsole(project, deviceId)
}

describe('device models', () => {
  it('the first model of each kind stays the default', () => {
    expect(CATALOG.router.id).toBe('1941')
    expect(CATALOG['switch-l2'].id).toBe('2960')
    expect(CATALOG['switch-l3'].id).toBe('3560')
    const { project, deviceId } = addDevice(createProject('p', 't', 0), 'router', { x: 0, y: 0 })
    expect(project.devices[deviceId]!.model).toBe('1941')
  })

  it('unknown or mismatched models fall back to the default of the kind', () => {
    expect(findModel('router', 'nope').id).toBe('1941')
    expect(findModel('router', '2960').id).toBe('1941')
    expect(findModel('switch-l2', '2960-48').id).toBe('2960-48')
  })

  it('every model has unique port names and a console port', () => {
    for (const model of MODELS) {
      expect(new Set(model.ports).size, model.id).toBe(model.ports.length)
      expect(model.consolePort, model.id).toBe(model.kind === 'pc' || model.kind === 'server' ? 'RS232' : 'Console')
    }
  })

  it('router 2911: 3 Gigabit and 4 serial ports', () => {
    const t = consoleOf('router', '2911')
    expect(modelOf(t.device).displayName).toBe('Router 2911')
    expect(Object.keys(t.device.running.interfaces)).toEqual([
      'GigabitEthernet0/0', 'GigabitEthernet0/1', 'GigabitEthernet0/2',
      'Serial0/0/0', 'Serial0/0/1', 'Serial0/1/0', 'Serial0/1/1',
    ])
    t.runAll('en', 'conf t', 'int g0/2', 'ip address 10.0.0.1 255.255.255.0', 'int s0/1/1')
    expect(t.session.ifContext).toEqual(['Serial0/1/1'])
    expect(t.run('do show version')).toContain('C2900 Software')
    expect(t.run('do show version')).toContain('4 Low-speed serial(sync/async) network interface(s)')
  })

  it('router 4331: three-level interface numbers, including subinterfaces', () => {
    const t = consoleOf('router', '4331')
    t.runAll('en', 'conf t', 'int g0/0/1')
    expect(t.session.ifContext).toEqual(['GigabitEthernet0/0/1'])
    t.run('int g0/0/0.10')
    expect(t.prompt).toBe('Router(config-subif)#')
    expect(t.session.ifContext).toEqual(['GigabitEthernet0/0/0.10'])
    expect(t.run('int g0/0/3')).toContain("% Invalid input detected at '^' marker.")
    expect(t.run('do show ip interface brief')).toMatch(/^Serial0\/1\/1\s+unassigned/m)
  })

  it('switch 2960-48: 48 FastEthernet ports, usable in ranges', () => {
    const t = consoleOf('switch-l2', '2960-48')
    t.runAll('en', 'conf t', 'interface range fa0/25 - 48')
    expect(t.session.ifContext).toHaveLength(24)
    t.runAll('switchport mode access', 'switchport access vlan 10', 'end')
    expect(t.run('show vlan brief')).toContain('10   VLAN0010                         active    Fa0/25, Fa0/26, Fa0/27, Fa0/28')
    expect(t.run('show version')).toContain('48 FastEthernet interfaces')
  })

  it('switch 3650: all Gigabit, trunks without the encapsulation command', () => {
    const t = consoleOf('switch-l3', '3650')
    expect(t.device.ports.filter((p) => p.name.startsWith('GigabitEthernet'))).toHaveLength(28)
    t.runAll('en', 'conf t', 'int g1/1/1')
    expect(t.run('switchport mode trunk')).toBe('')
    expect(t.run('switchport trunk encapsulation dot1q')).toContain("% Invalid input detected at '^' marker.")
    t.runAll('int g1/0/5', 'speed 1000', 'exit', 'ip routing')
    expect((t.device as IosDevice).running.ipRouting).toBe(true)
  })

  it('the 3560 still needs the trunk encapsulation', () => {
    const t = consoleOf('switch-l3', '3560')
    t.runAll('en', 'conf t', 'int g0/1')
    expect(t.run('switchport mode trunk')).toContain('Command rejected')
  })

  it('reload restores the ports of the right model', () => {
    const t = consoleOf('router', '2911')
    t.runAll('en', 'reload', 'no', '', '')
    expect(Object.keys(t.device.running.interfaces)).toHaveLength(7)
  })

  it('new models route like the others', () => {
    const n = network()
    const { project, deviceId: r } = addDevice(n.project, 'router', { x: 0, y: 0 }, '4331')
    n.project = project
    const pc = n.add('pc')
    n.link(pc, 'FastEthernet0', r, 'GigabitEthernet0/0/2')
    n.config(r, 'int g0/0/2', 'ip address 192.168.1.1 255.255.255.0', 'no shut')
    n.host(pc, '192.168.1.10', '255.255.255.0', '192.168.1.1')
    expect(n.pc(pc, 'ping 192.168.1.1')).toContain('Received = 4')
  })
})
