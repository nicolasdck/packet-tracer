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
export { interfaceStatus } from './sim/linkState'
export type { IfStatus } from './sim/linkState'
export {
  createSession,
  openSession,
  getPrompt,
  executeLine,
  ctrlZ,
  cliHelp,
  cliComplete,
} from './cli/execute'
export type { CliResult, Prompt } from './cli/execute'
export type { CliSession, ModeId } from './cli/types'
export { validateHostNet, setHostNet } from './host/config'
export type { HostNetInput, HostNetErrors } from './host/config'
export { runHostCommand, HOST_PROMPT } from './host/terminal'
export type { HostResult } from './host/terminal'
export { canPing, getRoute } from './query'
export type { Route, RouteCode } from './sim/rib'
