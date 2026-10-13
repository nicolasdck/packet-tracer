import { useEffect, useState, type FormEvent } from 'react'
import {
  modelOf,
  HOST_PROMPT,
  consoleTarget,
  formatIpv6,
  hostV6,
  isHostDevice,
  setHostDhcp,
  setHostIpv6,
  setHostNet,
  validateHostIpv6,
  validateHostNet,
  type HostDevice,
  type HostIpv6Errors,
  type HostNetErrors,
  type HostNetInput,
  type Project,
} from '../../engine'
import { useCliStore } from '../store/cliStore'
import { usePcStore, type PcTab } from '../store/pcStore'
import { useProjectStore } from '../store/projectStore'
import { ConsoleView } from '../terminal/ConsoleView'
import { Terminal } from '../terminal/Terminal'
import { useVisualViewport } from '../terminal/useVisualViewport'

const FIELDS: { key: keyof HostNetInput; label: string }[] = [
  { key: 'ip', label: 'IPv4 Address' },
  { key: 'mask', label: 'Subnet Mask' },
  { key: 'gateway', label: 'Default Gateway' },
]

/** Addresses obtained by DHCP, read-only. */
function DhcpStatus({ device }: { device: HostDevice }) {
  const apply = useProjectStore((s) => s.apply)
  const lease = device.runtime.lease
  const rows: [string, string | undefined][] = [
    ['IPv4 Address', lease?.ip],
    ['Subnet Mask', lease?.mask],
    ['Default Gateway', lease?.gateway],
    ['DNS Server', lease?.dns],
  ]
  return (
    <div className="flex flex-col gap-4">
      <p className={`rounded-lg px-3 py-2 text-sm ${lease ? 'bg-emerald-950 text-emerald-300' : 'bg-amber-950 text-amber-300'}`}>
        {lease ? 'Address obtained from a DHCP server.' : 'No DHCP server answered. The PC keeps retrying as the network changes.'}
      </p>
      <dl className="flex flex-col gap-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between rounded-lg bg-slate-800 px-3 py-2.5">
            <dt className="text-sm text-slate-300">{label}</dt>
            <dd className="font-mono text-slate-100">{value ?? '0.0.0.0'}</dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        onClick={() => apply((p) => setHostDhcp(p, device.id))}
        className="rounded-lg bg-slate-700 py-2.5 font-medium text-slate-100 hover:bg-slate-600"
      >
        Renew
      </button>
    </div>
  )
}

function IpConfigForm({ device }: { device: HostDevice }) {
  const apply = useProjectStore((s) => s.apply)
  /** Mode shown in the form; switching to Static only takes effect on Apply. */
  const [mode, setMode] = useState(device.net.mode)
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

  function choose(next: 'dhcp' | 'static') {
    setMode(next)
    setSaved(false)
    // DHCP applies at once: the PC asks for an address right away.
    if (next === 'dhcp' && device.net.mode !== 'dhcp') apply((p) => setHostDhcp(p, device.id))
  }

  const option = (id: 'dhcp' | 'static', label: string) => (
    <button
      type="button"
      onClick={() => choose(id)}
      aria-pressed={mode === id}
      className={`flex-1 rounded-md py-2 text-sm font-medium ${
        mode === id ? 'bg-sky-600 text-white' : 'text-slate-300 hover:bg-slate-700'
      }`}
    >
      {label}
    </button>
  )

  return (
    <form onSubmit={submit} className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
      <div className="text-sm text-slate-400">FastEthernet0 · IPv4</div>
      <div className="flex gap-1 rounded-lg bg-slate-800 p-1">
        {option('dhcp', 'DHCP')}
        {option('static', 'Static')}
      </div>
      {mode === 'dhcp' && <DhcpStatus device={device} />}
      {mode === 'static' && (
        <StaticFields
          values={values}
          errors={errors}
          saved={saved}
          onChange={(key, value) => {
            setValues({ ...values, [key]: value })
            setErrors({ ...errors, [key]: undefined })
            setSaved(false)
          }}
        />
      )}
    </form>
  )
}

