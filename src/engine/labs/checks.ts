import { sshLogin } from '../automation/ssh'
import { isConfigModified } from '../cli/render/config'
import { isHostDevice, isIosDevice } from '../model/catalog'
import type { Device, IosDevice, LabCheck, LabInfo, Project } from '../model/types'
import { canPing, getRoute } from '../query'
import { interfaceStatus } from '../sim/linkState'
import { computeOspf } from '../sim/ospf'
import { operMode } from '../sim/switching'

export interface CheckResult {
  ok: boolean
  /** Why it fails, to help the learner. */
  detail?: string
}

const pass: CheckResult = { ok: true }
const fail = (detail: string): CheckResult => ({ ok: false, detail })

function byLabel(project: Project, label: string): Device | undefined {
  return Object.values(project.devices).find((d) => d.label === label)
}

function ios(project: Project, label: string): IosDevice | string {
  const device = byLabel(project, label)
  if (!device) return `${label} is missing from the topology.`
  if (!isIosDevice(device)) return `${label} is not a router or switch.`
  return device
}

/** Evaluates one check. Pure: never modifies the project. */
export function evaluateCheck(project: Project, check: LabCheck): CheckResult {
  switch (check.kind) {
    case 'ping':
    case 'noPing': {
      const from = byLabel(project, check.from)
      if (!from) return fail(`${check.from} is missing from the topology.`)
      const ok = canPing(project, from.id, check.to)
      if (check.kind === 'ping') return ok ? pass : fail(`${check.from} gets no reply from ${check.to}.`)
      return ok ? fail(`${check.from} still reaches ${check.to}.`) : pass
    }
    case 'hostDhcp': {
      const host = byLabel(project, check.device)
      if (!host || !isHostDevice(host)) return fail(`${check.device} is missing from the topology.`)
      if (host.net.mode !== 'dhcp') return fail(`${check.device} is not set to DHCP.`)
      return host.runtime.lease ? pass : fail(`${check.device} did not get an address from a DHCP server.`)
    }
    case 'ssh': {
      const from = byLabel(project, check.from)
      if (!from) return fail(`${check.from} is missing from the topology.`)
      const login = sshLogin(project, from.id, check.to, check.username, check.password)
      return login.ok ? pass : fail(login.message)
    }
    default:
      break
  }

  const device = ios(project, check.device)
  if (typeof device === 'string') return fail(device)
  const cfg = device.running
  switch (check.kind) {
    case 'hostname':
      return cfg.hostname === check.value ? pass : fail(`The hostname is ${cfg.hostname}.`)
    case 'interfaceIp': {
      const ip = cfg.interfaces[check.iface]?.ip
      if (!ip) return fail(`${check.iface} has no IP address.`)
      return ip.address === check.address && ip.mask === check.mask
        ? pass
        : fail(`${check.iface} has ${ip.address} ${ip.mask}.`)
    }
    case 'interfaceUp': {
      const st = interfaceStatus(project, device.id, check.iface)
      return st.protocol === 'up' ? pass : fail(`${check.iface} is ${st.status}/${st.protocol}.`)
    }
    case 'vlan': {
      const vlan = cfg.vlans[check.vlan]
      if (!vlan) return fail(`VLAN ${check.vlan} does not exist on ${check.device}.`)
      return check.name === undefined || vlan.name === check.name ? pass : fail(`VLAN ${check.vlan} is named ${vlan.name}.`)
    }
    case 'accessVlan': {
      const end = { deviceId: device.id, port: check.iface }
      const sp = cfg.interfaces[check.iface]?.switchport
      if (!sp) return fail(`${check.iface} is not a switch port.`)
      if (operMode(project, end) !== 'access') return fail(`${check.iface} is not an access port.`)
      return sp.accessVlan === check.vlan ? pass : fail(`${check.iface} is in VLAN ${sp.accessVlan}.`)
    }
    case 'trunk':
      return operMode(project, { deviceId: device.id, port: check.iface }) === 'trunk'
        ? pass
        : fail(`${check.iface} is not trunking.`)
    case 'route': {
      const route = getRoute(project, device.id, check.to)
      if (!route) return fail(`${check.device} has no route to ${check.to}.`)
      return route.code === check.code ? pass : fail(`${check.device} reaches ${check.to} through a ${route.code} route.`)
    }
    case 'ospfNeighbors': {
      const full = (computeOspf(project).neighbors.get(device.id) ?? []).filter((n) => n.state.startsWith('FULL'))
      return full.length >= check.count ? pass : fail(`${check.device} has ${full.length} OSPF neighbor(s) in FULL state.`)
    }
    case 'enableSecret':
      return cfg.enableSecret !== undefined ? pass : fail('No enable secret is configured.')
    case 'consoleLogin': {
      const con = cfg.lines.console
      return con.login && con.password ? pass : fail('The console line needs a password and login.')
    }
    case 'saved':
      return isConfigModified(device) ? fail('The running-config is not saved to the startup-config.') : pass
  }
}

export interface LabProgress {
  results: Record<string, CheckResult>
  done: number
  total: number
}

export function evaluateLab(project: Project, lab: LabInfo): LabProgress {
  const results: Record<string, CheckResult> = {}
  for (const task of lab.tasks) results[task.id] = evaluateCheck(project, task.check)
  const done = Object.values(results).filter((r) => r.ok).length
  return { results, done, total: lab.tasks.length }
}
