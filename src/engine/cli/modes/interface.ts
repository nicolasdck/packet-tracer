import { ifMedia, isSubinterface, splitIfName } from '../../model/ifname'
import {
  broadcastOf,
  formatIpv4,
  maskHex,
  maskToPrefix,
  networkOf,
  overlaps,
  parseIpv4,
} from '../../model/ipv4'
import type { Duplex, IfConfig, Speed, SwitchportConfig } from '../../model/types'
import { MAX_VLAN, MIN_VLAN, allVlans, parseVlanList } from '../../model/vlans'
import { linkAt } from '../../project/topology'
import { ensureVlan, exitToConfig, withLinkMessages } from '../actions'
import { int, ipv4, line, vlanList } from '../args'
import { arg, kw } from '../dsl'
import type { CmdNode, ExecCtx, NodeCtx } from '../types'

/** Accepted `clock rate` values (bit/s), as listed by IOS. */
export const CLOCK_RATES = [
  1200, 2400, 4800, 9600, 19200, 38400, 56000, 64000, 72000, 125000, 128000, 148000, 250000, 500000,
  800000, 1000000, 1300000, 2000000, 4000000, 8000000,
]

const all = (c: NodeCtx, test: (name: string) => boolean) => c.session.ifContext.every(test)
const isPhysical = (c: NodeCtx) => all(c, (n) => c.device.ports.some((p) => p.name === n))
const isEthernet = (c: NodeCtx) => isPhysical(c) && all(c, (n) => ifMedia(n) === 'ethernet')
const isSerial = (c: NodeCtx) => all(c, (n) => ifMedia(n) === 'serial')
/** Layer 3 interface (no switchport): accepts an IP address. */
const isRouted = (c: NodeCtx) => all(c, (n) => !c.device.running.interfaces[n]?.switchport)
const hasGigabit = (c: NodeCtx) => all(c, (n) => splitIfName(n).type.full === 'GigabitEthernet')
const isSwitchPhysical = (c: NodeCtx) => c.device.kind !== 'router' && isPhysical(c)
/** Layer 2 switch port (not a 3560 routed port). */
const isL2 = (c: NodeCtx) => isSwitchPhysical(c) && all(c, (n) => !!c.device.running.interfaces[n]?.switchport)
const isMultilayer = (c: NodeCtx) => c.device.kind === 'switch-l3'

const DEFAULT_SWITCHPORT: SwitchportConfig = { mode: 'dynamic-auto', accessVlan: 1, nativeVlan: 1, allowedVlans: 'all' }

function eachIf(ctx: ExecCtx, fn: (cfg: IfConfig) => void) {
  for (const name of ctx.session.ifContext) {
    const cfg = ctx.device.running.interfaces[name]
    if (cfg) fn(cfg)
  }
}

function setShutdown(ctx: ExecCtx, shutdown: boolean) {
  withLinkMessages(ctx, ctx.session.ifContext, () => eachIf(ctx, (cfg) => (cfg.shutdown = shutdown)))
}

function setIpAddress(ctx: ExecCtx, address: string, mask: string) {
  const name = ctx.session.ifContext[0]!
  const current = ctx.device.running.interfaces[name]!
  if (current.switchport) return ctx.out('% IP addresses may not be configured on L2 links.')
  if (isSubinterface(name) && !current.encapsulation) {
    return ctx.out(
      '% Configuring IP routing on a LAN subinterface is only allowed if that subinterface is already configured as part of an IEEE 802.10, IEEE 802.1Q, or ISL vLAN.',
    )
  }
  const ip = parseIpv4(address)!
  const m = parseIpv4(mask)!
  const prefix = maskToPrefix(m)
  if (prefix === null) return ctx.out(`Bad mask ${maskHex(m)} for address ${address}`)
  if (prefix < 31 && (ip === networkOf(ip, prefix) || ip === broadcastOf(ip, prefix))) {
    return ctx.out(`Bad mask /${prefix} for address ${address}`)
  }
  for (const [other, cfg] of Object.entries(ctx.device.running.interfaces)) {
    if (other === name || !cfg.ip) continue
    const otherPrefix = maskToPrefix(parseIpv4(cfg.ip.mask)!) ?? 32
    if (overlaps(ip, prefix, parseIpv4(cfg.ip.address)!, otherPrefix)) {
      return ctx.out(`% ${formatIpv4(networkOf(ip, prefix))} overlaps with ${other}`)
    }
  }
  ctx.device.running.interfaces[name]!.ip = { address, mask, method: 'manual' }
}

