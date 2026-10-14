// Copies the Pyodide runtime (Python compiled to WebAssembly) into public/pyodide,
// so the app serves it itself and the service worker can cache it for offline use.
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'node_modules', 'pyodide')
const target = join(root, 'public', 'pyodide')
const FILES = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']

mkdirSync(target, { recursive: true })
for (const file of FILES) {
  const from = join(source, file)
  const to = join(target, file)
  // Skip files that are already up to date.
  if (existsSync(to) && statSync(to).size === statSync(from).size) continue
  copyFileSync(from, to)
}
