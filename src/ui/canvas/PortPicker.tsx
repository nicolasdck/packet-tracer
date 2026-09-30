import { canConnect, ifMedia, listPorts, shortIfName, type LinkEnd, type Project } from '../../engine'
import { BottomSheet } from '../components/BottomSheet'

interface Props {
  project: Project
  deviceId: string
  /** First end of the link when picking the second port. */
  from: LinkEnd | null
  onPick(port: string): void
  onClose(): void
}

export function PortPicker({ project, deviceId, from, onPick, onClose }: Props) {
  const device = project.devices[deviceId]
  if (!device) return null

  const ports = listPorts(project, deviceId).map((p) => {
    let reason: string | null = p.linkId ? 'in use' : null
    if (!reason && from) {
      reason = ifMedia(p.name) !== ifMedia(from.port)
        ? 'incompatible'
        : canConnect(project, from, { deviceId, port: p.name })
    }
    return { ...p, reason }
  })
  const anyFree = ports.some((p) => !p.reason)

  return (
    <BottomSheet title={`${device.label} — select a port`} onClose={onClose}>
      {!anyFree && <p className="mb-3 text-sm text-amber-400">No available port on this device.</p>}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {ports.map((p) => (
          <button
            key={p.name}
            type="button"
            disabled={!!p.reason}
            title={p.reason ?? p.name}
            onClick={() => onPick(p.name)}
            className="flex flex-col items-center rounded-lg bg-slate-700 px-2 py-2 text-sm text-slate-100 hover:bg-slate-600 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
          >
            <span className="font-mono">{shortIfName(p.name)}</span>
            {p.reason && <span className="text-[10px]">{p.reason}</span>}
          </button>
        ))}
      </div>
    </BottomSheet>
  )
}
