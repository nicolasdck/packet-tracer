import { useState } from 'react'
import { evaluateLab, exportLab, type LabProgress, type Project } from '../../engine'
import { BottomSheet } from '../components/BottomSheet'
import { saveFile } from '../persistence/saveFile'

/** Instructions of the lab and their check, on demand. */
export function LabPanel({ project, onClose }: { project: Project; onClose(): void }) {
  const lab = project.lab!
  // Checked when opened, then again with the button: pings are simulated, so not on every change.
  const [progress, setProgress] = useState<LabProgress>(() => evaluateLab(project, lab))
  const [hints, setHints] = useState<Set<string>>(new Set())
  const complete = progress.done === progress.total

  return (
    <BottomSheet title={lab.title} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-400">{lab.summary}</p>
      <div className="mb-3 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-700" role="progressbar" aria-valuenow={progress.done} aria-valuemax={progress.total}>
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
        </div>
        <span className="text-sm text-slate-300">
          {progress.done}/{progress.total}
        </span>
      </div>
      {complete && (
        <p className="mb-3 rounded-lg bg-emerald-950 px-3 py-2 text-sm font-medium text-emerald-300">Lab complete — well done!</p>
      )}
      <ol className="mb-4 flex flex-col gap-2">
        {lab.tasks.map((task, i) => {
          const result = progress.results[task.id]
          return (
            <li key={task.id} className="rounded-lg bg-slate-900 px-3 py-2">
              <div className="flex gap-2">
                <span aria-label={result?.ok ? 'done' : 'not done'} className={result?.ok ? 'text-emerald-400' : 'text-slate-500'}>
                  {result?.ok ? '✓' : '○'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm ${result?.ok ? 'text-slate-400 line-through' : 'text-slate-100'}`}>
                    {i + 1}. {task.text}
                  </div>
                  {!result?.ok && result?.detail && <div className="mt-0.5 text-xs text-amber-300">{result.detail}</div>}
                  {task.hint && !result?.ok && (
                    hints.has(task.id) ? (
                      <div className="mt-1 font-mono text-xs text-sky-300">{task.hint}</div>
                    ) : (
                      <button type="button" onClick={() => setHints(new Set([...hints, task.id]))} className="mt-1 text-xs text-sky-400 hover:underline">
                        Show hint
                      </button>
                    )
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setProgress(evaluateLab(project, lab))}
          className="flex-1 rounded-lg bg-sky-600 py-2.5 font-medium text-white hover:bg-sky-500"
        >
          Check
        </button>
        <button
          type="button"
          onClick={() => void saveFile(`${lab.id}.lab.json`, JSON.stringify(exportLab(project), null, 2))}
          className="rounded-lg bg-slate-700 px-4 py-2.5 text-sm text-slate-100 hover:bg-slate-600"
          title="Share this network and its tasks as a lab file"
        >
          Export
        </button>
      </div>
    </BottomSheet>
  )
}
