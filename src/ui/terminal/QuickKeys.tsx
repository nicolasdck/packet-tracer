import type { PointerEvent } from 'react'

interface Props {
  onTab(): void
  onHelp(): void
  onUp(): void
  onDown(): void
  onCtrlZ(): void
}

const key =
  'flex-1 rounded-md bg-slate-700 py-2 font-mono text-sm text-slate-100 active:bg-slate-500 select-none'

/** Keys missing from mobile keyboards, shown above the keyboard. */
export function QuickKeys({ onTab, onHelp, onUp, onDown, onCtrlZ }: Props) {
  // preventDefault on pointerdown keeps the focus (and the keyboard) on the input.
  const keep = (e: PointerEvent) => e.preventDefault()
  return (
    <div className="flex gap-1.5 border-t border-slate-800 bg-slate-900 px-2 py-1.5">
      <button type="button" className={key} onPointerDown={keep} onClick={onTab}>Tab</button>
      <button type="button" className={key} onPointerDown={keep} onClick={onHelp}>?</button>
      <button type="button" className={key} onPointerDown={keep} onClick={onUp} aria-label="Previous command">↑</button>
      <button type="button" className={key} onPointerDown={keep} onClick={onDown} aria-label="Next command">↓</button>
      <button type="button" className={key} onPointerDown={keep} onClick={onCtrlZ}>Ctrl+Z</button>
    </div>
  )
}
