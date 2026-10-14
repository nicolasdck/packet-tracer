import type { KeyboardEvent } from 'react'

interface Props {
  value: string
  onChange(value: string): void
  placeholder?: string
  /** Accessible name. */
  label: string
}

const INDENT = '    '

/** Plain text editor for configurations and scripts: monospace, no autocorrect, Tab indents. */
export function CodeArea({ value, onChange, placeholder, label }: Props) {
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Tab') return
    e.preventDefault()
    const el = e.currentTarget
    const { selectionStart, selectionEnd } = el
    onChange(value.slice(0, selectionStart) + INDENT + value.slice(selectionEnd))
    requestAnimationFrame(() => el.setSelectionRange(selectionStart + INDENT.length, selectionStart + INDENT.length))
  }

  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      aria-label={label}
      wrap="off"
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      autoComplete="off"
      className="min-h-0 w-full flex-1 resize-none bg-black p-3 font-mono text-[12px] leading-[1.45] text-slate-100 outline-none sm:text-sm"
    />
  )
}
