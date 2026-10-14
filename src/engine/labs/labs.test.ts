import { describe, expect, it } from 'vitest'
import { createSession, executeLine } from '../cli/execute'
import type { Project } from '../model/types'
import { dhcpSettle } from '../sim/dhcp'
import { LABS, type LabDefinition } from './catalog'
import { evaluateCheck, evaluateLab } from './checks'
import { LabFileError, exportLab, importLab, startLab } from './start'

/** Types configuration lines on a device of the lab, from privileged EXEC. */
function cli(project: Project, label: string, ...lines: string[]): Project {
  const device = Object.values(project.devices).find((d) => d.label === label)!
  let session = createSession(device.id)
  for (const line of ['enable', 'configure terminal', ...lines, 'end']) {
    const r = executeLine(project, session, line)
    project = r.project
    session = r.session
  }
  return project
}

const lab = (id: string): LabDefinition => LABS.find((l) => l.info.id === id)!

/** A correct solution for every shipped lab. */
const SOLUTIONS: Record<string, (p: Project) => Project> = {
  // Saved in the same session: a new `enable` would now ask for the secret.
  'basic-router': (p) =>
    cli(p, 'R1', 'hostname R1', 'enable secret class', 'line console 0', 'password cisco', 'login', 'exit',
      'int g0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'do write memory'),
  'static-routing': (p) => {
    p = cli(p, 'R1', 'ip route 192.168.2.0 255.255.255.0 10.0.0.2')
    return cli(p, 'R2', 'ip route 0.0.0.0 0.0.0.0 10.0.0.1')
  },
  'vlans-trunk': (p) => {
    for (const s of ['S1', 'S2']) {
      p = cli(p, s, 'vlan 10', 'name SALES', 'vlan 20', 'name ENG', 'exit',
        'int fa0/1', 'switchport mode access', 'switchport access vlan 10',
        'int fa0/2', 'switchport mode access', 'switchport access vlan 20',
        'int g0/1', 'switchport mode trunk')
    }
    return p
  },
  'router-on-a-stick': (p) => {
    p = cli(p, 'S1', 'int g0/1', 'switchport mode trunk')
    return cli(p, 'R1', 'int g0/0', 'no shutdown',
      'int g0/0.10', 'encapsulation dot1Q 10', 'ip address 192.168.10.1 255.255.255.0',
      'int g0/0.20', 'encapsulation dot1Q 20', 'ip address 192.168.20.1 255.255.255.0')
  },
  ospf: (p) => {
    for (const r of ['R1', 'R2', 'R3']) p = cli(p, r, 'router ospf 1', 'network 0.0.0.0 255.255.255.255 area 0')
    return p
  },
  'dhcp-nat': (p) => {
    p = cli(p, 'R1', 'ip dhcp excluded-address 192.168.1.1 192.168.1.9',
      'ip dhcp pool LAN', 'network 192.168.1.0 255.255.255.0', 'default-router 192.168.1.1', 'exit',
      'access-list 1 permit 192.168.1.0 0.0.0.255', 'ip nat inside source list 1 interface g0/1 overload',
      'int g0/0', 'ip nat inside', 'int g0/1', 'ip nat outside')
    // The PCs keep asking for an address, as the app does after each change.
    return dhcpSettle(p)
  },
  ssh: (p) => {
    p = cli(p, 'R1', 'hostname R1', 'ip domain-name lab.local', 'crypto key generate rsa modulus 1024',
      'username admin secret cisco', 'line vty 0 4', 'login local', 'transport input ssh')
    return cli(p, 'R1', 'do write memory')
  },
}

describe('shipped labs', () => {
  it('have unique ids and a solution in these tests', () => {
    const ids = LABS.map((l) => l.info.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(Object.keys(SOLUTIONS).sort()).toEqual([...ids].sort())
  })

  it.each(LABS.map((l) => [l.info.id, l] as const))('%s: starts unsolved and is solved by its solution', (_id, def) => {
    let project = startLab(def, 'p1', 1000)
    expect(project.lab?.id).toBe(def.info.id)
    expect(project.name).toBe(def.info.title)
    const before = evaluateLab(project, project.lab!)
    expect(before.done).toBeLessThan(before.total)

    project = SOLUTIONS[def.info.id]!(project)
    const after = evaluateLab(project, project.lab!)
    const failed = Object.entries(after.results).filter(([, r]) => !r.ok)
    expect(failed).toEqual([])
    expect(after.done).toBe(after.total)
  })
})

describe('lab checks', () => {
  it('explain why a task fails', () => {
    const project = startLab(lab('basic-router'), 'p', 0)
    expect(evaluateCheck(project, { kind: 'hostname', device: 'R1', value: 'R1' })).toEqual({ ok: false, detail: 'The hostname is Router.' })
    expect(evaluateCheck(project, { kind: 'interfaceUp', device: 'R1', iface: 'GigabitEthernet0/0' }).detail).toBe(
      'GigabitEthernet0/0 is administratively down/down.',
    )
    expect(evaluateCheck(project, { kind: 'hostname', device: 'R9', value: 'x' }).detail).toBe('R9 is missing from the topology.')
    expect(evaluateCheck(project, { kind: 'ping', from: 'PC0', to: '192.168.1.1' }).detail).toBe('PC0 gets no reply from 192.168.1.1.')
  })

  it('a noPing task fails while the hosts can talk', () => {
    let project = startLab(lab('vlans-trunk'), 'p', 0)
    // Out of the box everything is in VLAN 1: PC1 reaches PC2.
    expect(evaluateCheck(project, { kind: 'noPing', from: 'PC1', to: '192.168.0.12' }).ok).toBe(false)
    project = SOLUTIONS['vlans-trunk']!(project)
    expect(evaluateCheck(project, { kind: 'noPing', from: 'PC1', to: '192.168.0.12' }).ok).toBe(true)
  })

  it('never modify the project', () => {
    const project = SOLUTIONS['ospf']!(startLab(lab('ospf'), 'p', 0))
    const snapshot = JSON.stringify(project)
    evaluateLab(project, project.lab!)
    expect(JSON.stringify(project)).toBe(snapshot)
  })
})

describe('lab files', () => {
  it('round-trip a lab through a file', () => {
    const project = startLab(lab('static-routing'), 'p', 0)
    const text = JSON.stringify(exportLab(project))
    const imported = importLab(text, 'new-id', 5)
    expect(imported).toMatchObject({ id: 'new-id', name: 'Static routing', createdAt: 5, lab: project.lab })
    expect(imported.devices).toEqual(project.devices)
  })

  it('reject other files', () => {
    expect(() => importLab('nope', 'x', 0)).toThrow(LabFileError)
    expect(() => importLab('{"format":"something"}', 'x', 0)).toThrow('This file is not a Mini Packet Tracer lab.')
    expect(() => exportLab({ ...startLab(lab('ospf'), 'p', 0), lab: undefined })).toThrow('This project is not a lab.')
  })
})
