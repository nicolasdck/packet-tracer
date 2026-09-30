import type { PointerEvent } from 'react'

interface Props {
  onTab?(): void
  onHelp?(): void
  onUp(): void
  onDown(): void
  onCtrlZ?(): void
  onCopy?(): void
  onPaste?(): void
}

const key =
  'flex-1 rounded-md bg-slate-700 py-2 font-mono text-sm text-slate-100 active:bg-slate-500 select-none'
const small = `${key} text-xs`

/** Keys missing from mobile keyboards, shown above the keyboard. Absent handlers hide their key. */
export function QuickKeys({ onTab, onHelp, onUp, onDown, onCtrlZ, onCopy, onPaste }: Props) {
  // preventDefault on pointerdown keeps the focus (and the keyboard) on the input,
  // and keeps a text selection alive for Copy.
  const keep = (e: PointerEvent) => e.preventDefault()
  return (
    <div className="flex gap-1.5 border-t border-slate-800 bg-slate-900 px-2 py-1.5">
      {onTab && <button type="button" className={key} onPointerDown={keep} onClick={onTab}>Tab</button>}
      {onHelp && <button type="button" className={key} onPointerDown={keep} onClick={onHelp}>?</button>}
      <button type="button" className={key} onPointerDown={keep} onClick={onUp} aria-label="Previous command">↑</button>
      <button type="button" className={key} onPointerDown={keep} onClick={onDown} aria-label="Next command">↓</button>
      {onCtrlZ && <button type="button" className={small} onPointerDown={keep} onClick={onCtrlZ}>^Z</button>}
      {onCopy && <button type="button" className={small} onPointerDown={keep} onClick={onCopy}>Copy</button>}
      {onPaste && <button type="button" className={small} onPointerDown={keep} onClick={onPaste}>Paste</button>}
    </div>
  )
}
