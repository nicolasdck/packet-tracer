import { ifMedia, isSubinterface, parentIf, sviVlan } from '../../model/ifname'
import type { IfConfig, IfName, IosConfig, IosDevice, LineConfig, SwitchportConfig } from '../../model/types'
import { formatVlanList } from '../../model/vlans'
import { type5, type7 } from '../crypto'

const IOS_VERSION: Record<IosDevice['kind'], string> = {
  router: '15.1',
  'switch-l2': '15.0',
  'switch-l3': '12.2',
}

const subNumber = (name: IfName) => Number(name.slice(name.indexOf('.') + 1))

/**
 * Interfaces in IOS display order: each physical port followed by its
 * subinterfaces, then SVIs by VLAN number.
 */
export function orderedInterfaces(device: IosDevice, config: IosConfig = device.running): IfName[] {
  const names = Object.keys(config.interfaces)
  const out: IfName[] = []
  for (const port of device.ports.map((p) => p.name)) {
    if (config.interfaces[port]) out.push(port)
    const subs = names.filter((n) => isSubinterface(n) && parentIf(n) === port)
    out.push(...subs.sort((a, b) => subNumber(a) - subNumber(b)))
  }
  const svis = names.filter((n) => sviVlan(n) !== null).sort((a, b) => sviVlan(a)! - sviVlan(b)!)
  return [...out, ...svis, ...names.filter((n) => !out.includes(n) && !svis.includes(n))]
}

function switchportLines(sp: SwitchportConfig): string[] {
  const out: string[] = []
  if (sp.trunkEncapsulation) out.push(` switchport trunk encapsulation ${sp.trunkEncapsulation}`)
  if (sp.accessVlan !== 1) out.push(` switchport access vlan ${sp.accessVlan}`)
  if (sp.nativeVlan !== 1) out.push(` switchport trunk native vlan ${sp.nativeVlan}`)
  if (sp.allowedVlans !== 'all') {
    out.push(` switchport trunk allowed vlan ${sp.allowedVlans.length ? formatVlanList(sp.allowedVlans) : 'none'}`)
  }
  if (sp.mode !== 'dynamic-auto') out.push(` switchport mode ${sp.mode}`)
  return out
}

function interfaceLines(device: IosDevice, name: IfName, cfg: IfConfig): string[] {
  const out = [`interface ${name}`]
  const isRouter = device.kind === 'router'
  const isPort = device.ports.some((p) => p.name === name)
  if (cfg.description !== undefined) out.push(` description ${cfg.description}`)
  if (cfg.encapsulation) {
    out.push(` encapsulation dot1Q ${cfg.encapsulation.vlan}${cfg.encapsulation.native ? ' native' : ''}`)
  }
  if (cfg.switchport) {
    out.push(...switchportLines(cfg.switchport))
  } else {
    // A 3560 port without switchport is a routed port.
    if (device.kind === 'switch-l3' && isPort) out.push(' no switchport')
    out.push(cfg.ip ? ` ip address ${cfg.ip.address} ${cfg.ip.mask}` : ' no ip address')
  }
  if (isPort && ifMedia(name) === 'ethernet') {
    // Routers always print duplex/speed; switches only when not auto.
    if (isRouter || cfg.duplex !== 'auto') out.push(` duplex ${cfg.duplex ?? 'auto'}`)
    if (isRouter || cfg.speed !== 'auto') out.push(` speed ${cfg.speed ?? 'auto'}`)
  }
  if (cfg.clockRate !== undefined) out.push(` clock rate ${cfg.clockRate}`)
  if (cfg.shutdown) out.push(' shutdown')
  out.push('!')
  return out
}

function lineLines(header: string, line: LineConfig): string[] {
  const out = [header]
  if (line.password) {
    out.push(line.password.encrypted ? ` password 7 ${type7(line.password.value)}` : ` password ${line.password.value}`)
  }
  if (line.login) out.push(' login')
  return out
}

/** Configuration text, from the first "!" to "end". */
export function renderConfig(device: IosDevice, config: IosConfig): string[] {
  const isSwitch = device.kind !== 'router'
  const out = [
    '!',
    `version ${IOS_VERSION[device.kind]}`,
    'no service timestamps log datetime msec',
    'no service timestamps debug datetime msec',
    `${config.servicePasswordEncryption ? '' : 'no '}service password-encryption`,
    '!',
    `hostname ${config.hostname}`,
    '!',
  ]
  if (config.enableSecret !== undefined) out.push(`enable secret 5 ${type5(config.enableSecret)}`, '!')
  out.push('!', '!')
  if (device.kind === 'switch-l3' && config.ipRouting) out.push('ip routing', '!')
  if (device.kind === 'router' && !config.ipRouting) out.push('no ip routing', '!')
  if (isSwitch) out.push('spanning-tree mode pvst', 'spanning-tree extend system-id', '!')
  for (const name of orderedInterfaces(device, config)) {
    out.push(...interfaceLines(device, name, config.interfaces[name]!))
  }
  if (!isSwitch) out.push('ip classless', '!', 'ip flow-export version 9', '!')
  out.push('!')
  if (config.bannerMotd) {
    out.push(...`banner motd ^C${config.bannerMotd.text}^C`.split('\n'), '!')
  }
  out.push('!')
  out.push(...lineLines('line con 0', config.lines.console), '!')
  if (!isSwitch) out.push('line aux 0', '!')
  out.push(...lineLines('line vty 0 4', config.lines.vty))
  if (isSwitch) out.push(...lineLines('line vty 5 15', config.lines.vty))
  out.push('!', '!', 'end')
  return out
}

function byteCount(lines: string[]): number {
  return lines.reduce((n, l) => n + l.length + 1, 0)
}

export function showRunningConfig(device: IosDevice): string[] {
  const body = renderConfig(device, device.running)
  return ['Building configuration...', '', `Current configuration : ${byteCount(body)} bytes`, ...body, '']
}

export function showStartupConfig(device: IosDevice): string[] {
  if (!device.startup) return ['startup-config is not present']
  const body = renderConfig(device, device.startup)
  return [`Using ${byteCount(body)} bytes`, ...body, '']
}

/** True if running and startup differ (as `reload` sees it). */
export function isConfigModified(device: IosDevice): boolean {
  if (!device.startup) return true
  return renderConfig(device, device.running).join('\n') !== renderConfig(device, device.startup).join('\n')
}
