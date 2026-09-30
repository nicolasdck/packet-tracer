import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { getPrompt, type Project } from '../../engine'
import { useCliStore, type Terminal as TerminalState } from '../store/cliStore'
import { QuickKeys } from './QuickKeys'

interface Props {
  project: Project
  terminal: TerminalState
}

export function Terminal({ project, terminal }: Props) {
  const { submit, ctrlZ, help, complete } = useCliStore()
  const [input, setInput] = useState('')
  /** Position in the history while browsing with ↑/↓ (null = editing a new line). */
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const prompt = getPrompt(project, terminal.session)
  const history = terminal.session.history

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [terminal.lines, input])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function run() {
    submit(input)
    setInput('')
    setHistoryIndex(null)
  }

  function showHelp(text: string) {
    help(text)
  }

  function tab() {
    const completed = complete(input)
    if (completed !== null) setInput(completed)
  }

  function browse(direction: -1 | 1) {
    if (!history.length || prompt.masked) return
    let next: number | null
    if (historyIndex === null) next = direction === -1 ? history.length - 1 : null
    else next = historyIndex + direction
    if (next !== null && next < 0) next = 0
    if (next !== null && next >= history.length) next = null
    setHistoryIndex(next)
    setInput(next === null ? '' : history[next]!)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      run()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      tab()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      browse(-1)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      browse(1)
    } else if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault()
      ctrlZ()
      setInput('')
    }
  }

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    // Like IOS, "?" is never inserted: it shows help for what is typed before it.
    // Detected here rather than on keydown because mobile keyboards often don't report the key.
    const q = prompt.masked ? -1 : value.indexOf('?')
    if (q !== -1) {
      const before = value.slice(0, q)
      showHelp(before)
      setInput(before + value.slice(q + 1))
      return
    }
    setInput(value)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto bg-black px-3 py-2 font-mono text-[12px] leading-[1.35] text-slate-200 sm:text-sm"
        onClick={() => {
          if (!window.getSelection()?.toString()) inputRef.current?.focus()
        }}
      >
        <div className="overflow-x-auto">
          <pre className="whitespace-pre">{terminal.lines.join('\n')}</pre>
        </div>
        <div className="flex items-center">
          <span className="whitespace-pre">{prompt.text}</span>
          <input
            ref={inputRef}
            value={input}
            onChange={onChange}
            onKeyDown={onKeyDown}
            type={prompt.masked ? 'password' : 'text'}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="send"
            aria-label="Command line"
            className="min-w-0 flex-1 bg-transparent p-0 font-mono text-inherit caret-slate-200 outline-none"
          />
        </div>
      </div>
      <QuickKeys
        onTab={tab}
        onHelp={() => showHelp(input)}
        onUp={() => browse(-1)}
        onDown={() => browse(1)}
        onCtrlZ={() => {
          ctrlZ()
          setInput('')
        }}
      />
    </div>
  )
}
