import { ifMedia, splitIfName } from '../../model/ifname'
import {
  broadcastOf,
  formatIpv4,
  maskHex,
  maskToPrefix,
  networkOf,
  overlaps,
  parseIpv4,
} from '../../model/ipv4'
import type { Duplex, IfConfig, Speed } from '../../model/types'
import { linkAt } from '../../project/topology'
import { exitToConfig, withLinkMessages } from '../actions'
import { int, ipv4, line } from '../args'
import { arg, kw } from '../dsl'
import type { CmdNode, ExecCtx, NodeCtx } from '../types'

/** Accepted `clock rate` values (bit/s), as listed by IOS. */
export const CLOCK_RATES = [
  1200, 2400, 4800, 9600, 19200, 38400, 56000, 64000, 72000, 125000, 128000, 148000, 250000, 500000,
  800000, 1000000, 1300000, 2000000, 4000000, 8000000,
]

const allMedia = (c: NodeCtx, media: string) => c.session.ifContext.every((n) => ifMedia(n) === media)
const isEthernet = (c: NodeCtx) => allMedia(c, 'ethernet')
const isSerial = (c: NodeCtx) => allMedia(c, 'serial')
/** Layer 3 interface (no switchport): accepts an IP address. */
const isRouted = (c: NodeCtx) => c.session.ifContext.every((n) => !c.device.running.interfaces[n]?.switchport)
const hasGigabit = (c: NodeCtx) => c.session.ifContext.every((n) => splitIfName(n).type.full === 'GigabitEthernet')

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
  when: isRouted,
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

const exitNode = kw('exit', 'Exit from interface configuration mode', { run: exitToConfig })

export const interfaceModeNodes: CmdNode[] = [
  clockNode,
  descriptionNode,
  duplexNode,
  ipNode,
  shutdownNode,
  speedNode,
  exitNode,
]

export const interfaceRangeNodes: CmdNode[] = [descriptionNode, duplexNode, shutdownNode, speedNode, exitNode]
