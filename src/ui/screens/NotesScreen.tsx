import { useEffect, useState } from 'react'
import { MAX_NOTE_NAME, addNote, deleteNote, updateNote, type Project } from '../../engine'
import { CodeArea } from '../components/CodeArea'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { useProjectStore } from '../store/projectStore'
import { copyText } from '../terminal/clipboard'
import { useVisualViewport } from '../terminal/useVisualViewport'

const NOTICE_MS = 1800

/** Notepad of the project: configurations to copy into a console, and Python scripts. */
export function NotesScreen({ project, onClose }: { project: Project; onClose(): void }) {
  const apply = useProjectStore((s) => s.apply)
  const viewport = useVisualViewport()
  const [openId, setOpenId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const note = project.notes.find((n) => n.id === openId)

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  function create() {
    const id = crypto.randomUUID()
    apply((p) => addNote(p, { id, name: `Note ${p.notes.length + 1}`, text: '' }))
    setOpenId(id)
  }

  return (
    <div
      className="fixed inset-x-0 z-40 flex flex-col bg-slate-900 text-slate-100"
      style={{ top: viewport.offsetTop, height: viewport.height }}
    >
      <header className="flex items-center gap-2 border-b border-slate-800 px-2 pt-[env(safe-area-inset-top)]">
        <button
          type="button"
          onClick={() => (note ? setOpenId(null) : onClose())}
          className="rounded-lg px-3 py-3 text-slate-300 hover:bg-slate-800"
          aria-label={note ? 'Back to notes' : 'Back to canvas'}
        >
          ←
        </button>
        {note ? (
          <input
            value={note.name}
            maxLength={MAX_NOTE_NAME}
            onChange={(e) => apply((p) => updateNote(p, note.id, { name: e.target.value }))}
            aria-label="Note name"
            className="min-w-0 flex-1 rounded bg-transparent px-1 py-1 font-semibold outline-none focus:bg-slate-800"
          />
        ) : (
          <h1 className="flex-1 font-semibold">Notes</h1>
        )}
        {note ? (
          <>
            <button
              type="button"
              onClick={async () => setNotice((await copyText(note.text)) ? 'Copied' : 'Copy failed')}
              className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600"
            >
              Copy
            </button>
            <button type="button" onClick={() => setConfirmDelete(true)} className="rounded-lg px-3 py-1.5 text-sm text-red-400 hover:bg-slate-800">
              Delete
            </button>
          </>
        ) : (
          <button type="button" onClick={create} className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500">
            + New
          </button>
        )}
      </header>

      {note ? (
        <CodeArea
          label="Note text"
          value={note.text}
          onChange={(text) => apply((p) => updateNote(p, note.id, { text }))}
          placeholder={'enable\nconfigure terminal\nhostname R1\n...'}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {project.notes.length === 0 && (
            <p className="mt-12 text-center text-sm text-slate-400">
              Write configurations here and copy them into a console with Paste.
              <br />
              Python scripts for a PC&apos;s Programming tab are notes too.
            </p>
          )}
          <ul className="mx-auto flex max-w-2xl flex-col gap-2">
            {project.notes.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(n.id)}
                  className="w-full rounded-xl bg-slate-800 px-4 py-3 text-left hover:bg-slate-700/60"
                >
                  <div className="truncate font-medium">{n.name}</div>
                  <div className="truncate font-mono text-xs text-slate-400">{n.text.split('\n')[0] || 'Empty'}</div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {notice && (
        <div role="status" className="pointer-events-none fixed inset-x-0 top-16 z-50 flex justify-center">
          <span className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm text-slate-100 shadow-lg">{notice}</span>
        </div>
      )}
      {confirmDelete && note && (
        <ConfirmSheet
          title="Delete note"
          message={`Delete "${note.name}"?`}
          confirmLabel="Delete"
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => {
            apply((p) => deleteNote(p, note.id))
            setOpenId(null)
          }}
        />
      )}
    </div>
  )
}
