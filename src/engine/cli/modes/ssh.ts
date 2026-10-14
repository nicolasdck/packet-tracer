import { CATALOG } from '../../model/catalog'
import type { LineConfig, LocalUser } from '../../model/types'
import { int, line, word } from '../args'
import { arg, kw } from '../dsl'
import type { CmdNode, ExecCtx, Handler } from '../types'

/** Smallest key IOS accepts for SSH version 2. */
export const SSH_V2_MIN_BITS = 768
const DEFAULT_MODULUS = 512

// --- local accounts -------------------------------------------------------------

const setUser = (kind: 'secret' | 'password'): Handler => (ctx, args) => {
  const name = String(args.name)
  // "0 <text>" explicitly means cleartext.
  const value = String(args.pw).trim().replace(/^0\s+/, '')
  const user: LocalUser = { name, privilege: typeof args.priv === 'number' ? args.priv : 1 }
  if (kind === 'secret') user.secret = value
  else user.password = { value, encrypted: ctx.device.running.servicePasswordEncryption }
  const cfg = ctx.device.running
  cfg.users = [...cfg.users.filter((u) => u.name !== name), user]
}

const credentialNodes = (): CmdNode[] => [
  kw('password', 'Specify the password for the user', {
    children: [arg('pw', line(), 'The UNENCRYPTED (cleartext) user password', { run: setUser('password') })],
  }),
  kw('secret', 'Specify the secret for the user', {
    children: [arg('pw', line(), 'The UNENCRYPTED (cleartext) user secret', { run: setUser('secret') })],
  }),
]

/** `username <name> [privilege <0-15>] {secret|password} <text>` */
export const usernameNode = kw('username', 'Establish User Name Authentication', {
  children: [
    arg('name', word(), 'User name', {
      noRun: (ctx, args) => {
        const cfg = ctx.device.running
        cfg.users = cfg.users.filter((u) => u.name !== args.name)
      },
      children: [
        kw('privilege', 'Set user privilege level', {
          children: [arg('priv', int(0, 15), 'User privilege level', { children: credentialNodes() })],
        }),
        ...credentialNodes(),
      ],
    }),
  ],
})

// --- domain name and SSH --------------------------------------------------------

const setDomain: Handler = (ctx, args) => {
  ctx.device.running.domainName = String(args.domain)
}
const clearDomain: Handler = (ctx) => {
  delete ctx.device.running.domainName
}

/** `ip domain-name <name>`, also written `ip domain name <name>`. */
export const ipDomainNodes: CmdNode[] = [
  kw('domain-name', 'Define the default domain name', {
    noRun: clearDomain,
    children: [arg('domain', word(), 'Default domain name', { run: setDomain })],
  }),
  kw('domain', 'IP DNS Resolver', {
    children: [
      kw('name', 'Define the default domain name', {
        noRun: clearDomain,
        children: [arg('domain', word(), 'Default domain name', { run: setDomain })],
      }),
    ],
  }),
]

/** `ip ssh version 1|2` */
export const ipSshNode = kw('ssh', 'Configure ssh options', {
  children: [
    kw('version', 'Specify protocol version supported', {
      noRun: (ctx) => {
        delete ctx.device.running.sshVersion
      },
      children: [
        arg('version', int(1, 2), 'Protocol version', {
          run: (ctx, args) => {
            if (args.version === 1) {
              delete ctx.device.running.sshVersion
              return
            }
            if ((ctx.device.running.rsaKeyBits ?? 0) < SSH_V2_MIN_BITS) {
              return ctx.out(`Please create RSA keys (of atleast ${SSH_V2_MIN_BITS} bits size) to enable SSH v2.`)
            }
            ctx.device.running.sshVersion = 2
          },
        }),
      ],
    }),
  ],
})

/** RSA keys need a hostname other than the factory one and a domain name. Returns the key name. */
function keyName(ctx: ExecCtx): string | null {
  const cfg = ctx.device.running
  const factory = CATALOG[ctx.device.kind].defaultHostname
  if (cfg.hostname === factory) {
    ctx.out(`% Please define a hostname other than ${factory}.`)
    return null
  }
  if (!cfg.domainName) {
    ctx.out('% Please define a domain-name first.')
    return null
  }
  return `${cfg.hostname}.${cfg.domainName}`
}

