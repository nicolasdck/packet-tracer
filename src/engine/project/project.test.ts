import { describe, expect, it } from 'vitest'
import { isHostDevice, isIosDevice } from '../model/catalog'
import type { Device, HostDevice, IosDevice, Project } from '../model/types'
import { cloneProject, createProject } from './create'
import {
  TopologyError,
  addDevice,
  canConnect,
  connect,
  deviceLinks,
  disconnect,
  listPorts,
  moveDevice,
  nextLabel,
  removeDevice,
  renameDevice,
} from './topology'

const ORIGIN = { x: 0, y: 0 }

function empty(): Project {
  return createProject('p1', 'Test', 1000)
}

function ios(device: Device | undefined): IosDevice {
  if (!device || !isIosDevice(device)) throw new Error('not IOS')
  return device
}

function host(device: Device | undefined): HostDevice {
  if (!device || !isHostDevice(device)) throw new Error('not a host')
  return device
}

/** Router0 + Router1 + Switch0 + PC0. */
function lab() {
  let p = empty()
  const r0 = addDevice(p, 'router', ORIGIN)
  const r1 = addDevice(r0.project, 'router', ORIGIN)
  const s0 = addDevice(r1.project, 'switch-l2', ORIGIN)
  const pc = addDevice(s0.project, 'pc', ORIGIN)
  p = pc.project
  return { p, r0: r0.deviceId, r1: r1.deviceId, s0: s0.deviceId, pc: pc.deviceId }
}

describe('createProject', () => {
  it('starts empty with schema version 1', () => {
    const p = empty()
    expect(p).toMatchObject({ schemaVersion: 1, id: 'p1', name: 'Test', seq: 0 })
    expect(p.devices).toEqual({})
    expect(p.links).toEqual({})
  })

  it('survives a JSON round-trip unchanged', () => {
    const { p, r0, s0 } = lab()
    const linked = connect(p, { deviceId: r0, port: 'GigabitEthernet0/0' }, { deviceId: s0, port: 'GigabitEthernet0/1' }).project
    expect(JSON.parse(JSON.stringify(linked))).toEqual(linked)
  })
})

describe('addDevice', () => {
  it('creates a router with IOS defaults: interfaces shut down, no startup-config', () => {
    const { project, deviceId } = addDevice(empty(), 'router', { x: 10, y: 20 })
    const r = ios(project.devices[deviceId])
    expect(r).toMatchObject({ kind: 'router', model: '1941', label: 'Router0', position: { x: 10, y: 20 } })
    expect(r.running.hostname).toBe('Router')
    expect(r.startup).toBeNull()
    expect(Object.values(r.running.interfaces).every((i) => i.shutdown)).toBe(true)
    expect(r.running.interfaces['GigabitEthernet0/0']).toMatchObject({ duplex: 'auto', speed: 'auto' })
    expect(r.running.interfaces['Serial0/0/0']?.duplex).toBeUndefined()
    expect(r.running.interfaces['GigabitEthernet0/0']?.switchport).toBeUndefined()
  })

  it('creates a 2960 with ports up, dynamic auto, VLAN 1', () => {
    const { project, deviceId } = addDevice(empty(), 'switch-l2', ORIGIN)
    const s = ios(project.devices[deviceId])
    expect(s.label).toBe('Switch0')
    expect(s.running.hostname).toBe('Switch')
    expect(s.running.vlans).toEqual({ 1: { name: 'default' } })
    const fa1 = s.running.interfaces['FastEthernet0/1']
    expect(fa1?.shutdown).toBe(false)
    expect(fa1?.switchport).toEqual({ mode: 'dynamic-auto', accessVlan: 1, nativeVlan: 1, allowedVlans: 'all' })
  })

  it('creates a 3560 labelled "Multilayer Switch0"', () => {
    const { project, deviceId } = addDevice(empty(), 'switch-l3', ORIGIN)
    expect(ios(project.devices[deviceId])).toMatchObject({ model: '3560', label: 'Multilayer Switch0' })
  })

  it('creates a PC in static mode with one port', () => {
    const { project, deviceId } = addDevice(empty(), 'pc', ORIGIN)
    const pc = host(project.devices[deviceId])
    expect(pc.label).toBe('PC0')
    expect(pc.net).toEqual({ mode: 'static' })
    expect(pc.ports.map((port) => port.name)).toEqual(['FastEthernet0'])
  })

  it('numbers labels per type and reuses the lowest free index', () => {
    const { p, r0 } = lab()
    expect(p.devices[r0]?.label).toBe('Router0')
    expect(nextLabel(p, 'Router')).toBe('Router2')
    const removed = removeDevice(p, r0)
    expect(nextLabel(removed, 'Router')).toBe('Router0')
  })

  it('assigns unique ids and MAC addresses', () => {
    const { p } = lab()
    const ids = Object.keys(p.devices)
    expect(new Set(ids).size).toBe(ids.length)
    const macs = Object.values(p.devices).flatMap((d) => d.ports.map((port) => port.mac))
    expect(new Set(macs).size).toBe(macs.length)
  })

  it('is deterministic', () => {
    expect(lab().p).toEqual(lab().p)
  })

  it('does not mutate the input project', () => {
    const p = empty()
    addDevice(p, 'router', ORIGIN)
    expect(p.devices).toEqual({})
    expect(p.seq).toBe(0)
  })
})

