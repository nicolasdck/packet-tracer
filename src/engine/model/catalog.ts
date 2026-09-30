import type { Device, DeviceKind, HostDevice, IfName, IosDevice } from './types'

export interface DeviceModel {
  kind: DeviceKind
  model: string
  /** Human name shown in the palette. */
  displayName: string
  /** Canvas label prefix: "Router" → "Router0", "Router1"… */
  labelPrefix: string
  /** IOS hostname out of the box (IOS devices only). */
  defaultHostname?: string
  ports: readonly IfName[]
}

function range(prefix: string, from: number, to: number): IfName[] {
  const out: IfName[] = []
  for (let i = from; i <= to; i++) out.push(`${prefix}${i}`)
  return out
}

const SWITCH_PORTS = [...range('FastEthernet0/', 1, 24), ...range('GigabitEthernet0/', 1, 2)]

export const CATALOG: Record<DeviceKind, DeviceModel> = {
  router: {
    kind: 'router',
    model: '1941',
    displayName: 'Router 1941',
    labelPrefix: 'Router',
    defaultHostname: 'Router',
    ports: [...range('GigabitEthernet0/', 0, 1), ...range('Serial0/0/', 0, 1)],
  },
  'switch-l2': {
    kind: 'switch-l2',
    model: '2960',
    displayName: 'Switch 2960',
    labelPrefix: 'Switch',
    defaultHostname: 'Switch',
    ports: SWITCH_PORTS,
  },
  'switch-l3': {
    kind: 'switch-l3',
    model: '3560',
    displayName: 'Multilayer Switch 3560',
    labelPrefix: 'Multilayer Switch',
    defaultHostname: 'Switch',
    ports: SWITCH_PORTS,
  },
  pc: {
    kind: 'pc',
    model: 'PC',
    displayName: 'PC',
    labelPrefix: 'PC',
    ports: ['FastEthernet0'],
  },
  server: {
    kind: 'server',
    model: 'Server',
    displayName: 'Server',
    labelPrefix: 'Server',
    ports: ['FastEthernet0'],
  },
}

export const DEVICE_KINDS: readonly DeviceKind[] = ['router', 'switch-l2', 'switch-l3', 'pc', 'server']

export function isIosKind(kind: DeviceKind): kind is 'router' | 'switch-l2' | 'switch-l3' {
  return kind === 'router' || kind === 'switch-l2' || kind === 'switch-l3'
}

export function isIosDevice(device: Device): device is IosDevice {
  return isIosKind(device.kind)
}

export function isHostDevice(device: Device): device is HostDevice {
  return !isIosKind(device.kind)
}
