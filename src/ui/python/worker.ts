/// <reference lib="webworker" />
import type { PyodideInterface } from 'pyodide'
import type { Project } from '../../engine'
import { createBridge, newRun, type RunState } from './bridge'
import netmikoSource from './netmiko.py?raw'
import type { WorkerIn, WorkerOut } from './protocol'

/**
 * Runs Python scripts with Pyodide, next to its own copy of the simulation
 * engine: the script drives the network synchronously without freezing the UI,
 * and an endless loop is stopped by terminating the worker.
 */

const scope = self as unknown as DedicatedWorkerGlobalScope
const post = (message: WorkerOut) => scope.postMessage(message)

let run: RunState = newRun(null as unknown as Project, '')
let ready: Promise<PyodideInterface> | null = null

function loadPython(): Promise<PyodideInterface> {
  ready ??= (async () => {
    const base = `${scope.location.origin}/pyodide/`
    const { loadPyodide } = (await import(/* @vite-ignore */ `${base}pyodide.mjs`)) as typeof import('pyodide')
    const py = await loadPyodide({ indexURL: base })
    py.registerJsModule('_sim', createBridge(() => run))
    py.FS.writeFile('/home/pyodide/netmiko.py', netmikoSource)
    py.setStdout({ batched: (text) => post({ type: 'stdout', text }) })
    py.setStderr({ batched: (text) => post({ type: 'stderr', text }) })
    return py
  })()
  return ready
}

scope.onmessage = async (event: MessageEvent<WorkerIn>) => {
  const message = event.data
  post({ type: 'status', text: 'Loading Python…' })
  let py: PyodideInterface
  try {
    py = await loadPython()
  } catch (error) {
    post({ type: 'stderr', text: `Python could not be loaded: ${String(error)}` })
    post({ type: 'done', ok: false, project: message.project })
    return
  }
  run = newRun(message.project, message.hostId)
  post({ type: 'status', text: 'Running…' })
  // Each run gets fresh globals, like a new python process.
  const globals = py.globals.get('dict')()
  try {
    await py.runPythonAsync(message.code, { globals })
    post({ type: 'done', ok: true, project: run.project })
  } catch (error) {
    post({ type: 'stderr', text: error instanceof Error ? error.message : String(error) })
    post({ type: 'done', ok: false, project: run.project })
  } finally {
    globals.destroy()
  }
}