function setClockRate(ctx: ExecCtx, rate: number) {
  if (!CLOCK_RATES.includes(rate)) return ctx.out('%Error: Invalid clock rate')
  const name = ctx.session.ifContext[0]!
  const link = linkAt(ctx.project, { deviceId: ctx.device.id, port: name })
  if (link) {
    const localEnd = link.a.deviceId === ctx.device.id && link.a.port === name ? 'a' : 'b'
    if (link.dce !== localEnd) return ctx.out('%Error: This command applies only to DCE interfaces')
  }
  ctx.device.running.interfaces[name]!.clockRate = rate
}

const shutdownNode = kw('shutdown', 'Shutdown the selected interface', {
  run: (ctx) => setShutdown(ctx, true),
  noRun: (ctx) => setShutdown(ctx, false),
})

const descriptionNode = kw('description', 'Interface specific description', {
  noRun: (ctx) => eachIf(ctx, (cfg) => delete cfg.description),
  children: [
    arg('text', line(), 'Up to 240 characters describing this interface', {
      run: (ctx, args) => eachIf(ctx, (cfg) => (cfg.description = String(args.text).slice(0, 240))),
    }),
  ],
})

const duplexNode = kw('duplex', 'Configure duplex operation.', {
  when: isEthernet,
  noRun: (ctx) => eachIf(ctx, (cfg) => (cfg.duplex = 'auto')),
  children: (
    [
      ['auto', 'Enable AUTO duplex configuration'],
      ['full', 'Force full duplex operation'],
      ['half', 'Force half-duplex operation'],
    ] as const
  ).map(([value, help]) =>
    kw(value, help, { run: (ctx) => eachIf(ctx, (cfg) => (cfg.duplex = value as Duplex)) }),
  ),
})

const speedNode = kw('speed', 'Configure speed operation.', {
  when: isEthernet,
  noRun: (ctx) => eachIf(ctx, (cfg) => (cfg.speed = 'auto')),
  children: (
    [
      ['10', 'Force 10 Mbps operation', 10],
      ['100', 'Force 100 Mbps operation', 100],
      ['1000', 'Force 1000 Mbps operation', 1000],
      ['auto', 'Enable AUTO speed configuration', 'auto'],
    ] as const
  ).map(([keyword, help, value]) =>
    kw(keyword, help, {
      when: value === 1000 ? hasGigabit : undefined,
      run: (ctx) => eachIf(ctx, (cfg) => (cfg.speed = value as Speed)),
    }),
  ),
})

const ipNode = kw('ip', 'Interface Internet Protocol config commands', {
  // A 3560 switch port offers the command but rejects it (L2 link).
  when: (c) => isRouted(c) || isMultilayer(c),
  children: [
    kw('address', 'Set the IP address of an interface', {
      noRun: (ctx) => eachIf(ctx, (cfg) => delete cfg.ip),
      children: [
        arg('address', ipv4(), 'IP address', {
          noRun: (ctx) => eachIf(ctx, (cfg) => delete cfg.ip),
          children: [
            arg('mask', ipv4(), 'IP subnet mask', {
              run: (ctx, args) => setIpAddress(ctx, String(args.address), String(args.mask)),
              noRun: (ctx) => eachIf(ctx, (cfg) => delete cfg.ip),
            }),
          ],
        }),
      ],
    }),
  ],
})

