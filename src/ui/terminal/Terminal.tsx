import { useEffect, useState } from 'react'
import { getPrompt, type Project } from '../../engine'
import { BottomSheet } from '../components/BottomSheet'
import { useCliStore, type Terminal as TerminalState } from '../store/cliStore'
import { copyText, readText } from './clipboard'
import { ConsoleView } from './ConsoleView'

interface Props {
  project: Project
  terminal: TerminalState
}

const NOTICE_MS = 1800

/** Console of an IOS device. */
export function Terminal({ project, terminal }: Props) {
  const { submit, ctrlZ, help, complete, paste } = useCliStore()
  const prompt = getPrompt(project, terminal.session)
  const [notice, setNotice] = useState<string | null>(null)
  /** Set when the clipboard cannot be read: the user pastes into a text box instead. */
  const [manualPaste, setManualPaste] = useState<((text: string) => void) | null>(null)
  const [pasteText, setPasteText] = useState('')

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  async function onCopy() {
    const selection = window.getSelection()?.toString() ?? ''
    const text = selection || terminal.lastOutput.join('\n')
    if (!text.trim()) return setNotice('Nothing to copy')
    const ok = await copyText(text)
    setNotice(ok ? (selection ? 'Selection copied' : 'Last output copied') : 'Copy failed')
  }

  async function onPaste(insert: (text: string) => void) {
    const text = await readText()
    if (text === null) {
      setPasteText('')
      setManualPaste(() => insert)
      return
    }
    insert(paste(text))
  }

  return (
    <>
      <ConsoleView
        lines={terminal.lines}
        prompt={prompt.text}
        masked={prompt.masked}
        history={terminal.session.history}
        onSubmit={submit}
        onHelp={help}
        onComplete={complete}
        onCtrlZ={ctrlZ}
        onCopy={onCopy}
        onPaste={onPaste}
      />
      {notice && (
        <div role="status" className="pointer-events-none fixed inset-x-0 top-16 z-50 flex justify-center">
          <span className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm text-slate-100 shadow-lg">{notice}</span>
        </div>
      )}
      {manualPaste && (
        <BottomSheet title="Paste configuration" onClose={() => setManualPaste(null)}>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              const insert = manualPaste
              setManualPaste(null)
              // A pasted block is typed line by line; the text box content always ends a line.
              insert(paste(pasteText.endsWith('\n') ? pasteText : pasteText + '\n'))
            }}
          >
            <p className="text-sm text-slate-400">
              The clipboard can't be read here. Paste your commands below: each line is typed in order.
            </p>
            <textarea
              autoFocus
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={10}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="rounded-lg border border-slate-600 bg-slate-950 p-2 font-mono text-sm text-slate-100 outline-none focus:border-sky-500"
            />
            <button type="submit" className="rounded-lg bg-sky-600 py-2.5 font-medium text-white hover:bg-sky-500">
              Run
            </button>
          </form>
        </BottomSheet>
      )}
    </>
  )
}
