import { describe, expect, it } from 'vitest'
import { TestConsole } from '../cli/testing'
import { setHostNet, validateHostNet } from '../host/config'
import { disconnect, linkAt } from '../project/topology'
import { canPing, getRoute } from '../query'
import { interfaceStatus } from './linkState'
import { network } from './testNetwork'

/** PC0 — Switch0 — PC1, same subnet. */
function flat() {
  const n = network()
  const pc0 = n.add('pc')
  const pc1 = n.add('pc')
  const sw = n.add('switch-l2')
  n.link(pc0, 'FastEthernet0', sw, 'FastEthernet0/1')
  n.link(pc1, 'FastEthernet0', sw, 'FastEthernet0/2')
  n.host(pc0, '192.168.1.10', '255.255.255.0')
  n.host(pc1, '192.168.1.11', '255.255.255.0')
  return { n, pc0, pc1, sw }
}

/**
 * PC0 (192.168.1.10) — Switch0 — Router0 Gi0/0 (192.168.1.1)
 * Router0 Gi0/1 (192.168.2.1) — PC1 (192.168.2.10)
 */
function routed() {
  const n = network()
  const pc0 = n.add('pc')
  const pc1 = n.add('pc')
  const sw = n.add('switch-l2')
  const r0 = n.add('router')
  n.link(pc0, 'FastEthernet0', sw, 'FastEthernet0/1')
  n.link(sw, 'GigabitEthernet0/1', r0, 'GigabitEthernet0/0')
  n.link(r0, 'GigabitEthernet0/1', pc1, 'FastEthernet0')
  n.config(
    r0,
    'int g0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown',
    'int g0/1', 'ip address 192.168.2.1 255.255.255.0', 'no shutdown',
  )
  n.host(pc0, '192.168.1.10', '255.255.255.0', '192.168.1.1')
  n.host(pc1, '192.168.2.10', '255.255.255.0', '192.168.2.1')
  return { n, pc0, pc1, sw, r0 }
}

const replies = (out: string) => out.split('\n').filter((l) => l.startsWith('Reply from'))
const timeouts = (out: string) => out.split('\n').filter((l) => l === 'Request timed out.')

describe('link state', () => {
  it('a PC ↔ switch link is up on both ends', () => {
    const { n, pc0, sw } = flat()
    expect(interfaceStatus(n.project, pc0, 'FastEthernet0')).toEqual({ status: 'up', protocol: 'up' })
    expect(interfaceStatus(n.project, sw, 'FastEthernet0/1')).toEqual({ status: 'up', protocol: 'up' })
    expect(interfaceStatus(n.project, sw, 'FastEthernet0/3')).toEqual({ status: 'down', protocol: 'down' })
  })

  it('a router interface is administratively down until no shutdown', () => {
    const n = network()
    const r = n.add('router')
    const sw = n.add('switch-l2')
    n.link(r, 'GigabitEthernet0/0', sw, 'FastEthernet0/1')
    expect(interfaceStatus(n.project, r, 'GigabitEthernet0/0').status).toBe('administratively down')
    expect(interfaceStatus(n.project, sw, 'FastEthernet0/1').status).toBe('down')
    n.config(r, 'int g0/0', 'no shut')
    expect(interfaceStatus(n.project, sw, 'FastEthernet0/1').status).toBe('up')
  })
})

