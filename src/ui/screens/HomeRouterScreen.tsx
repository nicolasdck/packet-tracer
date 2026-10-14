import { useState, type FormEvent, type ReactNode } from 'react'
import {
  isWirelessLink,
  modelOf,
  setHomeRouter,
  validateHomeRouter,
  type HomeRouterErrors,
  type HomeRouterSettings,
  type IosDevice,
  type Project,
} from '../../engine'
import { useProjectStore } from '../store/projectStore'
import { useUiStore } from '../store/uiStore'
import { useVisualViewport } from '../terminal/useVisualViewport'

const input =
  'w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 outline-none focus:border-sky-500'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm text-slate-300">{label}</span>
      {children}
    </label>
  )
}

function Section({ title, error, children }: { title: string; error?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl bg-slate-800/60 p-4">
      <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
      {children}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </section>
  )
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange(v: T): void }) {
  return (
    <div className="flex gap-1 rounded-lg bg-slate-900 p-1">
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={`flex-1 rounded-md py-1.5 text-sm ${value === id ? 'bg-sky-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function SettingsForm({ project, device }: { project: Project; device: IosDevice }) {
  const apply = useProjectStore((s) => s.apply)
  const [s, setS] = useState<HomeRouterSettings>(() => structuredClone(device.home!))
  const [errors, setErrors] = useState<HomeRouterErrors>({})
  const [saved, setSaved] = useState(false)
  const update = (change: (draft: HomeRouterSettings) => void) => {
    const next = structuredClone(s)
    change(next)
    setS(next)
    setErrors({})
    setSaved(false)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const found = validateHomeRouter(s)
    setErrors(found)
    if (Object.keys(found).length) return
    apply((p) => setHomeRouter(p, device.id, s))
    setSaved(true)
  }

  const wanIp = device.running.interfaces['Internet']?.ip
  const clients = Object.values(project.links)
    .filter((l) => isWirelessLink(l) && (l.a.deviceId === device.id || l.b.deviceId === device.id))
    .map((l) => project.devices[l.a.deviceId === device.id ? l.b.deviceId : l.a.deviceId]?.label ?? '?')

  return (
    <form onSubmit={submit} className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
      <Section title="Status">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-slate-400">Internet</dt>
          <dd className="font-mono text-slate-100">
            {wanIp ? `${wanIp.address} / ${wanIp.mask}` : s.wan.mode === 'dhcp' ? 'waiting for the provider (DHCP)' : 'not configured'}
          </dd>
          <dt className="text-slate-400">Wi-Fi clients</dt>
          <dd className="text-slate-100">{clients.length ? clients.join(', ') : 'none'}</dd>
          <dt className="text-slate-400">DHCP leases</dt>
          <dd className="text-slate-100">{device.runtime.dhcpBindings.length}</dd>
        </dl>
      </Section>

      <Section title="Internet connection" error={errors.wan}>
        <Segmented
          value={s.wan.mode}
          options={[['dhcp', 'Automatic (DHCP)'], ['static', 'Static IP']]}
          onChange={(mode) => update((d) => (d.wan = { ...d.wan, mode }))}
        />
        {s.wan.mode === 'static' &&
          (
            [
              ['ip', 'IP Address'],
              ['mask', 'Subnet Mask'],
              ['gateway', 'Default Gateway'],
              ['dns', 'DNS Server'],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={label}>
              <input className={input} inputMode="decimal" value={s.wan[key] ?? ''} onChange={(e) => update((d) => (d.wan[key] = e.target.value.trim() || undefined))} />
            </Field>
          ))}
      </Section>

      <Section title="Network (LAN)" error={errors.lan ?? errors.dhcp}>
        <Field label="Router IP">
          <input className={input} inputMode="decimal" value={s.lan.ip} onChange={(e) => update((d) => (d.lan.ip = e.target.value.trim()))} />
        </Field>
        <Field label="Subnet Mask">
          <input className={input} inputMode="decimal" value={s.lan.mask} onChange={(e) => update((d) => (d.lan.mask = e.target.value.trim()))} />
        </Field>
        <Segmented
          value={s.dhcp.enabled ? 'on' : 'off'}
          options={[['on', 'DHCP server on'], ['off', 'Off']]}
          onChange={(v) => update((d) => (d.dhcp.enabled = v === 'on'))}
        />
        {s.dhcp.enabled && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start (last octet)">
              <input className={input} inputMode="numeric" value={s.dhcp.start} onChange={(e) => update((d) => (d.dhcp.start = Number(e.target.value) || 0))} />
            </Field>
            <Field label="Maximum users">
              <input className={input} inputMode="numeric" value={s.dhcp.max} onChange={(e) => update((d) => (d.dhcp.max = Number(e.target.value) || 0))} />
            </Field>
          </div>
        )}
      </Section>

      <Section title="Wireless" error={errors.ssid ?? errors.passphrase}>
        <Field label="Network name (SSID)">
          <input className={input} value={s.wifi.ssid} autoCapitalize="off" onChange={(e) => update((d) => (d.wifi.ssid = e.target.value))} />
        </Field>
        <Segmented
          value={s.wifi.security}
          options={[['open', 'Open'], ['wpa2', 'WPA2 Personal']]}
          onChange={(security) => update((d) => (d.wifi = { ...d.wifi, security }))}
        />
        {s.wifi.security === 'wpa2' && (
          <Field label="Passphrase (8 to 63 characters)">
            <input className={input} value={s.wifi.passphrase ?? ''} autoCapitalize="off" onChange={(e) => update((d) => (d.wifi.passphrase = e.target.value))} />
          </Field>
        )}
      </Section>

      <button type="submit" className="rounded-lg bg-sky-600 py-2.5 font-medium text-white hover:bg-sky-500">
        Save Settings
      </button>
      {saved && <p className="text-center text-sm text-emerald-400">Settings saved.</p>}
    </form>
  )
}

/** Settings page of a home Wi-Fi router (it has no command line). */
export function HomeRouterScreen({ project }: { project: Project }) {
  const deviceId = useUiStore((s) => s.homeRouterId)
  const close = useUiStore((s) => s.closeHome)
  const viewport = useVisualViewport()
  const device = deviceId ? project.devices[deviceId] : undefined
  if (!device || device.kind !== 'wireless-router') return null

  return (
    <div className="fixed inset-x-0 z-40 flex flex-col bg-slate-900 text-slate-100" style={{ top: viewport.offsetTop, height: viewport.height }}>
      <header className="flex items-center gap-2 border-b border-slate-800 px-2 pt-[env(safe-area-inset-top)]">
        <button type="button" onClick={close} className="rounded-lg px-3 py-3 text-slate-300 hover:bg-slate-800" aria-label="Back to canvas">
          ←
        </button>
        <h1 className="truncate font-semibold">{device.label}</h1>
        <span className="text-sm text-slate-400">{modelOf(device).displayName}</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SettingsForm key={device.id} project={project} device={device as IosDevice} />
      </div>
    </div>
  )
}
