import { CATALOG, type Project } from '../../engine'
import { useCliStore } from '../store/cliStore'
import { Terminal } from '../terminal/Terminal'
import { useVisualViewport } from '../terminal/useVisualViewport'

/** Full-screen console of an IOS device, laid over the canvas. */
export function DeviceCli({ project }: { project: Project }) {
  const deviceId = useCliStore((s) => s.openDeviceId)
  const terminal = useCliStore((s) => (deviceId ? s.terminals[deviceId] : undefined))
  const close = useCliStore((s) => s.close)
  const viewport = useVisualViewport()

  const device = deviceId ? project.devices[deviceId] : undefined
  if (!device || !terminal) return null

  return (
    <div
      className="fixed inset-x-0 z-40 flex flex-col bg-slate-900 text-slate-100"
      style={{ top: viewport.offsetTop, height: viewport.height }}
    >
      <header className="flex items-center gap-2 border-b border-slate-800 px-2 pt-[env(safe-area-inset-top)]">
        <button type="button" onClick={close} className="rounded-lg px-3 py-3 text-slate-300 hover:bg-slate-800" aria-label="Back to canvas">
          ←
        </button>
        <h1 className="truncate font-semibold">{device.label}</h1>
        <span className="text-sm text-slate-400">{CATALOG[device.kind].displayName}</span>
      </header>
      {/* Keyed by device so input and history browsing reset when switching consoles. */}
      <Terminal key={device.id} project={project} terminal={terminal} />
    </div>
  )
}