const clockNode = kw('clock', 'Configure serial interface clock', {
  when: isSerial,
  children: [
    kw('rate', 'Configure serial interface clock speed', {
      noRun: (ctx) => eachIf(ctx, (cfg) => delete cfg.clockRate),
      children: [
        arg('rate', int(300, 8000000), 'Choose clockrate from list above', {
          run: (ctx, args) => setClockRate(ctx, args.rate as number),
        }),
      ],
    }),
  ],
})

// --- switchport ---------------------------------------------------------------

function eachSwitchport(ctx: ExecCtx, fn: (sp: SwitchportConfig) => void) {
  eachIf(ctx, (cfg) => cfg.switchport && fn(cfg.switchport))
}

function setMode(ctx: ExecCtx, mode: 'access' | 'trunk') {
  if (mode === 'trunk' && ctx.device.kind === 'switch-l3') {
    const auto = ctx.session.ifContext.some((n) => !ctx.device.running.interfaces[n]?.switchport?.trunkEncapsulation)
    if (auto) {
      ctx.out('Command rejected: An interface whose trunk encapsulation is "Auto" can not be configured to "trunk" mode.')
      return
    }
  }
  eachSwitchport(ctx, (sp) => (sp.mode = mode))
}

function setAccessVlan(ctx: ExecCtx, vlan: number) {
  if (ensureVlan(ctx, vlan)) ctx.out('% Access VLAN does not exist. Creating vlan ' + vlan)
  eachSwitchport(ctx, (sp) => (sp.accessVlan = vlan))
}

function changeAllowed(ctx: ExecCtx, op: 'set' | 'add' | 'remove', list: number[]) {
  eachSwitchport(ctx, (sp) => {
    const current = sp.allowedVlans === 'all' ? allVlans() : sp.allowedVlans
    const next =
      op === 'set' ? list : op === 'add' ? [...new Set([...current, ...list])] : current.filter((v) => !list.includes(v))
    sp.allowedVlans = next.length === allVlans().length ? 'all' : next.sort((a, b) => a - b)
  })
}

const vlanListArg = (op: 'set' | 'add' | 'remove', help: string) =>
  arg('list', vlanList(), help, {
    run: (ctx, args) => changeAllowed(ctx, op, parseVlanList(String(args.list))!),
  })

