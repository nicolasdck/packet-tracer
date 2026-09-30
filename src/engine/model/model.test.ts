import { describe, expect, it } from 'vitest'
import { CATALOG } from './catalog'
import { ifMedia, shortIfName, splitIfName } from './ifname'
import { deviceMac } from './mac'

describe('catalog', () => {
  it('router 1941 has Gi0/0-0/1 and Se0/0/0-0/0/1', () => {
    expect(CATALOG.router.ports).toEqual([
      'GigabitEthernet0/0',
      'GigabitEthernet0/1',
      'Serial0/0/0',
      'Serial0/0/1',
    ])
  })

  it.each(['switch-l2', 'switch-l3'] as const)('%s has Fa0/1-24 and Gi0/1-2', (kind) => {
    const ports = CATALOG[kind].ports
    expect(ports).toHaveLength(26)
    expect(ports[0]).toBe('FastEthernet0/1')
    expect(ports[23]).toBe('FastEthernet0/24')
    expect(ports.slice(24)).toEqual(['GigabitEthernet0/1', 'GigabitEthernet0/2'])
  })

  it.each(['pc', 'server'] as const)('%s has a single Fa0', (kind) => {
    expect(CATALOG[kind].ports).toEqual(['FastEthernet0'])
  })
})

describe('ifname', () => {
  it('shortens canonical names', () => {
    expect(shortIfName('GigabitEthernet0/0')).toBe('Gi0/0')
    expect(shortIfName('FastEthernet0/24')).toBe('Fa0/24')
    expect(shortIfName('Serial0/0/1')).toBe('Se0/0/1')
    expect(shortIfName('FastEthernet0')).toBe('Fa0')
    expect(shortIfName('Vlan10')).toBe('Vl10')
  })

  it('splits type and number', () => {
    expect(splitIfName('Serial0/0/1').number).toBe('0/0/1')
  })

  it('classifies media', () => {
    expect(ifMedia('GigabitEthernet0/1')).toBe('ethernet')
    expect(ifMedia('FastEthernet0')).toBe('ethernet')
    expect(ifMedia('Serial0/0/0')).toBe('serial')
    expect(ifMedia('Vlan1')).toBe('virtual')
  })

  it('rejects unknown names', () => {
    expect(() => splitIfName('Ethernet0')).toThrow()
  })
})

describe('mac', () => {
  it('formats in IOS dotted notation', () => {
    expect(deviceMac(1, 1)).toBe('00d0.ba00.0101')
    expect(deviceMac(0x1234, 0x1a)).toBe('00d0.ba12.341a')
  })

  it('is unique per (seq, port)', () => {
    expect(deviceMac(1, 2)).not.toBe(deviceMac(2, 1))
  })

  it('rejects out-of-range input', () => {
    expect(() => deviceMac(0x10000, 1)).toThrow(RangeError)
    expect(() => deviceMac(1, 0x100)).toThrow(RangeError)
  })
})
