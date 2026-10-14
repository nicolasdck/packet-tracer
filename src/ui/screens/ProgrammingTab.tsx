import { useState } from 'react'
import { addNote, updateNote, type HostDevice, type Project } from '../../engine'
import { CodeArea } from '../components/CodeArea'
import { usePythonRunner } from '../python/usePythonRunner'
import { useProjectStore } from '../store/projectStore'

const TEMPLATE = `# Python 3 — runs on this PC.
# netmiko connects over SSH: the device must be reachable from this PC
# and configured for SSH (hostname, ip domain-name, crypto key generate rsa,
# username ... secret ..., line vty 0 4 / login local / transport input ssh).
from netmiko import ConnectHandler

devices = ["192.168.1.1"]

for ip in devices:
    with ConnectHandler(device_type="cisco_ios", host=ip,
                        username="admin", password="cisco", secret="class") as conn:
        conn.enable()
        print(conn.send_config_set([
            "interface GigabitEthernet0/1",
            "description configured by Python",
        ]))
        print(conn.send_command("show ip interface brief"))
`

/** Python scripts (project notes) run from this PC, with a Netmiko-like library. */
export function ProgrammingTab({ project, device }: { project: Project; device: HostDevice }) {
  const apply = useProjectStore((s) => s.apply)
  const [scriptId, setScriptId] = useState<string | null>(
    () => (project.notes.find((n) => n.name.endsWith('.py')) ?? project.notes[0])?.id ?? null,
  )
  // Only device configurations change: notes edited meanwhile are kept.
  const runner = usePythonRunner((result) => apply((p) => ({ ...p, devices: result.devices })))
  const script = project.notes.find((n) => n.id === scriptId)

  function create() {
    const id = crypto.randomUUID()
    apply((p) => addNote(p, { id, name: `script${p.notes.filter((n) => n.name.endsWith('.py')).length + 1}.py`, text: TEMPLATE }))
    setScriptId(id)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-slate-800 px-2 py-2">
        <select
          value={script?.id ?? ''}
          onChange={(e) => setScriptId(e.target.value || null)}
          aria-label="Script"
          className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
        >
          {!script && <option value="">No script</option>}
          {project.notes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={create} className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600">
          + New
        </button>
        {runner.running ? (
          <button type="button" onClick={runner.stop} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white">
            Stop
          </button>
        ) : (
          <button
            type="button"
            disabled={!script}
            onClick={() => script && runner.run(project, device.id, script.text)}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            ▶ Run
          </button>
        )}
      </div>

      {script ? (
        <div className="flex min-h-0 flex-[3] flex-col">
          <CodeArea label="Script" value={script.text} onChange={(text) => apply((p) => updateNote(p, script.id, { text }))} />
        </div>
      ) : (
        <div className="flex-[3] p-6 text-center text-sm text-slate-400">
          Create a script with <span className="font-medium text-slate-200">+ New</span>. Scripts are saved in the project notes.
        </div>
      )}

      <div className="flex min-h-0 flex-[2] flex-col border-t border-slate-800">
        <div className="flex items-center justify-between bg-slate-950 px-3 py-1 text-xs text-slate-400">
          <span>{runner.status ?? 'Output'}</span>
          {runner.output.length > 0 && !runner.running && (
            <button type="button" onClick={runner.clear} className="hover:text-slate-200">
              Clear
            </button>
          )}
        </div>
        <pre className="min-h-0 flex-1 overflow-auto bg-black px-3 py-2 font-mono text-[12px] leading-[1.35] whitespace-pre sm:text-sm">
          {runner.status === 'Loading Python…' && runner.output.length === 0 && (
            <span className="text-slate-500">First run downloads Python (about 13 MB), then it works offline.{'\n'}</span>
          )}
          {runner.output.map((chunk, i) => (
            <span key={i} className={chunk.stream === 'stderr' ? 'text-red-400' : chunk.stream === 'info' ? 'text-amber-300' : 'text-slate-200'}>
              {chunk.text}
              {'\n'}
            </span>
          ))}
        </pre>
      </div>
    </div>
  )
}