const switchportNode = kw('switchport', 'Set switching mode characteristics', {
  when: isSwitchPhysical,
  // Bare `switchport` / `no switchport`: layer 2 or routed port (3560 only).
  run: (ctx) => {
    if (ctx.device.kind !== 'switch-l3') return ctx.out('% Incomplete command.')
    eachIf(ctx, (cfg) => {
      if (cfg.switchport) return
      cfg.switchport = { ...DEFAULT_SWITCHPORT }
      delete cfg.ip
    })
  },
  noRun: (ctx) => {
    if (ctx.device.kind !== 'switch-l3') return ctx.out('% Incomplete command.')
    eachIf(ctx, (cfg) => delete cfg.switchport)
  },
  children: [
    kw('mode', 'Set trunking mode of the interface', {
      when: isL2,
      noRun: (ctx) => eachSwitchport(ctx, (sp) => (sp.mode = 'dynamic-auto')),
      children: [
        kw('access', 'Set trunking mode to ACCESS unconditionally', { run: (ctx) => setMode(ctx, 'access') }),
        kw('trunk', 'Set trunking mode to TRUNK unconditionally', { run: (ctx) => setMode(ctx, 'trunk') }),
      ],
    }),
    kw('access', 'Set access mode characteristics of the interface', {
      when: isL2,
      children: [
        kw('vlan', 'Set VLAN when interface is in access mode', {
          noRun: (ctx) => eachSwitchport(ctx, (sp) => (sp.accessVlan = 1)),
          children: [
            arg('vlan', int(MIN_VLAN, MAX_VLAN), 'VLAN ID of the VLAN when this port is in access mode', {
              run: (ctx, args) => setAccessVlan(ctx, args.vlan as number),
            }),
          ],
        }),
      ],
    }),
    kw('trunk', 'Set trunking characteristics of the interface', {
      when: isL2,
      children: [
        kw('allowed', 'Set allowed VLAN characteristics when interface is in trunking mode', {
          children: [
            kw('vlan', 'Set allowed VLANs when interface is in trunking mode', {
              noRun: (ctx) => eachSwitchport(ctx, (sp) => (sp.allowedVlans = 'all')),
              children: [
                vlanListArg('set', 'VLAN IDs of the allowed VLANs when this port is in trunking mode'),
                kw('add', 'add VLANs to the current list', { children: [vlanListArg('add', 'VLAN IDs to add')] }),
                kw('remove', 'remove VLANs from the current list', {
                  children: [vlanListArg('remove', 'VLAN IDs to remove')],
                }),
                kw('all', 'all VLANs', { run: (ctx) => eachSwitchport(ctx, (sp) => (sp.allowedVlans = 'all')) }),
                kw('none', 'no VLANs', { run: (ctx) => eachSwitchport(ctx, (sp) => (sp.allowedVlans = [])) }),
              ],
            }),
          ],
        }),
        kw('native', 'Set trunking native characteristics when interface is in trunking mode', {
          children: [
            kw('vlan', 'Set native VLAN when interface is in trunking mode', {
              noRun: (ctx) => eachSwitchport(ctx, (sp) => (sp.nativeVlan = 1)),
              children: [
                arg('vlan', int(MIN_VLAN, MAX_VLAN), 'VLAN ID of the native VLAN when this port is in trunking mode', {
                  run: (ctx, args) => eachSwitchport(ctx, (sp) => (sp.nativeVlan = args.vlan as number)),
                }),
              ],
            }),
          ],
        }),
        kw('encapsulation', 'Set trunking encapsulation when interface is in trunking mode', {
          when: isMultilayer,
          noRun: (ctx) => eachSwitchport(ctx, (sp) => delete sp.trunkEncapsulation),
          children: [
            kw('dot1q', 'Interface uses only 802.1q trunking encapsulation when trunking', {
              run: (ctx) => eachSwitchport(ctx, (sp) => (sp.trunkEncapsulation = 'dot1q')),
            }),
          ],
        }),
      ],
    }),
  ],
})

// --- subinterfaces --------------------------------------------------------------

const encapsulationNode = kw('encapsulation', 'Set encapsulation type for an interface', {
  children: [
    kw('dot1Q', 'IEEE 802.1Q Virtual LAN', {
      children: [
        arg('vlan', int(MIN_VLAN, MAX_VLAN), 'IEEE 802.1Q VLAN ID required', {
          run: (ctx, args) => eachIf(ctx, (cfg) => (cfg.encapsulation = { vlan: args.vlan as number, native: false })),
          children: [
            kw('native', 'Make this as native VLAN', {
              run: (ctx, args) => eachIf(ctx, (cfg) => (cfg.encapsulation = { vlan: args.vlan as number, native: true })),
            }),
          ],
        }),
      ],
    }),
  ],
})

const exitNode = kw('exit', 'Exit from interface configuration mode', { run: exitToConfig })

export const interfaceModeNodes: CmdNode[] = [
  clockNode,
  descriptionNode,
  duplexNode,
  ipNode,
  shutdownNode,
  speedNode,
  switchportNode,
  exitNode,
]

export const interfaceRangeNodes: CmdNode[] = [
  descriptionNode,
  duplexNode,
  shutdownNode,
  speedNode,
  switchportNode,
  exitNode,
]

export const subinterfaceModeNodes: CmdNode[] = [descriptionNode, encapsulationNode, ipNode, shutdownNode, exitNode]