describe('ping on a flat network', () => {
  it('PC to PC through a switch: 4 replies, TTL 128', () => {
    const { n, pc0 } = flat()
    const out = n.pc(pc0, 'ping 192.168.1.11')
    expect(out).toContain('Pinging 192.168.1.11 with 32 bytes of data:')
    expect(replies(out)).toEqual(Array(4).fill('Reply from 192.168.1.11: bytes=32 time<1ms TTL=128'))
    expect(out).toContain('Packets: Sent = 4, Received = 4, Lost = 0 (0% loss),')
    expect(out).toContain('Minimum = 0ms, Maximum = 0ms, Average = 0ms')
  })

  it('fills the ARP caches of both hosts', () => {
    const { n, pc0, pc1 } = flat()
    n.pc(pc0, 'ping 192.168.1.11')
    const mac1 = n.project.devices[pc1]!.ports[0]!.mac
    const mac0 = n.project.devices[pc0]!.ports[0]!.mac
    expect(n.project.devices[pc0]!.runtime.arp).toEqual([{ ip: '192.168.1.11', mac: mac1, iface: 'FastEthernet0' }])
    expect(n.project.devices[pc1]!.runtime.arp).toEqual([{ ip: '192.168.1.10', mac: mac0, iface: 'FastEthernet0' }])
  })

  it('times out when the target has no address', () => {
    const { n, pc0, pc1 } = flat()
    n.host(pc1, '', '')
    const out = n.pc(pc0, 'ping 192.168.1.11')
    expect(timeouts(out)).toHaveLength(4)
    expect(out).toContain('Received = 0, Lost = 4 (100% loss)')
    expect(out).not.toContain('Approximate round trip times')
  })

  it('times out when the link is removed', () => {
    const { n, pc0, pc1 } = flat()
    const link = linkAt(n.project, { deviceId: pc1, port: 'FastEthernet0' })!
    n.project = disconnect(n.project, link.id)
    expect(timeouts(n.pc(pc0, 'ping 192.168.1.11'))).toHaveLength(4)
  })

  it('times out when the switch port is shut down', () => {
    const { n, pc0, sw } = flat()
    n.config(sw, 'int fa0/2', 'shutdown')
    expect(timeouts(n.pc(pc0, 'ping 192.168.1.11'))).toHaveLength(4)
  })

  it('cannot reach another subnet without a gateway', () => {
    const { n, pc0, pc1 } = flat()
    n.host(pc1, '192.168.2.11', '255.255.255.0')
    expect(timeouts(n.pc(pc0, 'ping 192.168.2.11'))).toHaveLength(4)
  })

  it('survives a switching loop', () => {
    const { n, pc0, sw } = flat()
    const sw2 = n.add('switch-l2')
    n.link(sw, 'GigabitEthernet0/1', sw2, 'GigabitEthernet0/1')
    n.link(sw, 'GigabitEthernet0/2', sw2, 'GigabitEthernet0/2')
    const pc2 = n.add('pc')
    n.link(pc2, 'FastEthernet0', sw2, 'FastEthernet0/1')
    n.host(pc2, '192.168.1.12', '255.255.255.0')
    expect(replies(n.pc(pc0, 'ping 192.168.1.12'))).toHaveLength(4)
  })
})

