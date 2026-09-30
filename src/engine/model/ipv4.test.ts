import { describe, expect, it } from 'vitest'
import {
  broadcastOf,
  formatIpv4,
  ipv4ValidPrefix,
  maskHex,
  maskToPrefix,
  networkOf,
  overlaps,
  parseIpv4,
  prefixToMask,
} from './ipv4'

const ip = (s: string) => parseIpv4(s)!

describe('ipv4', () => {
  it('parses and formats', () => {
    expect(formatIpv4(ip('192.168.1.254'))).toBe('192.168.1.254')
    expect(ip('255.255.255.255')).toBe(0xffffffff)
    expect(parseIpv4('256.1.1.1')).toBeNull()
    expect(parseIpv4('1.1.1')).toBeNull()
    expect(parseIpv4('1.1.1.a')).toBeNull()
    expect(parseIpv4('1..1.1')).toBeNull()
  })

  it('finds the longest valid prefix for the ^ marker', () => {
    expect(ipv4ValidPrefix('192.168.1.1')).toBe(11)
    expect(ipv4ValidPrefix('192.168.300.1')).toBe(10)
    expect(ipv4ValidPrefix('10.x')).toBe(3)
    expect(ipv4ValidPrefix('1.2.3.4.5')).toBe(7)
  })

  it('converts masks and prefixes', () => {
    expect(maskToPrefix(ip('255.255.255.0'))).toBe(24)
    expect(maskToPrefix(ip('255.255.255.252'))).toBe(30)
    expect(maskToPrefix(ip('0.0.0.0'))).toBe(0)
    expect(maskToPrefix(ip('255.255.255.255'))).toBe(32)
    expect(maskToPrefix(ip('255.0.255.0'))).toBeNull()
    expect(formatIpv4(prefixToMask(20))).toBe('255.255.240.0')
  })

  it('computes network, broadcast and overlap', () => {
    expect(formatIpv4(networkOf(ip('10.1.2.3'), 16))).toBe('10.1.0.0')
    expect(formatIpv4(broadcastOf(ip('10.1.2.3'), 16))).toBe('10.1.255.255')
    expect(overlaps(ip('10.1.0.1'), 16, ip('10.1.5.1'), 24)).toBe(true)
    expect(overlaps(ip('10.1.0.1'), 24, ip('10.1.5.1'), 24)).toBe(false)
  })

  it('formats masks the IOS way', () => {
    expect(maskHex(ip('255.0.255.0'))).toBe('0xFF00FF00')
  })
})
