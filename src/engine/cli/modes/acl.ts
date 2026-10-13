import { formatIpv4, parseIpv4 } from '../../model/ipv4'
import type { Acl, AclAddress, AclEntry, AclProtocol } from '../../model/types'
import { exitToConfig } from '../actions'
import { int, ipv4, word } from '../args'
import { arg, kw } from '../dsl'
import { PORT_NAMES } from '../render/acl'
import type { ArgSpec, Args, CmdNode, ExecCtx, Handler } from '../types'

type AclType = Acl['type']

const SEQUENCE_STEP = 10

// --- building an entry from the parsed arguments ---------------------------------

/** "any", "host A", "A W" (or a bare "A" in standard lists) → address and wildcard. */
function addressFrom(args: Args, side: 'src' | 'dst'): AclAddress {
  if (args[side] === 'any') return { address: '0.0.0.0', wildcard: '255.255.255.255' }
  if (typeof args[`${side}Host`] === 'string') return { address: String(args[`${side}Host`]), wildcard: '0.0.0.0' }
  const wildcard = typeof args[`${side}Wild`] === 'string' ? String(args[`${side}Wild`]) : '0.0.0.0'
  // Like IOS, bits covered by the wildcard are cleared in the stored address.
  const address = (parseIpv4(String(args[`${side}Addr`]))! & ~parseIpv4(wildcard)!) >>> 0
  return { address: formatIpv4(address), wildcard }
}

function entryFrom(args: Args, type: AclType, seq: number): AclEntry {
  const entry: AclEntry = { seq, action: args.action as AclEntry['action'], src: addressFrom(args, 'src') }
  if (type === 'standard') return entry
  entry.proto = args.proto as AclProtocol
  entry.dst = addressFrom(args, 'dst')
  if (typeof args.srcPort === 'number') entry.srcPort = args.srcPort
  if (typeof args.dstPort === 'number') entry.dstPort = args.dstPort
  if (typeof args.icmpType === 'string') entry.icmpType = args.icmpType as AclEntry['icmpType']
  return entry
}

/** The list an entry command applies to: `access-list <n> …`, or the named list being edited. */
function targetName(ctx: ExecCtx, args: Args): string {
  return args.acl !== undefined ? String(args.acl) : (ctx.session.aclContext ?? '')
}

const addEntry = (type: AclType): Handler => (ctx, args) => {
  const name = targetName(ctx, args)
  const acl = (ctx.device.running.acls[name] ??= { name, type, entries: [] })
  const last = Math.max(0, ...acl.entries.map((e) => e.seq))
  const seq = typeof args.seq === 'number' ? args.seq : last + SEQUENCE_STEP
  acl.entries = [...acl.entries.filter((e) => e.seq !== seq), entryFrom(args, type, seq)].sort((a, b) => a.seq - b.seq)
}

function deleteAcl(ctx: ExecCtx, name: string) {
  delete ctx.device.running.acls[name]
  for (const key of Object.keys(ctx.device.runtime.aclHits)) {
    if (key.startsWith(`${name}|`)) delete ctx.device.runtime.aclHits[key]
  }
}

// --- command tree ---------------------------------------------------------------

const port = (): ArgSpec => ({
  label: '<0-65535>',
  match: (text) => {
    const named = PORT_NAMES[text.toLowerCase()]
    if (named !== undefined) return { ok: true, value: named }
    if (!/^\d+$/.test(text) || Number(text) > 65535) return { ok: false, offset: 0 }
    return { ok: true, value: Number(text) }
  },
})

/** What may follow an address: more words, and/or the end of the command. */
type Tail = Pick<CmdNode, 'run' | 'children'>

/** `any | host A | A W`; in standard lists a bare `A` also means that host. */
function addressNodes(side: 'src' | 'dst', tail: Tail, bareHost = false): CmdNode[] {
  const wildcard = arg(`${side}Wild`, ipv4(), 'Wildcard bits', tail)
  return [
    kw('any', `Any ${side === 'src' ? 'source' : 'destination'} host`, { name: side, value: 'any', ...tail }),
    kw('host', 'A single host address', { children: [arg(`${side}Host`, ipv4(), 'Host address', tail)] }),
    arg(`${side}Addr`, ipv4(), 'Address to match', {
      run: bareHost ? tail.run : undefined,
      children: [wildcard],
    }),
  ]
}