describe('ping through a router (connected networks)', () => {
  it('first ping loses one packet to the router ARP, then all succeed', () => {
    const { n, pc0 } = routed()
    const first = n.pc(pc0, 'ping 192.168.2.10')
    expect(first.split('\n').slice(3, 7)).toEqual([
      'Request timed out.',
      'Reply from 192.168.2.10: bytes=32 time<1ms TTL=127',
      'Reply from 192.168.2.10: bytes=32 time<1ms TTL=127',
      'Reply from 192.168.2.10: bytes=32 time<1ms TTL=127',
    ])
    expect(first).toContain('Sent = 4, Received = 3, Lost = 1 (25% loss)')
    expect(replies(n.pc(pc0, 'ping 192.168.2.10'))).toHaveLength(4)
  })

  it('PC reaches its gateway without loss', () => {
    const { n, pc0 } = routed()
    expect(replies(n.pc(pc0, 'ping 192.168.1.1'))).toEqual(
      Array(4).fill('Reply from 192.168.1.1: bytes=32 time<1ms TTL=255'),
    )
  })

  it('router ping: .!!!! then !!!!!', () => {
    const { n, r0 } = routed()
    expect(n.exec(r0, 'ping 192.168.1.10')).toBe(
      [
        'Type escape sequence to abort.',
        'Sending 5, 100-byte ICMP Echos to 192.168.1.10, timeout is 2 seconds:',
        '.!!!!',
        'Success rate is 80 percent (4/5), round-trip min/avg/max = 0/0/0 ms',
        '',
      ].join('\n'),
    )
    expect(n.exec(r0, 'ping 192.168.1.10')).toContain('!!!!!\nSuccess rate is 100 percent (5/5)')
  })

  it('router pings its own interface', () => {
    const { n, r0 } = routed()
    expect(n.exec(r0, 'ping 192.168.2.1')).toContain('!!!!!')
  })

  it('router without a route: all dots and 0 percent', () => {
    const { n, r0 } = routed()
    const out = n.exec(r0, 'ping 10.9.9.9')
    expect(out).toContain('\n.....\nSuccess rate is 0 percent (0/5)')
  })

  it('router answers Destination host unreachable for unknown networks', () => {
    const { n, pc0 } = routed()
    const out = n.pc(pc0, 'ping 10.9.9.9')
    expect(replies(out)).toEqual(Array(4).fill('Reply from 192.168.1.1: Destination host unreachable.'))
    expect(out).toContain('Sent = 4, Received = 4, Lost = 0 (0% loss)')
    expect(out).not.toContain('Approximate round trip times')
  })

  it('router answers unreachable once its interface to the destination is shut down', () => {
    const { n, pc0, r0 } = routed()
    n.config(r0, 'int g0/1', 'shutdown')
    // The connected route disappears with the interface.
    expect(replies(n.pc(pc0, 'ping 192.168.2.10'))).toEqual(
      Array(4).fill('Reply from 192.168.1.1: Destination host unreachable.'),
    )
  })

  it('fails when the gateway interface is shut down', () => {
    const { n, pc0, r0 } = routed()
    n.config(r0, 'int g0/0', 'shutdown')
    expect(timeouts(n.pc(pc0, 'ping 192.168.2.10'))).toHaveLength(4)
  })

  it('fails when the PC has no default gateway', () => {
    const { n, pc0 } = routed()
    n.host(pc0, '192.168.1.10', '255.255.255.0')
    expect(timeouts(n.pc(pc0, 'ping 192.168.2.10'))).toHaveLength(4)
    expect(replies(n.pc(pc0, 'ping 192.168.1.1'))).toHaveLength(4)
  })

  it('fails when the gateway is wrong', () => {
    const { n, pc0 } = routed()
    n.host(pc0, '192.168.1.10', '255.255.255.0', '192.168.1.254')
    expect(timeouts(n.pc(pc0, 'ping 192.168.2.10'))).toHaveLength(4)
  })

  it('learns ARP entries on the router', () => {
    const { n, pc0, r0 } = routed()
    n.pc(pc0, 'ping 192.168.2.10')
    const arp = n.project.devices[r0]!.runtime.arp.map((e) => `${e.ip} ${e.iface}`)
    expect(arp).toEqual(['192.168.1.10 GigabitEthernet0/0', '192.168.2.10 GigabitEthernet0/1'])
  })

  it('does not trust a stale ARP entry when an address moves', () => {
    const { n, pc0, pc1, r0 } = routed()
    n.pc(pc0, 'ping 192.168.2.10')
    const pc2 = n.add('pc')
    n.project = disconnect(n.project, linkAt(n.project, { deviceId: pc1, port: 'FastEthernet0' })!.id)
    n.link(r0, 'GigabitEthernet0/1', pc2, 'FastEthernet0')
    n.host(pc2, '192.168.2.10', '255.255.255.0', '192.168.2.1')
    const out = n.pc(pc0, 'ping 192.168.2.10')
    expect(timeouts(out)).toHaveLength(1)
    expect(replies(out)).toHaveLength(3)
  })
})

