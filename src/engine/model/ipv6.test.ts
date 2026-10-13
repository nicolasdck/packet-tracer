import { describe, expect, it } from 'vitest'
import {
  eui64Address,
  formatIpv6,
  inPrefix,
  isLinkLocal,
  linkLocalOf,
  parseIpv6,
  parseIpv6Prefix,
  prefixOf,
} from './ipv6'

const ip = (s: string) => parseIpv6(s)!
const roundTrip = (s: string) => formatIpv6(ip(s))

describe('ipv6', () => {
  it('parses full and compressed addresses', () => {
    expect(ip('::')).toBe(0n)
    expect(ip('::1')).toBe(1n)
    expect(ip('2001:db8::1')).toBe(ip('2001:0db8:0000:0000:0000:0000:0000:0001'))
    expect(ip('fe80::')).toBe(0xfe80n << 112n)
    expect(ip('1:2:3:4:5:6:7:8')).not.toBeNull()
  })

  it('rejects malformed addresses', () => {
    for (const bad of ['', '1:2:3', '2001:db8:::1', '2001::db8::1', '12345::', 'g::1', '1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7::8', '192.168.1.1']) {
      expect(parseIpv6(bad), bad).toBeNull()
    }
  })

  it('writes addresses like IOS: upper case, longest zero run compressed', () => {
    expect(roundTrip('2001:0db8:0000:0000:0000:0000:0000:0001')).toBe('2001:DB8::1')
    expect(roundTrip('fe80:0:0:0:2d0:baff:fe00:101')).toBe('FE80::2D0:BAFF:FE00:101')
    expect(roundTrip('::')).toBe('::')
    expect(roundTrip('::1')).toBe('::1')
    expect(roundTrip('2001:db8::')).toBe('2001:DB8::')
    // A single zero group is not compressed; the longest run wins, leftmost when tied.
    expect(roundTrip('2001:db8:0:1:2:3:4:5')).toBe('2001:DB8:0:1:2:3:4:5')
    expect(roundTrip('2001:0:0:1:0:0:0:1')).toBe('2001:0:0:1::1')
    expect(roundTrip('2001:0:0:1:0:0:1:1')).toBe('2001::1:0:0:1:1')
  })

  it('parses prefixes', () => {
    expect(parseIpv6Prefix('2001:db8:1::1/64')).toEqual({ address: ip('2001:db8:1::1'), length: 64 })
    expect(parseIpv6Prefix('::/0')).toEqual({ address: 0n, length: 0 })
    expect(parseIpv6Prefix('2001:db8::1')).toBeNull()
    expect(parseIpv6Prefix('2001:db8::1/129')).toBeNull()
    expect(parseIpv6Prefix('2001:db8::1/x')).toBeNull()
  })

  it('computes prefixes and membership', () => {
    expect(formatIpv6(prefixOf(ip('2001:db8:1:2:3:4:5:6'), 64))).toBe('2001:DB8:1:2::')
    expect(formatIpv6(prefixOf(ip('2001:db8:1:2:3:4:5:6'), 0))).toBe('::')
    expect(inPrefix(ip('2001:db8:1::99'), ip('2001:db8:1::'), 64)).toBe(true)
    expect(inPrefix(ip('2001:db8:2::99'), ip('2001:db8:1::'), 64)).toBe(false)
    expect(isLinkLocal(ip('fe80::1'))).toBe(true)
    expect(isLinkLocal(ip('2001:db8::1'))).toBe(false)
  })

  it('builds EUI-64 and link-local addresses from a MAC', () => {
    // 00d0.ba00.0101 → 02d0:baff:fe00:0101 (FF:FE inserted, U/L bit flipped).
    expect(formatIpv6(linkLocalOf('00d0.ba00.0101'))).toBe('FE80::2D0:BAFF:FE00:101')
    expect(formatIpv6(eui64Address(ip('2001:db8:1::'), '00d0.ba00.0101'))).toBe('2001:DB8:1:0:2D0:BAFF:FE00:101')
  })
})
