import { ReactFlowProvider } from '@xyflow/react'
import {
  MAX_LABEL_LENGTH,
  TopologyError,
  connect,
  deviceLinks,
  disconnect,
  isIosDevice,
  removeDevice,
  renameDevice,
  shortIfName,
  type Project,
} from '../../engine'
import { Canvas } from '../canvas/Canvas'
import { Palette } from '../canvas/Palette'
import { PortPicker } from '../canvas/PortPicker'
import { BottomSheet } from '../components/BottomSheet'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { TextPrompt } from '../components/TextPrompt'
import { flushAutosave } from '../persistence/autosave'
import { useCliStore } from '../store/cliStore'
import { useProjectStore } from '../store/projectStore'
import { useUiStore } from '../store/uiStore'
import { DeviceCli } from './DeviceCli'

const btn = 'rounded-lg px-3 py-2.5 text-sm font-medium'
const primary = `${btn} bg-sky-600 text-white hover:bg-sky-500 active:bg-sky-700`
const secondary = `${btn} bg-slate-700 text-slate-100 hover:bg-slate-600 active:bg-slate-500`
const danger = `${btn} bg-red-600/90 text-white hover:bg-red-500`

function LinkBanner({ project }: { project: Project }) {
  const linkDraft = useUiStore((s) => s.linkDraft)
  const cancelLink = useUiStore((s) => s.cancelLink)
  if (!linkDraft) return null
  const a = linkDraft.a
  const text = a
    ? `${project.devices[a.deviceId]?.label} ${shortIfName(a.port)} → tap the second device`
    : 'Tap the first device'
  return (
    <div className="absolute inset-x-3 top-3 z-10 flex items-center justify-between gap-3 rounded-xl bg-amber-500/95 px-4 py-2.5 text-sm font-medium text-slate-900 shadow-lg">
      <span>{text}</span>
      <button type="button" onClick={cancelLink} className="rounded-md bg-slate-900/15 px-2.5 py-1">
        Cancel
      </button>
    </div>
  )
}

function Toolbar({ project }: { project: Project }) {
  const apply = useProjectStore((s) => s.apply)
  const { selection, linkDraft, select, openSheet, startLink } = useUiStore()

  if (linkDraft) return null

  if (selection?.kind === 'device') {
    const device = project.devices[selection.id]
    if (!device) return null
    return (
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium text-slate-100">{device.label}</span>
        <button type="button" className={secondary} onClick={() => openSheet('device-menu')} aria-label="Device actions">⋯</button>
        <button type="button" className={secondary} onClick={() => select(null)} aria-label="Deselect">✕</button>
      </div>
    )
  }

  if (selection?.kind === 'link') {
    const link = project.links[selection.id]
    if (!link) return null
    const end = (e: typeof link.a) => `${project.devices[e.deviceId]?.label} ${shortIfName(e.port)}`
    return (
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{end(link.a)} ↔ {end(link.b)}</span>
        <button
          type="button"
          className={danger}
          onClick={() => {
            apply((p) => disconnect(p, link.id))
            select(null)
          }}
        >
          Delete link
        </button>
        <button type="button" className={secondary} onClick={() => select(null)} aria-label="Deselect">✕</button>
      </div>
    )
  }

  const canLink = Object.keys(project.devices).length >= 2
  return (
    <div className="flex gap-2">
      <button type="button" className={`${primary} flex-1`} onClick={() => openSheet('palette')}>+ Add device</button>
      <button type="button" className={`${secondary} flex-1 disabled:opacity-40`} disabled={!canLink} onClick={startLink}>
        Link
      </button>
    </div>
  )
}

function Sheets({ project }: { project: Project }) {
  const apply = useProjectStore((s) => s.apply)
  const { selection, sheet, linkDraft, openSheet, select, setLinkStart, closePortPicker, cancelLink } = useUiStore()
  const close = () => openSheet(null)
  const device = selection?.kind === 'device' ? project.devices[selection.id] : undefined
  const openCli = useCliStore((s) => s.open)
  const forgetCli = useCliStore((s) => s.forget)
  const menuItem = 'rounded-lg bg-slate-700 py-3 hover:bg-slate-600'

  return (
    <>
      {sheet === 'palette' && <Palette onClose={close} />}

      {sheet === 'device-menu' && device && (
        <BottomSheet title={device.label} onClose={close}>
          <div className="flex flex-col gap-2">
            {isIosDevice(device) && (
              <button
                type="button"
                className={menuItem}
                onClick={() => {
                  close()
                  openCli(device.id)
                }}
              >
                Open CLI
              </button>
            )}
            <button type="button" className={menuItem} onClick={() => openSheet('rename')}>Rename</button>
            <button type="button" className="rounded-lg bg-red-600/90 py-3 text-white hover:bg-red-500" onClick={() => openSheet('delete')}>
              Delete
            </button>
          </div>
        </BottomSheet>
      )}

      {sheet === 'rename' && device && (
        <TextPrompt
          title="Rename device"
          initial={device.label}
          submitLabel="Rename"
          maxLength={MAX_LABEL_LENGTH}
          onClose={close}
          onSubmit={(value) => {
            try {
              apply((p) => renameDevice(p, device.id, value))
            } catch (e) {
              if (e instanceof TopologyError) return e.message
              throw e
            }
          }}
        />
      )}

      {sheet === 'delete' && device && (() => {
        const count = deviceLinks(project, device.id).length
        return (
          <ConfirmSheet
            title="Delete device"
            message={`Delete ${device.label}${count ? ` and its ${count} link${count > 1 ? 's' : ''}` : ''}?`}
            confirmLabel="Delete"
            onClose={close}
            onConfirm={() => {
              apply((p) => removeDevice(p, device.id))
              forgetCli(device.id)
              select(null)
            }}
          />
        )
      })()}

      {linkDraft?.pickingFor && (
        <PortPicker
          project={project}
          deviceId={linkDraft.pickingFor}
          from={linkDraft.a}
          onClose={closePortPicker}
          onPick={(port) => {
            const end = { deviceId: linkDraft.pickingFor!, port }
            if (!linkDraft.a) return setLinkStart(end)
            const a = linkDraft.a
            apply((p) => connect(p, a, end).project)
            cancelLink()
          }}
        />
      )}
    </>
  )
}

export function Workspace({ project }: { project: Project }) {
  const close = useProjectStore((s) => s.close)
  const reset = useUiStore((s) => s.reset)
  const resetCli = useCliStore((s) => s.reset)

  async function back() {
    await flushAutosave()
    reset()
    resetCli()
    close()
  }

  return (
    <ReactFlowProvider>
      <div className="flex h-dvh flex-col bg-slate-900 text-slate-100">
        <header className="flex items-center gap-2 border-b border-slate-800 px-2 pt-[env(safe-area-inset-top)]">
          <button type="button" onClick={back} className="rounded-lg px-3 py-3 text-slate-300 hover:bg-slate-800" aria-label="Back to projects">
            ←
          </button>
          <h1 className="truncate font-semibold">{project.name}</h1>
        </header>
        <main className="relative flex-1">
          <Canvas project={project} />
          <LinkBanner project={project} />
        </main>
        <footer className="border-t border-slate-800 bg-slate-900 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Toolbar project={project} />
        </footer>
      </div>
      <Sheets project={project} />
      <DeviceCli project={project} />
    </ReactFlowProvider>
  )
}
