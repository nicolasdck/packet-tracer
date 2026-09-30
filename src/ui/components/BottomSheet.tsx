import { useEffect, type ReactNode } from 'react'

interface Props {
  title: string
  onClose(): void
  children: ReactNode
}

/** Bottom sheet on mobile, centered dialog on wider screens. */
export function BottomSheet({ title, onClose, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative flex max-h-[85dvh] w-full flex-col rounded-t-2xl bg-slate-800 pb-[env(safe-area-inset-bottom)] shadow-xl md:max-w-md md:rounded-2xl md:pb-0">
        <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-100">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-700 hover:text-slate-100" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}
