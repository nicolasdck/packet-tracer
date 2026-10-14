import { createSession, executeLine } from '../cli/execute'
import { setHostDhcp, setHostNet } from '../host/config'
import type { DeviceKind, IfName, Project } from '../model/types'
import { createProject } from '../project/create'
import { addDevice, connect, renameDevice } from '../project/topology'

/**
 * Small builder for lab topologies: devices are named by their canvas label,
 * which the lab checks use to find them.
 */
export class LabTopology {
  project: Project
  private ids = new Map<string, string>()

  constructor() {
    this.project = createProject('lab', 'lab', 0)
  }

  id(label: string): string {
    const id = this.ids.get(label)
    if (!id) throw new Error(`Unknown device in lab: ${label}`)
    return id
  }

  add(kind: DeviceKind, label: string, x: number, y: number, model?: string): this {
    const r = addDevice(this.project, kind, { x, y }, model)
    this.project = renameDevice(r.project, r.deviceId, label)
    this.ids.set(label, r.deviceId)
    return this
  }

  link(a: string, portA: IfName, b: string, portB: IfName): this {
    this.project = connect(this.project, { deviceId: this.id(a), port: portA }, { deviceId: this.id(b), port: portB }).project
    return this
  }

  /** Configuration typed at the console, from privileged EXEC (`enable` and `configure terminal` included). */
  config(label: string, ...lines: string[]): this {
    let session = createSession(this.id(label))
    for (const line of ['enable', 'configure terminal', ...lines, 'end']) {
      const r = executeLine(this.project, session, line)
      this.project = r.project
      session = r.session
    }
    return this
  }

  host(label: string, ip: string, mask: string, gateway = ''): this {
    this.project = setHostNet(this.project, this.id(label), { ip, mask, gateway })
    return this
  }

  dhcp(label: string): this {
    this.project = setHostDhcp(this.project, this.id(label))
    return this
  }
}