const eq = (name: 'srcPort' | 'dstPort', tail: Tail) =>
  kw('eq', 'Match only packets on a given port number', { children: [arg(name, port(), 'Port number', tail)] })

function protocolNodes(run: Handler): CmdNode[] {
  const proto = (name: AclProtocol, help: string, children: CmdNode[]) =>
    kw(name, help, { name: 'proto', value: name, children })
  const icmpTypes = (['echo', 'echo-reply'] as const).map((t) =>
    kw(t, t === 'echo' ? 'Echo (ping)' : 'Echo reply', { name: 'icmpType', value: t, run }),
  )
  // TCP/UDP: an optional `eq <port>` after the source and after the destination.
  const withPorts = () => {
    const destination = addressNodes('dst', { run, children: [eq('dstPort', { run })] })
    return addressNodes('src', { children: [eq('srcPort', { children: destination }), ...destination] })
  }
  return [
    proto('icmp', 'Internet Control Message Protocol', addressNodes('src', { children: addressNodes('dst', { run, children: icmpTypes }) })),
    proto('ip', 'Any Internet Protocol', addressNodes('src', { children: addressNodes('dst', { run }) })),
    proto('tcp', 'Transmission Control Protocol', withPorts()),
    proto('udp', 'User Datagram Protocol', withPorts()),
  ]
}

/** `permit …` and `deny …` for a list type. */
function actionNodes(type: AclType): CmdNode[] {
  const run = addEntry(type)
  const children = type === 'standard' ? addressNodes('src', { run }, true) : protocolNodes(run)
  return (['deny', 'permit'] as const).map((action) =>
    kw(action, action === 'permit' ? 'Specify packets to forward' : 'Specify packets to reject', {
      name: 'action',
      value: action,
      children,
    }),
  )
}

const numbered = (min: number, max: number, type: AclType, help: string) =>
  arg('acl', int(min, max), help, {
    noRun: (ctx, args) => deleteAcl(ctx, String(args.acl)),
    children: actionNodes(type),
  })

/** `access-list <number> permit|deny …` */
export const accessListNode = kw('access-list', 'Add an access list entry', {
  children: [
    numbered(1, 99, 'standard', 'IP standard access list'),
    numbered(100, 199, 'extended', 'IP extended access list'),
  ],
})

const named = (type: AclType) =>
  kw(type, `${type === 'standard' ? 'Standard' : 'Extended'} Access List`, {
    children: [
      arg('name', word(), 'Access-list name', {
        run: (ctx, args) => {
          const name = String(args.name)
          const existing = ctx.device.running.acls[name]
          if (existing && existing.type !== type) {
            return ctx.out('% Access-list type conflicts with prior definition')
          }
          ctx.device.running.acls[name] ??= { name, type, entries: [] }
          ctx.session.mode = type === 'standard' ? 'config-std-nacl' : 'config-ext-nacl'
          ctx.session.aclContext = name
        },
        noRun: (ctx, args) => deleteAcl(ctx, String(args.name)),
      }),
    ],
  })

/** `ip access-list standard|extended <name>` */
export const ipAccessListNode = kw('access-list', 'Named access-list', {
  children: [named('extended'), named('standard')],
})

/** Commands of a named list: `[<seq>] permit|deny …`, `no <seq>`. */
function namedModeNodes(type: AclType): CmdNode[] {
  return [
    arg('seq', int(1, 2147483647), 'Sequence Number', {
      noRun: (ctx, args) => {
        const acl = ctx.device.running.acls[ctx.session.aclContext ?? '']
        if (acl) acl.entries = acl.entries.filter((e) => e.seq !== args.seq)
      },
      children: actionNodes(type),
    }),
    ...actionNodes(type),
    kw('exit', 'Exit from access-list configuration mode', { run: exitToConfig }),
  ]
}

export const standardAclModeNodes = namedModeNodes('standard')
export const extendedAclModeNodes = namedModeNodes('extended')
