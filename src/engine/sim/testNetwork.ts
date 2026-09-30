import { TestConsole } from '../cli/testing'
import { setHostNet } from '../host/config'
import { runHostCommand } from '../host/terminal'
import type { DeviceKind, IfName, Project } from '../model/types'
import { createProject } from '../project/create'
import { addDevice, connect } from '../project/topology'

/** Small DSL to build a network and talk to its devices. */
export function network() {
  let p: Project = createProject('p', 'net', 0)
  return {
    get project() {
      return p
    },
    set project(value: Project) {
      p = value
    },
    add(kind: DeviceKind) {
      const r = addDevice(p, kind, { x: 0, y: 0 })
      p = r.project
      return r.deviceId
    },
    link(a: string, pa: IfName, b: string, pb: IfName) {
      p = connect(p, { deviceId: a, port: pa }, { deviceId: b, port: pb }).project
    },
    /** Runs configuration lines on an IOS device. */
    config(id: string, ...lines: string[]) {
      const t = new TestConsole(p, id)
      t.runAll('enable', 'configure terminal', ...lines, 'end')
      p = t.project
    },
    /** Runs one privileged EXEC command on an IOS device. */
    exec(id: string, line: string) {
      const t = new TestConsole(p, id)
      t.run('enable')
      const out = t.run(line)
      p = t.project
      return out
    },
    host(id: string, ip: string, mask: string, gateway = '') {
      p = setHostNet(p, id, { ip, mask, gateway })
    },
    /** Runs a command in a PC's command prompt. */
    pc(id: string, line: string) {
      const r = runHostCommand(p, id, line)
      p = r.project
      return r.output.join('\n')
    },
  }
}

