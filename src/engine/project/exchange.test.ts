import { describe, expect, it } from 'vitest'
import { runHostCommand } from '../host/terminal'
import type { IosDevice, Project } from '../model/types'
import { createProject } from './create'
import { EXPORT_FORMAT, ImportError, buildExport, parseImport, prepareImport } from './exchange'
import { addDevice, connect } from './topology'

function sample(id: string, name: string): Project {
  let p = createProject(id, name, 1)
  const r = addDevice(p, 'router', { x: 0, y: 0 })
  const pc = addDevice(r.project, 'pc', { x: 50, y: 0 })
  p = connect(pc.project, { deviceId: r.deviceId, port: 'GigabitEthernet0/0' }, { deviceId: pc.deviceId, port: 'FastEthernet0' }).project
  return p
}

describe('export / import', () => {
  it('round-trips every project', () => {
    const projects = [sample('a', 'Lab A'), sample('b', 'Lab B')]
    const text = JSON.stringify(buildExport(projects, 123))
    expect(JSON.parse(text)).toMatchObject({ format: EXPORT_FORMAT, version: 1, exportedAt: 123 })
    expect(parseImport(text)).toEqual(projects)
  })

  it('migrates projects from older versions', () => {
    const old = structuredClone(sample('a', 'Old'))
    const r = Object.values(old.devices).find((d) => d.kind === 'router') as IosDevice
    delete (r.running as { ipRouting?: boolean }).ipRouting
    const [imported] = parseImport(JSON.stringify(buildExport([old], 0)))
    expect((imported!.devices[r.id] as IosDevice).running.ipRouting).toBe(true)
  })

  it('rejects files that are not backups', () => {
    expect(() => parseImport('not json')).toThrow('This file is not valid JSON.')
    expect(() => parseImport('{"projects": []}')).toThrow('This file is not a Mini Packet Tracer backup.')
    expect(() => parseImport(JSON.stringify({ format: EXPORT_FORMAT, version: 2, projects: [] }))).toThrow(
      'Unsupported backup version: 2.',
    )
  })

  it('rejects invalid projects with their position', () => {
    const bad = { ...sample('a', 'A'), devices: { d1: { id: 'd1', kind: 'toaster', ports: [], position: {} } } }
    const text = JSON.stringify({ format: EXPORT_FORMAT, version: 1, exportedAt: 0, projects: [sample('b', 'B'), bad] })
    expect(() => parseImport(text)).toThrow(ImportError)
    expect(() => parseImport(text)).toThrow('Project #2 in the file is invalid.')
  })

  it('imports conflicting projects as copies, never overwriting', () => {
    let n = 0
    const newId = () => `new${++n}`
    const incoming = [sample('a', 'Lab A'), sample('b', 'Lab B'), sample('b', 'Lab B again')]
    const prepared = prepareImport(incoming, ['a'], newId)
    expect(prepared.map((p) => [p.id, p.name])).toEqual([
      ['new1', 'Lab A (imported)'],
      ['b', 'Lab B'],
      ['new2', 'Lab B again (imported)'],
    ])
    expect(prepared[0]!.devices).toEqual(incoming[0]!.devices)
  })
})

describe('PC command prompt: cls / clear', () => {
  it('asks the terminal to clear the screen', () => {
    const p = sample('a', 'A')
    const pc = Object.values(p.devices).find((d) => d.kind === 'pc')!
    expect(runHostCommand(p, pc.id, 'cls')).toEqual({ project: p, output: [], clear: true })
    expect(runHostCommand(p, pc.id, 'CLEAR')).toEqual({ project: p, output: [], clear: true })
    expect(runHostCommand(p, pc.id, 'cls now').output).toEqual(['Invalid Command.'])
  })
})
