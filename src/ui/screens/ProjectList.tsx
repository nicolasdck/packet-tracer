import { useCallback, useEffect, useRef, useState } from 'react'
import { ImportError } from '../../engine'
import { BottomSheet } from '../components/BottomSheet'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { TextPrompt } from '../components/TextPrompt'
import {
  createNewProject,
  deleteProject,
  duplicateProject,
  exportAllProjects,
  getProject,
  importProjects,
  listProjects,
  renameProject,
  type ProjectSummary,
} from '../persistence/db'
import { saveFile } from '../persistence/saveFile'
import { useProjectStore } from '../store/projectStore'

const MAX_NAME_LENGTH = 60

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

function relativeTime(ts: number): string {
  const seconds = Math.round((ts - Date.now()) / 1000)
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60],
  ]
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}

type Action =
  | { kind: 'create' }
  | { kind: 'backup' }
  | { kind: 'menu'; project: ProjectSummary }
  | { kind: 'rename'; project: ProjectSummary }
  | { kind: 'delete'; project: ProjectSummary }
  | null

export function ProjectList() {
  const open = useProjectStore((s) => s.open)
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [action, setAction] = useState<Action>(null)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const closeAction = useCallback(() => setAction(null), [])

  const refresh = useCallback(async () => setProjects(await listProjects()), [])

  useEffect(() => {
    let active = true
    void listProjects().then((list) => {
      if (active) setProjects(list)
    })
    return () => {
      active = false
    }
  }, [])

  async function openProject(id: string) {
    const project = await getProject(id)
    if (project) open(project)
  }

  async function runExport() {
    closeAction()
    const date = new Date().toISOString().slice(0, 10)
    await saveFile(`mini-packet-tracer-backup-${date}.json`, await exportAllProjects())
  }

  async function runImport(file: File) {
    try {
      const count = await importProjects(await file.text())
      setNotice({ text: `${count} project${count === 1 ? '' : 's'} imported.`, error: false })
      await refresh()
    } catch (e) {
      setNotice({ text: e instanceof ImportError ? e.message : 'Import failed.', error: true })
    }
  }

  return (
    <div className="min-h-dvh bg-slate-900 text-slate-100">
      <div className="mx-auto max-w-2xl px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-8">
        <header className="mb-6 flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold">Mini Packet Tracer</h1>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAction({ kind: 'backup' })}
              className="rounded-lg bg-slate-800 px-3 py-2.5 text-slate-300 hover:bg-slate-700"
              aria-label="Backup: export or import"
            >
              ⋯
            </button>
            <button
              type="button"
              onClick={() => setAction({ kind: 'create' })}
              className="rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-500"
            >
              + New project
            </button>
          </div>
        </header>

        {notice && (
          <p className={`mb-4 rounded-lg px-3 py-2 text-sm ${notice.error ? 'bg-red-950 text-red-300' : 'bg-emerald-950 text-emerald-300'}`}>
            {notice.text}
          </p>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) await runImport(file)
          }}
        />

        {projects?.length === 0 && (
          <p className="mt-16 text-center text-slate-400">No projects yet. Create one to start building a network.</p>
        )}

        <ul className="flex flex-col gap-2">
          {projects?.map((p) => (
            <li key={p.id} className="flex items-stretch rounded-xl bg-slate-800">
              <button type="button" onClick={() => void openProject(p.id)} className="min-w-0 flex-1 rounded-l-xl px-4 py-3 text-left hover:bg-slate-700/60">
                <div className="truncate font-medium">{p.name}</div>
                <div className="text-xs text-slate-400">
                  {p.deviceCount} device{p.deviceCount === 1 ? '' : 's'} · {p.linkCount} link{p.linkCount === 1 ? '' : 's'} · edited {relativeTime(p.updatedAt)}
                </div>
              </button>
              <button
                type="button"
                onClick={() => setAction({ kind: 'menu', project: p })}
                className="rounded-r-xl px-4 text-xl text-slate-400 hover:bg-slate-700/60 hover:text-slate-100"
                aria-label={`Actions for ${p.name}`}
              >
                ⋯
              </button>
            </li>
          ))}
        </ul>
      </div>

      {action?.kind === 'create' && (
        <TextPrompt
          title="New project"
          initial="Untitled network"
          submitLabel="Create"
          maxLength={MAX_NAME_LENGTH}
          onClose={closeAction}
          onSubmit={async (name) => {
            open(await createNewProject(name))
          }}
        />
      )}

      {action?.kind === 'backup' && (
        <BottomSheet title="Backup" onClose={closeAction}>
          <p className="mb-4 text-sm text-slate-400">
            Projects live in this browser only. Export them to a JSON file to keep a copy, and import it here or on
            another device. Imported projects never overwrite existing ones.
          </p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={!projects?.length}
              className="rounded-lg bg-slate-700 py-3 hover:bg-slate-600 disabled:opacity-40"
              onClick={() => void runExport()}
            >
              Export all projects
            </button>
            <button
              type="button"
              className="rounded-lg bg-slate-700 py-3 hover:bg-slate-600"
              onClick={() => {
                closeAction()
                setNotice(null)
                fileRef.current?.click()
              }}
            >
              Import from file
            </button>
          </div>
        </BottomSheet>
      )}

      {action?.kind === 'menu' && (
        <BottomSheet title={action.project.name} onClose={closeAction}>
          <div className="flex flex-col gap-2">
            <button type="button" className="rounded-lg bg-slate-700 py-3 hover:bg-slate-600" onClick={() => setAction({ kind: 'rename', project: action.project })}>
              Rename
            </button>
            <button
              type="button"
              className="rounded-lg bg-slate-700 py-3 hover:bg-slate-600"
              onClick={async () => {
                await duplicateProject(action.project.id)
                closeAction()
                await refresh()
              }}
            >
              Duplicate
            </button>
            <button type="button" className="rounded-lg bg-red-600/90 py-3 text-white hover:bg-red-500" onClick={() => setAction({ kind: 'delete', project: action.project })}>
              Delete
            </button>
          </div>
        </BottomSheet>
      )}

      {action?.kind === 'rename' && (
        <TextPrompt
          title="Rename project"
          initial={action.project.name}
          submitLabel="Rename"
          maxLength={MAX_NAME_LENGTH}
          onClose={closeAction}
          onSubmit={async (name) => {
            await renameProject(action.project.id, name)
            await refresh()
          }}
        />
      )}

      {action?.kind === 'delete' && (
        <ConfirmSheet
          title="Delete project"
          message={`Delete "${action.project.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          onClose={closeAction}
          onConfirm={() => void deleteProject(action.project.id).then(refresh)}
        />
      )}
    </div>
  )
}