describe('serial links', () => {
  function serial() {
    const n = network()
    const r0 = n.add('router')
    const r1 = n.add('router')
    n.link(r0, 'Serial0/0/0', r1, 'Serial0/0/0')
    n.config(r0, 'int s0/0/0', 'ip address 10.0.0.1 255.255.255.252', 'clock rate 64000', 'no shut')
    n.config(r1, 'int s0/0/0', 'ip address 10.0.0.2 255.255.255.252', 'no shut')
    return { n, r0, r1 }
  }

  it('needs no ARP: first ping is !!!!!', () => {
    const { n, r0 } = serial()
    expect(n.exec(r0, 'ping 10.0.0.2')).toContain('!!!!!')
  })

  it('fails when the far end is shut down', () => {
    const { n, r0, r1 } = serial()
    n.config(r1, 'int s0/0/0', 'shutdown')
    expect(n.exec(r0, 'ping 10.0.0.2')).toContain('Success rate is 0 percent')
  })
})

describe('traceroute', () => {
  it('tracert from a PC lists the router then the destination', () => {
    const { n, pc0 } = routed()
    n.pc(pc0, 'ping 192.168.2.10')
    const out = n.pc(pc0, 'tracert 192.168.2.10')
    expect(out).toBe(
      [
        '',
        'Tracing route to 192.168.2.10 over a maximum of 30 hops: ',
        '',
        '  1   0 ms      0 ms      0 ms      192.168.1.1',
        '  2   0 ms      0 ms      0 ms      192.168.2.10',
        '',
        'Trace complete.',
        '',
      ].join('\n'),
    )
  })

  it('IOS traceroute to a directly connected host', () => {
    const { n, r0, pc1 } = routed()
    n.pc(pc1, 'ping 192.168.2.1')
    expect(n.exec(r0, 'traceroute 192.168.2.10')).toBe(
      [
        'Type escape sequence to abort.',
        'Tracing the route to 192.168.2.10',
        '',
        '  1 192.168.2.10 0 msec 0 msec 0 msec',
        '',
      ].join('\n'),
    )
  })

  it('stops at a router that reports the destination unreachable', () => {
    const { n, pc0 } = routed()
    const out = n.pc(pc0, 'tracert 10.9.9.9')
    // TTL is checked before the routing table: hop 1 is a time exceeded, hop 2 the unreachable.
    expect(out).toContain('  1   0 ms      0 ms      0 ms      192.168.1.1\n')
    expect(out).toContain('  2   0 ms      0 ms      0 ms      192.168.1.1 reports: Destination host unreachable.')
    expect(out).toContain('Trace complete.')
  })

  it('shows * for hops that do not answer, up to 30 hops', () => {
    const { n, pc0 } = flat()
    const out = n.pc(pc0, 'tracert 192.168.1.99')
    const hopLines = out.split('\n').filter((l) => /^\s+\d+ {3}/.test(l))
    expect(hopLines).toHaveLength(30)
    expect(hopLines[0]).toBe('  1   *         *         *         Request timed out.')
  })
})

describe('IOS ping command', () => {
  it('accepts a hostname and fails to resolve it', () => {
    const { n, r0 } = routed()
    expect(n.exec(r0, 'ping server')).toBe(
      'Translating "server"...domain server (255.255.255.255)\n% Unrecognized host or address, or protocol not running.\n',
    )
  })

  it('is available in user EXEC', () => {
    const { n, r0 } = routed()
    const t = new TestConsole(n.project, r0)
    expect(t.run('ping 192.168.2.1')).toContain('!!!!!')
  })
})

