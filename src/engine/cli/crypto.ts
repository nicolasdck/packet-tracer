/** Cisco type 7 key (public, reversible "encryption" used by service password-encryption). */
const XLAT = 'dsfd;kfoA,.iyewrkldJKDHSUBsgvca69834ncxv9873254k;fg87'

/** Type 7 encoding with a deterministic seed (IOS picks it at random). */
export function type7(password: string): string {
  let sum = 0
  for (const ch of password) sum += ch.charCodeAt(0)
  const seed = sum % 16
  let out = seed.toString().padStart(2, '0')
  for (let i = 0; i < password.length; i++) {
    const x = password.charCodeAt(i) ^ XLAT.charCodeAt((seed + i) % XLAT.length)
    out += x.toString(16).toUpperCase().padStart(2, '0')
  }
  return out
}

const B64 = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

function fnv1a(text: string, seed: number): number {
  let h = 0x811c9dc5 ^ seed
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

function encode(text: string, length: number, salt: number): string {
  let out = ''
  for (let i = 0; out.length < length; i++) {
    let h = fnv1a(text, salt + i)
    for (let j = 0; j < 5 && out.length < length; j++) {
      out += B64[h % 64]
      h = Math.floor(h / 64)
    }
  }
  return out
}

/**
 * Looks like an MD5-crypt (type 5) hash: "$1$salt$hash". Cosmetic only: the
 * simulator keeps the plain secret to check `enable`, and never needs the real digest.
 */
export function type5(secret: string): string {
  return `$1$${encode(secret, 4, 1000)}$${encode(secret, 22, 2000)}`
}