describe('moveDevice / renameDevice', () => {
  it('moves a device', () => {
    const { p, r0 } = lab()
    expect(moveDevice(p, r0, { x: 5, y: 6 }).devices[r0]?.position).toEqual({ x: 5, y: 6 })
  })

  it('renames the label and trims it, without touching the hostname', () => {
    const { p, r0 } = lab()
    const next = renameDevice(p, r0, '  Edge  ')
    expect(next.devices[r0]?.label).toBe('Edge')
    expect(ios(next.devices[r0]).running.hostname).toBe('Router')
  })

  it('rejects empty or too long names', () => {
    const { p, r0 } = lab()
    expect(() => renameDevice(p, r0, '   ')).toThrow(TopologyError)
    expect(() => renameDevice(p, r0, 'x'.repeat(33))).toThrow(TopologyError)
  })

  it('rejects unknown devices', () => {
    expect(() => moveDevice(empty(), 'nope', ORIGIN)).toThrow(TopologyError)
  })
})

describe('connect', () => {
  it('links two free ethernet ports', () => {
    const { p, r0, s0 } = lab()
    const { project, linkId } = connect(
      p,
      { deviceId: r0, port: 'GigabitEthernet0/0' },
      { deviceId: s0, port: 'FastEthernet0/1' },
    )
    expect(project.links[linkId]).toEqual({
      id: linkId,
      a: { deviceId: r0, port: 'GigabitEthernet0/0' },
      b: { deviceId: s0, port: 'FastEthernet0/1' },
    })
  })

  it('marks end A as DCE on serial links', () => {
    const { p, r0, r1 } = lab()
    const { project, linkId } = connect(p, { deviceId: r0, port: 'Serial0/0/0' }, { deviceId: r1, port: 'Serial0/0/1' })
    expect(project.links[linkId]?.dce).toBe('a')
  })

  it('refuses a port that already carries a link', () => {
    const { p, r0, s0, pc } = lab()
    const first = connect(p, { deviceId: r0, port: 'GigabitEthernet0/0' }, { deviceId: s0, port: 'FastEthernet0/1' }).project
    expect(canConnect(first, { deviceId: pc, port: 'FastEthernet0' }, { deviceId: s0, port: 'FastEthernet0/1' }))
      .toMatch(/already in use/)
    expect(() => connect(first, { deviceId: s0, port: 'FastEthernet0/2' }, { deviceId: r0, port: 'GigabitEthernet0/0' }))
      .toThrow(/already in use/)
  })

  it('refuses serial ↔ ethernet', () => {
    const { p, r0, s0 } = lab()
    expect(() => connect(p, { deviceId: r0, port: 'Serial0/0/0' }, { deviceId: s0, port: 'FastEthernet0/1' }))
      .toThrow(/Incompatible/)
  })

  it('refuses linking a device to itself', () => {
    const { p, s0 } = lab()
    expect(() => connect(p, { deviceId: s0, port: 'FastEthernet0/1' }, { deviceId: s0, port: 'FastEthernet0/2' }))
      .toThrow(/itself/)
  })

  it('refuses unknown ports and devices', () => {
    const { p, r0, s0 } = lab()
    expect(canConnect(p, { deviceId: r0, port: 'GigabitEthernet0/9' }, { deviceId: s0, port: 'FastEthernet0/1' }))
      .toMatch(/Unknown port/)
    expect(canConnect(p, { deviceId: 'x', port: 'FastEthernet0' }, { deviceId: s0, port: 'FastEthernet0/1' }))
      .toBe('Unknown device')
  })
})

describe('listPorts / disconnect / removeDevice', () => {
  function linked() {
    const l = lab()
    const a = connect(l.p, { deviceId: l.r0, port: 'GigabitEthernet0/0' }, { deviceId: l.s0, port: 'GigabitEthernet0/1' })
    const b = connect(a.project, { deviceId: l.pc, port: 'FastEthernet0' }, { deviceId: l.s0, port: 'FastEthernet0/1' })
    return { ...l, p: b.project, l1: a.linkId, l2: b.linkId }
  }

  it('lists ports with their link', () => {
    const { p, s0, l1, l2 } = linked()
    const ports = listPorts(p, s0)
    expect(ports).toHaveLength(26)
    expect(ports[0]).toEqual({ name: 'FastEthernet0/1', linkId: l2 })
    expect(ports[1]).toEqual({ name: 'FastEthernet0/2' })
    expect(ports[25]).toEqual({ name: 'GigabitEthernet0/2' })
    expect(ports[24]).toEqual({ name: 'GigabitEthernet0/1', linkId: l1 })
  })

  it('disconnect frees both ports', () => {
    const { p, r0, s0, l1 } = linked()
    const next = disconnect(p, l1)
    expect(next.links[l1]).toBeUndefined()
    expect(canConnect(next, { deviceId: r0, port: 'GigabitEthernet0/0' }, { deviceId: s0, port: 'GigabitEthernet0/1' })).toBeNull()
    expect(() => disconnect(next, l1)).toThrow(TopologyError)
  })

  it('removeDevice deletes the device and its links only', () => {
    const { p, s0, pc, r0, l1 } = linked()
    expect(deviceLinks(p, s0)).toHaveLength(2)
    const next = removeDevice(p, pc)
    expect(next.devices[pc]).toBeUndefined()
    expect(Object.keys(next.links)).toEqual([l1])
    expect(next.devices[r0]).toBeDefined()
  })
})

describe('cloneProject', () => {
  it('copies the network under a new identity, independently', () => {
    const { p, r0 } = lab()
    const copy = cloneProject(p, 'p2', 'Copy', 2000)
    expect(copy).toMatchObject({ id: 'p2', name: 'Copy', createdAt: 2000, updatedAt: 2000 })
    expect(copy.devices).toEqual(p.devices)
    const moved = moveDevice(copy, r0, { x: 99, y: 99 })
    expect(p.devices[r0]?.position).toEqual(ORIGIN)
    expect(moved.devices[r0]?.position).toEqual({ x: 99, y: 99 })
  })
})