/** IPv6 settings: automatic (SLAAC) or static. The link-local address always exists. */
function Ipv6Form({ project, device }: { project: Project; device: HostDevice }) {
  const apply = useProjectStore((s) => s.apply)
  const cfg = device.net.ipv6
  const [mode, setMode] = useState<'auto' | 'static'>(cfg?.mode ?? 'static')
  const [address, setAddress] = useState(cfg?.address ? `${cfg.address}/${cfg.prefix ?? 64}` : '')
  const [gateway, setGateway] = useState(cfg?.gateway ?? '')
  const [errors, setErrors] = useState<HostIpv6Errors>({})
  const [saved, setSaved] = useState(false)
  const info = hostV6(project, device)

  function choose(next: 'auto' | 'static') {
    setMode(next)
    setSaved(false)
    // Auto applies at once; static waits for Apply.
    if (next === 'auto' && cfg?.mode !== 'auto') apply((p) => setHostIpv6(p, device.id, { mode: 'auto', address: '', gateway: '' }))
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const input = { mode: 'static' as const, address, gateway }
    const found = validateHostIpv6(input)
    setErrors(found)
    if (Object.keys(found).length) return
    apply((p) => setHostIpv6(p, device.id, input))
    setSaved(true)
  }

  const option = (id: 'auto' | 'static', label: string) => (
    <button
      type="button"
      onClick={() => choose(id)}
      aria-pressed={mode === id}
      className={`flex-1 rounded-md py-2 text-sm font-medium ${
        mode === id ? 'bg-sky-600 text-white' : 'text-slate-300 hover:bg-slate-700'
      }`}
    >
      {label}
    </button>
  )
  const row = (label: string, value: string) => (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-800 px-3 py-2.5">
      <dt className="shrink-0 text-sm text-slate-300">{label}</dt>
      <dd className="min-w-0 break-all text-right font-mono text-sm text-slate-100">{value}</dd>
    </div>
  )
  const field = (label: string, value: string, set: (v: string) => void, error: string | undefined, placeholder: string) => (
    <label className="flex flex-col gap-1">
      <span className="text-sm text-slate-300">{label}</span>
      <input
        value={value}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => {
          set(e.target.value)
          setErrors({})
          setSaved(false)
        }}
        className={`rounded-lg border bg-slate-950 px-3 py-2.5 font-mono text-slate-100 outline-none focus:border-sky-500 ${
          error ? 'border-red-500' : 'border-slate-600'
        }`}
      />
      {error && <span className="text-sm text-red-400">{error}</span>}
    </label>
  )

  return (
    <form onSubmit={submit} className="mx-auto flex w-full max-w-md flex-col gap-4 border-t border-slate-800 p-4">
      <div className="text-sm text-slate-400">IPv6</div>
      <div className="flex gap-1 rounded-lg bg-slate-800 p-1">
        {option('auto', 'Auto (SLAAC)')}
        {option('static', 'Static')}
      </div>
      <dl className="flex flex-col gap-2">
        {row('Link-local Address', formatIpv6(info.linkLocal))}
        {mode === 'auto' && (
          <>
            {row('IPv6 Address', info.source === 'slaac' ? info.addresses.map((a) => `${formatIpv6(a.ip)}/${a.prefix}`).join(', ') : '::')}
            {row('Default Gateway', info.source === 'slaac' && info.gateway !== null ? formatIpv6(info.gateway) : '::')}
          </>
        )}
      </dl>
      {mode === 'auto' && info.source !== 'slaac' && (
        <p className="rounded-lg bg-amber-950 px-3 py-2 text-sm text-amber-300">
          No router advertises a prefix on this link (it needs <span className="font-mono">ipv6 unicast-routing</span> and a /64 address).
        </p>
      )}
      {mode === 'static' && (
        <>
          {field('IPv6 Address / Prefix', address, setAddress, errors.address, '2001:db8:1::10/64')}
          {field('IPv6 Gateway', gateway, setGateway, errors.gateway, '2001:db8:1::1')}
          <button type="submit" className="rounded-lg bg-sky-600 py-2.5 font-medium text-white hover:bg-sky-500">
            Apply
          </button>
          {saved && <p className="text-center text-sm text-emerald-400">Configuration applied.</p>}
        </>
      )}
    </form>
  )
}

interface StaticFieldsProps {
  values: HostNetInput
  errors: HostNetErrors
  saved: boolean
  onChange(key: keyof HostNetInput, value: string): void
}

function StaticFields({ values, errors, saved, onChange }: StaticFieldsProps) {
  return (
    <>
      {FIELDS.map(({ key, label }) => (
        <label key={key} className="flex flex-col gap-1">
          <span className="text-sm text-slate-300">{label}</span>
          <input
            value={values[key]}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="0.0.0.0"
            onChange={(e) => onChange(key, e.target.value)}
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
    </>
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
      {item('config', 'IP Config')}
      {item('prompt', 'Command Prompt')}
      {item('terminal', 'Terminal')}
    </div>
  )
}

/** Console of the router or switch cabled to the PC's RS232 port. */
function ConsoleTab({ project, hostId }: { project: Project; hostId: string }) {
  const targetId = consoleTarget(project, hostId)
  const ensure = useCliStore((s) => s.ensure)
  const terminal = useCliStore((s) => (targetId ? s.terminals[targetId] : undefined))
  const target = targetId ? project.devices[targetId] : undefined

  useEffect(() => {
    if (targetId) ensure(targetId)
  }, [targetId, ensure])

  if (!targetId || !target) {
    return (
      <div className="mx-auto max-w-md p-6 text-center text-sm text-slate-400">
        <p className="mb-2 font-medium text-slate-200">No console cable connected.</p>
        <p>
          On the canvas, link this device's <span className="font-mono text-slate-200">RS232</span> port to the{' '}
          <span className="font-mono text-slate-200">Console</span> port of a router or switch.
        </p>
      </div>
    )
  }
  if (!terminal) return null
  return (
    <>
      <div className="border-b border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-400">
        Console of <span className="font-medium text-slate-200">{target.label}</span> · 9600 baud, 8N1
      </div>
      <Terminal key={targetId} project={project} deviceId={targetId} terminal={terminal} />
    </>
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
        <span className="text-sm text-slate-400">{modelOf(device).displayName}</span>
      </header>
      <Tabs tab={tab} setTab={setTab} />
      {tab === 'config' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <IpConfigForm key={device.id} device={device} />
          <Ipv6Form key={`v6-${device.id}`} project={project} device={device} />
        </div>
      )}
      {tab === 'prompt' && (
        <ConsoleView
          key={device.id}
          lines={pcConsole?.lines ?? []}
          prompt={HOST_PROMPT}
          history={pcConsole?.history ?? []}
          onSubmit={run}
        />
      )}
      {tab === 'terminal' && <ConsoleTab project={project} hostId={device.id} />}
    </div>
  )
}
