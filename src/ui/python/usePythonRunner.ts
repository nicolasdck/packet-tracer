import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project } from '../../engine'
import type { WorkerIn, WorkerOut } from './protocol'

export interface OutputChunk {
  stream: 'stdout' | 'stderr' | 'info'
  text: string
}

interface Listeners {
  status(text: string | null): void
  chunk(chunk: OutputChunk): void
  done(project: Project, ok: boolean): void
}

/** New Python worker, wired to its listeners once and for all. */
function spawnWorker(on: Listeners): Worker {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  worker.addEventListener('message', (event: MessageEvent<WorkerOut>) => {
    const m = event.data
    if (m.type === 'status') on.status(m.text)
    else if (m.type === 'stdout' || m.type === 'stderr') on.chunk({ stream: m.type, text: m.text })
    else on.done(m.project, m.ok)
  })
  worker.addEventListener('error', (event) => {
    on.chunk({ stream: 'stderr', text: event.message || 'The Python worker crashed.' })
    on.status(null)
  })
  return worker
}

/** Runs Python scripts in a worker; Stop terminates it (the next run starts a new one). */
export function usePythonRunner(onDone: (project: Project, ok: boolean) => void) {
  const workerRef = useRef<Worker | null>(null)
  const [output, setOutput] = useState<OutputChunk[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const doneRef = useRef(onDone)

  useEffect(() => {
    doneRef.current = onDone
  }, [onDone])

  useEffect(() => () => workerRef.current?.terminate(), [])

  const run = useCallback((project: Project, hostId: string, code: string) => {
    const worker =
      workerRef.current ??
      spawnWorker({
        status: (text) => {
          setStatus(text)
          if (text === null) setRunning(false)
        },
        chunk: (chunk) => setOutput((o) => [...o, chunk]),
        done: (result, ok) => {
          setRunning(false)
          setStatus(null)
          doneRef.current(result, ok)
        },
      })
    workerRef.current = worker
    setOutput([])
    setRunning(true)
    const message: WorkerIn = { type: 'run', project, hostId, code }
    worker.postMessage(message)
  }, [])

  const stop = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    setRunning(false)
    setStatus(null)
    setOutput((o) => [...o, { stream: 'info', text: 'Stopped. Changes made by this run were discarded.' }])
  }, [])

  const clear = useCallback(() => setOutput([]), [])

  return { output, status, running, run, stop, clear }
}
