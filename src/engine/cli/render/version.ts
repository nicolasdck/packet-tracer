import type { IosDevice } from '../../model/types'

interface VersionInfo {
  software: string
  image: string
  platform: string
  memory: string
}

const C2960_SOFTWARE = 'C2960 Software (C2960-LANBASEK9-M), Version 15.0(2)SE4, RELEASE SOFTWARE (fc1)'

/** By model id. */
const VERSIONS: Record<string, VersionInfo> = {
  '1941': {
    software: 'C1900 Software (C1900-UNIVERSALK9-M), Version 15.1(4)M4, RELEASE SOFTWARE (fc2)',
    image: 'flash0:c1900-universalk9-mz.SPA.151-1.M4.bin',
    platform: 'Cisco CISCO1941/K9 (revision 1.0) with 491520K/32768K bytes of memory.',
    memory: '255744K bytes of ATA System CompactFlash 0 (Read/Write)',
  },
  '2911': {
    software: 'C2900 Software (C2900-UNIVERSALK9-M), Version 15.1(4)M4, RELEASE SOFTWARE (fc2)',
    image: 'flash0:c2900-universalk9-mz.SPA.151-1.M4.bin',
    platform: 'Cisco CISCO2911/K9 (revision 1.0) with 491520K/32768K bytes of memory.',
    memory: '255744K bytes of ATA System CompactFlash 0 (Read/Write)',
  },
  '4331': {
    software: 'ISR Software (X86_64_LINUX_IOSD-UNIVERSALK9-M), Version 15.5(3)S5, RELEASE SOFTWARE (fc2)',
    image: 'bootflash:/isr4300-universalk9.03.16.05.S.155-3.S5-ext.SPA.bin',
    platform: 'cisco ISR4331/K9 (1RU) processor with 1795999K/6147K bytes of memory.',
    memory: '3207167K bytes of flash memory at bootflash:.',
  },
  '2960': {
    software: C2960_SOFTWARE,
    image: 'flash:c2960-lanbasek9-mz.150-2.SE4.bin',
    platform: 'cisco WS-C2960-24TT-L (PowerPC405) processor (revision B0) with 65536K bytes of memory.',
    memory: '64K bytes of flash-simulated non-volatile configuration memory.',
  },
  '2960-48': {
    software: C2960_SOFTWARE,
    image: 'flash:c2960-lanbasek9-mz.150-2.SE4.bin',
    platform: 'cisco WS-C2960-48TT-L (PowerPC405) processor (revision B0) with 65536K bytes of memory.',
    memory: '64K bytes of flash-simulated non-volatile configuration memory.',
  },
  '3560': {
    software: 'C3560 Software (C3560-ADVIPSERVICESK9-M), Version 12.2(37)SE1, RELEASE SOFTWARE (fc1)',
    image: 'flash:c3560-advipservicesk9-mz.122-37.SE1.bin',
    platform: 'cisco WS-C3560-24PS (PowerPC405) processor (revision C0) with 524288K bytes of memory.',
    memory: '512K bytes of flash-simulated non-volatile configuration memory.',
  },
  '3650': {
    software: 'Catalyst L3 Switch Software (CAT3K_CAA-UNIVERSALK9-M), Version 16.3.2, RELEASE SOFTWARE (fc4)',
    image: 'flash:cat3k_caa-universalk9.16.03.02.SPA.bin',
    platform: 'cisco WS-C3650-24PS (MIPS) processor (revision N0) with 865815K/6147K bytes of memory.',
    memory: '2048K bytes of non-volatile configuration memory.',
  },
}

const DEFAULT_MODEL: Record<IosDevice['kind'], string> = {
  router: '1941',
  'switch-l2': '2960',
  'switch-l3': '3560',
  'wireless-router': '1941',
}

export function showVersion(device: IosDevice): string[] {
  const v = VERSIONS[device.model] ?? VERSIONS[DEFAULT_MODEL[device.kind]]!
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
