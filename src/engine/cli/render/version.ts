import type { IosDevice } from '../../model/types'

interface VersionInfo {
  software: string
  image: string
  platform: string
  memory: string
}

const VERSIONS: Record<IosDevice['kind'], VersionInfo> = {
  router: {
    software: 'C1900 Software (C1900-UNIVERSALK9-M), Version 15.1(4)M4, RELEASE SOFTWARE (fc2)',
    image: 'flash0:c1900-universalk9-mz.SPA.151-1.M4.bin',
    platform: 'Cisco CISCO1941/K9 (revision 1.0) with 491520K/32768K bytes of memory.',
    memory: '255744K bytes of ATA System CompactFlash 0 (Read/Write)',
  },
  'switch-l2': {
    software: 'C2960 Software (C2960-LANBASEK9-M), Version 15.0(2)SE4, RELEASE SOFTWARE (fc1)',
    image: 'flash:c2960-lanbasek9-mz.150-2.SE4.bin',
    platform: 'cisco WS-C2960-24TT-L (PowerPC405) processor (revision B0) with 65536K bytes of memory.',
    memory: '64K bytes of flash-simulated non-volatile configuration memory.',
  },
  'switch-l3': {
    software: 'C3560 Software (C3560-ADVIPSERVICESK9-M), Version 12.2(37)SE1, RELEASE SOFTWARE (fc1)',
    image: 'flash:c3560-advipservicesk9-mz.122-37.SE1.bin',
    platform: 'cisco WS-C3560-24PS (PowerPC405) processor (revision C0) with 524288K bytes of memory.',
    memory: '512K bytes of flash-simulated non-volatile configuration memory.',
  },
}

export function showVersion(device: IosDevice): string[] {
  const v = VERSIONS[device.kind]
  const count = (prefix: string) => device.ports.filter((p) => p.name.startsWith(prefix)).length
  const out = [
    `Cisco IOS Software, ${v.software}`,
    'Technical Support: http://www.cisco.com/techsupport',
    '',
    `${device.running.hostname} uptime is 0 minutes`,
    'System returned to ROM by power-on',
    `System image file is "${v.image}"`,
    '',
    v.platform,
  ]
  if (count('FastEthernet')) out.push(`${count('FastEthernet')} FastEthernet interfaces`)
  if (count('GigabitEthernet')) out.push(`${count('GigabitEthernet')} Gigabit Ethernet interfaces`)
  if (count('Serial')) out.push(`${count('Serial')} Low-speed serial(sync/async) network interface(s)`)
  out.push(v.memory, '', `Base ethernet MAC Address       : ${device.ports[0]?.mac ?? ''}`, '', 'Configuration register is 0x2102', '')
  return out
}
