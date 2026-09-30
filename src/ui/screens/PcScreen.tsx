import { useState, type FormEvent } from 'react'
import {
  CATALOG,
  HOST_PROMPT,
  isHostDevice,
  setHostNet,
  validateHostNet,
  type HostDevice,
  type HostNetErrors,
  type HostNetInput,
  type Project,
} from '../../engine'
import { usePcStore, type PcTab } from '../store/pcStore'
import { useProjectStore } from '../store/projectStore'
import { ConsoleView } from '../terminal/ConsoleView'
import { useVisualViewport } from '../terminal/useVisualViewport'

const FIELDS: { key: keyof HostNetInput; label: string }[] = [
  { key: 'ip', label: 'IPv4 Address' },
  { key: 'mask', label: 'Subnet Mask' },
  { key: 'gateway', label: 'Default Gateway' },
]

function IpConfigForm({ device }: { device: HostDevice }) {
  const apply = useProjectStore((s) => s.apply)
  const [values, setValues] = useState<HostNetInput>({
    ip: device.net.ip ?? '',
    mask: device.net.mask ?? '',
    gateway: device.net.gateway ?? '',
  })
  const [errors, setErrors] = useState<HostNetErrors>({})
  const [saved, setSaved] = useState(false)

  function submit(e: FormEvent) {
    e.preventDefault()
    const found = validateHostNet(values)
    setErrors(found)
    if (Object.keys(found).length) return
    apply((p) => setHostNet(p, device.id, values))
    setSaved(true)
  }

  return (
    <form onSubmit={submit} className="mx-auto flex w-full max-w-md flex-col gap-4 overflow-y-auto p-4">
      <div className="text-sm text-slate-400">FastEthernet0 · Static</div>
      {FIELDS.map(({ key, label }) => (
        <label key={key} className="flex flex-col gap-1">
          <span className="text-sm text-slate-300">{label}</span>
          <input
            value={values[key]}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="0.0.0.0"
            onChange={(e) => {
              setValues({ ...values, [key]: e.target.value })
              setErrors({ ...errors, [key]: undefined })
              setSaved(false)
            }}
            className={`rounded-lg border bg-slate-950 px-3 py-2.5 font-mono text-slate-100 outline-none focus:border-sky-500 ${
              errors[key] ? 'border-red-500' : 'border-slate-600'
            }`}
          />
          {errors[key] && <span className="text-sm text-red-400">{errors[key]}</span>}
        </label>
      ))}
      <button type="submit" className="rounded-lg bg-sky-600 py-2.5 font-medium text-white hover:bg-sky-500">
        Apply
      </button>
      {saved && <p className="text-center text-sm text-emerald-400">Configuration applied.</p>}
    </form>
  )
}

function Tabs({ tab, setTab }: { tab: PcTab; setTab(tab: PcTab): void }) {
  const item = (id: PcTab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`flex-1 border-b-2 py-2.5 text-sm font-medium ${
        tab === id ? 'border-sky-500 text-slate-100' : 'border-transparent text-slate-400'
      }`}
    >
      {label}
    </button>
  )
  return (
    <div className="flex border-b border-slate-800">
      {item('config', 'IP Configuration')}
      {item('prompt', 'Command Prompt')}
    </div>
  )
}

/** Full-screen view of a PC or server: IP settings and command prompt. */
export function PcScreen({ project }: { project: Project }) {
  const { openDeviceId, tab, consoles, close, setTab, run } = usePcStore()
  const viewport = useVisualViewport()
  const device = openDeviceId ? project.devices[openDeviceId] : undefined
  if (!device || !isHostDevice(device)) return null
  const pcConsole = consoles[device.id]

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
      <Tabs tab={tab} setTab={setTab} />
      {tab === 'config' ? (
        <IpConfigForm key={device.id} device={device} />
      ) : (
        <ConsoleView
          key={device.id}
          lines={pcConsole?.lines ?? []}
          prompt={HOST_PROMPT}
          history={pcConsole?.history ?? []}
          onSubmit={run}
        />
      )}
    </div>
  )
}