describe('PC command prompt', () => {
  it('ipconfig shows the static configuration', () => {
    const { n, pc0 } = routed()
    const out = n.pc(pc0, 'ipconfig')
    expect(out).toContain('   IPv4 Address....................: 192.168.1.10')
    expect(out).toContain('   Subnet Mask.....................: 255.255.255.0')
    expect(out).toContain('   Default Gateway.................: 192.168.1.1')
  })

  it('ipconfig shows 0.0.0.0 when not configured', () => {
    const n = network()
    const pc = n.add('pc')
    expect(n.pc(pc, 'ipconfig')).toContain('IPv4 Address....................: 0.0.0.0')
  })

  it('rejects unknown commands and bad targets', () => {
    const { n, pc0 } = flat()
    expect(n.pc(pc0, 'dir')).toBe('Invalid Command.')
    expect(n.pc(pc0, 'ping')).toBe('Invalid Command.')
    expect(n.pc(pc0, 'ping server')).toBe('Ping request could not find host server. Please check the name and try again.')
    expect(n.pc(pc0, 'tracert server')).toBe('Unable to resolve target system name server.')
    expect(n.pc(pc0, '')).toBe('')
  })

  it('commands are case-insensitive', () => {
    const { n, pc0 } = flat()
    expect(replies(n.pc(pc0, 'PING 192.168.1.11'))).toHaveLength(4)
  })
})

describe('host IP configuration', () => {
  it('validates addresses, masks and gateway', () => {
    expect(validateHostNet({ ip: '192.168.1.10', mask: '255.255.255.0', gateway: '192.168.1.1' })).toEqual({})
    expect(validateHostNet({ ip: '', mask: '', gateway: '' })).toEqual({})
    expect(validateHostNet({ ip: '192.168.1.300', mask: '255.255.255.0', gateway: '' }).ip).toBe('Invalid IPv4 address')
    expect(validateHostNet({ ip: '192.168.1.10', mask: '', gateway: '' }).mask).toBe('Subnet mask is required')
    expect(validateHostNet({ ip: '192.168.1.10', mask: '255.0.255.0', gateway: '' }).mask).toBe('Invalid subnet mask')
    expect(validateHostNet({ ip: '192.168.1.0', mask: '255.255.255.0', gateway: '' }).ip).toBe('This is the network address')
    expect(validateHostNet({ ip: '192.168.1.255', mask: '255.255.255.0', gateway: '' }).ip).toBe('This is the broadcast address')
    expect(validateHostNet({ ip: '192.168.1.10', mask: '255.255.255.0', gateway: 'x' }).gateway).toBe('Invalid IPv4 address')
  })

  it('refuses to apply an invalid configuration', () => {
    const { n, pc0 } = flat()
    expect(() => setHostNet(n.project, pc0, { ip: 'bad', mask: '', gateway: '' })).toThrow('Invalid IPv4 address')
  })

  it('clears the ARP cache when the configuration changes', () => {
    const { n, pc0 } = flat()
    n.pc(pc0, 'ping 192.168.1.11')
    n.host(pc0, '192.168.1.20', '255.255.255.0')
    expect(n.project.devices[pc0]!.runtime.arp).toEqual([])
  })
})

describe('queries for labs', () => {
  it('canPing answers without modifying the project', () => {
    const { n, pc0 } = routed()
    const before = n.project
    expect(canPing(before, pc0, '192.168.2.10')).toBe(true)
    expect(canPing(before, pc0, '10.9.9.9')).toBe(false)
    expect(canPing(before, pc0, 'nonsense')).toBe(false)
    expect(before.devices[pc0]!.runtime.arp).toEqual([])
  })

  it('getRoute returns the connected route used for an address', () => {
    const { n, r0 } = routed()
    expect(getRoute(n.project, r0, '192.168.2.77')).toMatchObject({ code: 'C', prefix: 24, iface: 'GigabitEthernet0/1' })
    expect(getRoute(n.project, r0, '192.168.2.1')).toMatchObject({ code: 'L', prefix: 32 })
    expect(getRoute(n.project, r0, '10.0.0.1')).toBeUndefined()
  })
})
