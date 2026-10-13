import { TestConsole } from '../cli/testing'
import { setHostDhcp, setHostIpv6, setHostNet } from '../host/config'
import { runHostCommand } from '../host/terminal'
import type { DeviceKind, IfName, Project } from '../model/types'
import { createProject } from '../project/create'
import { addDevice, connect } from '../project/topology'
import { dhcpSettle } from './dhcp'

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
    /** IPv6 settings of a host: SLAAC, or a static "address/prefix" and gateway. */
    host6(id: string, mode: 'auto' | 'static', address = '', gateway = '') {
      p = setHostIpv6(p, id, { mode, address, gateway })
    },
    /** Switches a host to DHCP (it asks for an address at once). */
    dhcp(id: string) {
      p = setHostDhcp(p, id)
    },
    /** Lets DHCP clients without a lease retry, as the UI does after each change. */
    settle() {
      p = dhcpSettle(p)
    },
    /** Runs a command in a PC's command prompt. */
    pc(id: string, line: string) {
      const r = runHostCommand(p, id, line)
      p = r.project
      return r.output.join('\n')
    },
  }
}

