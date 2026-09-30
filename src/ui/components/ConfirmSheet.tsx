import { BottomSheet } from './BottomSheet'

interface Props {
  title: string
  message: string
  confirmLabel: string
  onConfirm(): void
  onClose(): void
}

export function ConfirmSheet({ title, message, confirmLabel, onConfirm, onClose }: Props) {
  return (
    <BottomSheet title={title} onClose={onClose}>
      <p className="mb-4 text-slate-300">{message}</p>
      <div className="flex gap-3">
        <button type="button" onClick={onClose} className="flex-1 rounded-lg bg-slate-700 py-2.5 text-slate-100 hover:bg-slate-600">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            onConfirm()
            onClose()
          }}
          className="flex-1 rounded-lg bg-red-600 py-2.5 font-medium text-white hover:bg-red-500"
        >
          {confirmLabel}
        </button>
      </div>
    </BottomSheet>
  )
}
