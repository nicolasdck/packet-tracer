import { useRef, useState } from 'react'
import { LABS, LabFileError, type LabDefinition, type Project } from '../../engine'
import { createLabProject, importLabFile } from '../persistence/db'

const LEVELS: { id: LabDefinition['info']['level']; label: string }[] = [
  { id: 'beginner', label: 'Beginner' },
  { id: 'intermediate', label: 'Intermediate' },
  { id: 'advanced', label: 'Advanced' },
]

/** Catalogue of guided labs: each one starts a new project with its instructions. */
export function LabsScreen({ onOpen, onClose }: { onOpen(project: Project): void; onClose(): void }) {
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function importFile(file: File) {
    try {
      onOpen(await importLabFile(await file.text()))
    } catch (e) {
      setError(e instanceof LabFileError ? e.message : 'Import failed.')
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-900 text-slate-100">
      <header className="flex items-center gap-2 border-b border-slate-800 px-2 pt-[env(safe-area-inset-top)]">
        <button type="button" onClick={onClose} className="rounded-lg px-3 py-3 text-slate-300 hover:bg-slate-800" aria-label="Back to projects">
          ←
        </button>
        <h1 className="flex-1 font-semibold">Labs</h1>
        <button type="button" onClick={() => fileRef.current?.click()} className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
          Import lab
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void importFile(file)
          }}
        />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-6 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <p className="text-sm text-slate-400">
            A lab gives you a ready-made network and a list of tasks. Do them in the CLI, then tap{' '}
            <span className="font-medium text-slate-200">Check</span> to see what is done.
          </p>
          {error && <p className="rounded-lg bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}
          {LEVELS.map((level) => (
            <section key={level.id} className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold tracking-wide text-slate-400 uppercase">{level.label}</h2>
              {LABS.filter((l) => l.info.level === level.id).map((def) => (
                <button
                  key={def.info.id}
                  type="button"
                  onClick={async () => onOpen(await createLabProject(def))}
                  className="rounded-xl bg-slate-800 px-4 py-3 text-left hover:bg-slate-700/60"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{def.info.title}</span>
                    <span className="text-xs text-slate-400">{def.info.tasks.length} tasks</span>
                  </div>
                  <div className="mt-0.5 text-sm text-slate-400">{def.info.summary}</div>
                </button>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
