import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { QuickKeys } from './QuickKeys'

interface Props {
  lines: string[]
  prompt: string
  /** Hide the typed text (password prompts). */
  masked?: boolean
  history: string[]
  onSubmit(line: string): void
  /** `?` help; when absent, "?" is typed like any other character. */
  onHelp?(line: string): void
  /** Tab completion; returns the completed line or null. */
  onComplete?(line: string): string | null
  onCtrlZ?(): void
  onCopy?(): void
  /** Paste; `insert` adds text to the input line (the part of the paste not yet executed). */
  onPaste?(insert: (text: string) => void): void
}

/** Scrollback + input line + mobile quick keys. Knows nothing about IOS. */
export function ConsoleView({
  lines,
  prompt,
  masked = false,
  history,
  onSubmit,
  onHelp,
  onComplete,
  onCtrlZ,
  onCopy,
  onPaste,
}: Props) {
  const [input, setInput] = useState('')
  /** Position in the history while browsing with ↑/↓ (null = editing a new line). */
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines, input])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function submit() {
    onSubmit(input)
    setInput('')
    setHistoryIndex(null)
  }

  function tab() {
    const completed = onComplete?.(input) ?? null
    if (completed !== null) setInput(completed)
  }

  function ctrlZ() {
    onCtrlZ?.()
    setInput('')
  }

  function browse(direction: -1 | 1) {
    if (!history.length || masked) return
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
      submit()
    } else if (e.key === 'Tab' && onComplete) {
      e.preventDefault()
      tab()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      browse(-1)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      browse(1)
    } else if (onCtrlZ && e.ctrlKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault()
      ctrlZ()
    }
  }

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    // Like IOS, "?" is never inserted: it shows help for what is typed before it.
    // Detected here rather than on keydown because mobile keyboards often don't report the key.
    const q = onHelp && !masked ? value.indexOf('?') : -1
    if (q !== -1) {
      const before = value.slice(0, q)
      onHelp!(before)
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
          <pre className="whitespace-pre">{lines.join('\n')}</pre>
        </div>
        <div className="flex items-center">
          <span className="whitespace-pre">{prompt}</span>
          <input
            ref={inputRef}
            value={input}
            onChange={onChange}
            onKeyDown={onKeyDown}
            type={masked ? 'password' : 'text'}
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
        onTab={onComplete ? tab : undefined}
        onHelp={onHelp ? () => onHelp(input) : undefined}
        onUp={() => browse(-1)}
        onDown={() => browse(1)}
        onCtrlZ={onCtrlZ ? ctrlZ : undefined}
        onCopy={onCopy}
        onPaste={
          onPaste
            ? () =>
                onPaste((text) => {
                  setInput((current) => current + text)
                  inputRef.current?.focus()
                })
            : undefined
        }
      />
    </div>
  )
}
