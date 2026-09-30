export * from './model/types'
export { CATALOG, DEVICE_KINDS, isIosKind, isIosDevice, isHostDevice } from './model/catalog'
export type { DeviceModel } from './model/catalog'
export { shortIfName, ifMedia } from './model/ifname'
export { createProject, cloneProject } from './project/create'
export {
  TopologyError,
  MAX_LABEL_LENGTH,
  addDevice,
  moveDevice,
  renameDevice,
  removeDevice,
  deviceLinks,
  linkAt,
  listPorts,
  canConnect,
  connect,
  disconnect,
} from './project/topology'
export type { PortInfo } from './project/topology'
