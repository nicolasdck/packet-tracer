import type { Device, DeviceKind, HostDevice, IfName, IosDevice } from './types'

/**
 * A hardware model. The device *kind* decides how it behaves (router, layer 2
 * switch…); the *model* decides which ports it has.
 */
export interface DeviceModel {
  /** Stored in Device.model. */
  id: string
  kind: DeviceKind
  /** Human name shown in the palette. */
  displayName: string
  /** Canvas label prefix: "Router" → "Router0", "Router1"… */
  labelPrefix: string
  /** IOS hostname out of the box (IOS devices only). */
  defaultHostname?: string
  /** Data ports. */
  ports: readonly IfName[]
  /** Port for the console cable: "Console" on IOS devices, "RS232" on hosts. */
  consolePort: IfName
  /**
   * The switch can trunk with ISL or 802.1Q (3560): `switchport mode trunk`
   * is refused until `switchport trunk encapsulation dot1q` is set.
   */
  trunkEncapsulation?: boolean
}

function range(prefix: string, from: number, to: number): IfName[] {
  const out: IfName[] = []
  for (let i = from; i <= to; i++) out.push(`${prefix}${i}`)
  return out
}

const router = (id: string, ports: IfName[]): DeviceModel => ({
  id,
  kind: 'router',
  displayName: `Router ${id}`,
  labelPrefix: 'Router',
  defaultHostname: 'Router',
  ports,
  consolePort: 'Console',
})

/** Every model, in palette order. The first model of a kind is its default. */
export const MODELS: readonly DeviceModel[] = [
  router('1941', [...range('GigabitEthernet0/', 0, 1), ...range('Serial0/0/', 0, 1)]),
  router('2911', [...range('GigabitEthernet0/', 0, 2), ...range('Serial0/0/', 0, 1), ...range('Serial0/1/', 0, 1)]),
  router('4331', [...range('GigabitEthernet0/0/', 0, 2), ...range('Serial0/1/', 0, 1)]),
  {
    id: '2960',
    kind: 'switch-l2',
    displayName: 'Switch 2960',
    labelPrefix: 'Switch',
    defaultHostname: 'Switch',
    ports: [...range('FastEthernet0/', 1, 24), ...range('GigabitEthernet0/', 1, 2)],
    consolePort: 'Console',
  },
  {
    id: '2960-48',
    kind: 'switch-l2',
    displayName: 'Switch 2960-48',
    labelPrefix: 'Switch',
    defaultHostname: 'Switch',
    ports: [...range('FastEthernet0/', 1, 48), ...range('GigabitEthernet0/', 1, 2)],
    consolePort: 'Console',
  },
  {
    id: '3560',
    kind: 'switch-l3',
    displayName: 'Multilayer Switch 3560',
    labelPrefix: 'Multilayer Switch',
    defaultHostname: 'Switch',
    ports: [...range('FastEthernet0/', 1, 24), ...range('GigabitEthernet0/', 1, 2)],
    consolePort: 'Console',
    trunkEncapsulation: true,
  },
  {
    id: '3650',
    kind: 'switch-l3',
    displayName: 'Multilayer Switch 3650',
    labelPrefix: 'Multilayer Switch',
    defaultHostname: 'Switch',
    ports: [...range('GigabitEthernet1/0/', 1, 24), ...range('GigabitEthernet1/1/', 1, 4)],
    consolePort: 'Console',
  },
  { id: 'PC', kind: 'pc', displayName: 'PC', labelPrefix: 'PC', ports: ['FastEthernet0'], consolePort: 'RS232' },
  { id: 'Server', kind: 'server', displayName: 'Server', labelPrefix: 'Server', ports: ['FastEthernet0'], consolePort: 'RS232' },
]

const BY_ID = new Map(MODELS.map((m) => [m.id, m]))

/** Default model of each kind (the first one listed). */
export const CATALOG = Object.fromEntries([...MODELS].reverse().map((m) => [m.kind, m])) as Record<DeviceKind, DeviceModel>

export const DEVICE_KINDS: readonly DeviceKind[] = ['router', 'switch-l2', 'switch-l3', 'pc', 'server']

/** Model by id; an unknown id falls back to the default model of the kind. */
export function findModel(kind: DeviceKind, modelId?: string): DeviceModel {
  const model = modelId === undefined ? undefined : BY_ID.get(modelId)
  return model && model.kind === kind ? model : CATALOG[kind]
}

export function modelOf(device: Device): DeviceModel {
  return findModel(device.kind, device.model)
}

export function isIosKind(kind: DeviceKind): kind is 'router' | 'switch-l2' | 'switch-l3' {
  return kind === 'router' || kind === 'switch-l2' || kind === 'switch-l3'
}

export function isIosDevice(device: Device): device is IosDevice {
  return isIosKind(device.kind)
}

export function isHostDevice(device: Device): device is HostDevice {
  return !isIosKind(device.kind)
}