/** Stores the key pair and prints what IOS prints. */
export function generateKeys(ctx: ExecCtx, bits: number) {
  ctx.device.running.rsaKeyBits = bits
  ctx.out(`% Generating ${bits} bit RSA keys, keys will be non-exportable...[OK]`, '')
  ctx.out(`%SSH-5-ENABLED: SSH ${ctx.device.running.sshVersion === 2 ? '2.0' : '1.99'} has been enabled`)
}

const generate: Handler = (ctx, args) => {
  const name = keyName(ctx)
  if (!name) return
  if (typeof args.bits === 'number') return generateKeys(ctx, args.bits)
  // Without `modulus`, IOS asks for the size.
  ctx.out(
    `The name for the keys will be: ${name}`,
    'Choose the size of the key modulus in the range of 360 to 4096 for your',
    '  General Purpose Keys. Choosing a key modulus greater than 512 may take',
    '  a few minutes.',
    '',
  )
  ctx.session.pending = { kind: 'rsa-modulus' }
}

/** Answer to "How many bits in the modulus [512]:". */
export function answerModulus(ctx: ExecCtx, answer: string) {
  ctx.session.pending = null
  const bits = answer === '' ? DEFAULT_MODULUS : Number(answer)
  if (!/^\d*$/.test(answer) || bits < 360 || bits > 4096) return ctx.out('% Key modulus size must be between 360 and 4096 bits')
  generateKeys(ctx, bits)
}

const modulusNode = kw('modulus', 'Provide number of modulus bits on the command line', {
  children: [arg('bits', int(360, 4096), 'size of the key modulus [360-4096]', { run: generate })],
})

/** `crypto key generate rsa [general-keys] [modulus <bits>]`, `crypto key zeroize rsa` */
export const cryptoNode = kw('crypto', 'Encryption module', {
  children: [
    kw('key', 'Long term key operations', {
      children: [
        kw('generate', 'Generate new keys', {
          children: [
            kw('rsa', 'Generate RSA keys', {
              run: generate,
              children: [kw('general-keys', 'Generate a general purpose RSA key pair', { run: generate, children: [modulusNode] }), modulusNode],
            }),
          ],
        }),
        kw('zeroize', 'Remove keys', {
          children: [
            kw('rsa', 'Remove RSA keys', {
              run: (ctx) => {
                if (!ctx.device.running.rsaKeyBits) return ctx.out('% No Signature RSA Keys found in configuration.')
                delete ctx.device.running.rsaKeyBits
                delete ctx.device.running.sshVersion
                ctx.out('% All RSA keys will be removed.', '%SSH-5-DISABLED: SSH 1.99 has been disabled')
              },
            }),
          ],
        }),
      ],
    }),
  ],
})

// --- line configuration -------------------------------------------------------

function currentLine(ctx: ExecCtx): LineConfig {
  return ctx.device.running.lines[ctx.session.lineContext ?? 'console']
}

/** `transport input all|none|ssh|telnet` (vty lines). */
export const transportNode = kw('transport', 'Define transport protocols for line', {
  when: (c) => c.session.lineContext === 'vty',
  children: [
    kw('input', 'Define which protocols to use when connecting to the terminal server', {
      noRun: (ctx) => {
        delete currentLine(ctx).transportInput
      },
      children: (
        [
          ['all', 'All protocols'],
          ['none', 'No protocols'],
          ['ssh', 'TCP/IP SSH protocol'],
          ['telnet', 'TCP/IP Telnet protocol'],
        ] as const
      ).map(([value, help]) =>
        kw(value, help, {
          run: (ctx) => {
            currentLine(ctx).transportInput = value
          },
        }),
      ),
    }),
  ],
})

/** `login local`: added below the existing `login` command. */
export const loginLocalNode = kw('local', 'Local password checking', {
  run: (ctx) => {
    const l = currentLine(ctx)
    l.loginLocal = true
    l.login = true
  },
})

export function showIpSsh(ctx: ExecCtx): string[] {
  const cfg = ctx.device.running
  const timing = 'Authentication timeout: 120 secs; Authentication retries: 3'
  if (!cfg.rsaKeyBits) {
    return [
      'SSH Disabled - version 1.99',
      `%Please create RSA keys to enable SSH (and of atleast ${SSH_V2_MIN_BITS} bits for SSH v2).`,
      timing,
    ]
  }
  return [`SSH Enabled - version ${cfg.sshVersion === 2 ? '2.0' : '1.99'}`, timing]
}
