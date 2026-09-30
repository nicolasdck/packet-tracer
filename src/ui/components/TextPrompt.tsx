import { useState, type FormEvent } from 'react'
import { BottomSheet } from './BottomSheet'

interface Props {
  title: string
  initial: string
  submitLabel: string
  maxLength?: number
  /** Returns an error message to keep the prompt open, or nothing on success. */
  onSubmit(value: string): string | void | Promise<string | void>
  onClose(): void
}

export function TextPrompt({ title, initial, submitLabel, maxLength, onSubmit, onClose }: Props) {
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!value.trim()) return setError('Name cannot be empty')
    const result = await onSubmit(value.trim())
    if (result) setError(result)
    else onClose()
  }

  return (
    <BottomSheet title={title} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          autoFocus
          value={value}
          maxLength={maxLength}
          onChange={(e) => {
            setValue(e.target.value)
            setError(null)
          }}
          onFocus={(e) => e.target.select()}
          className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2.5 text-slate-100 outline-none focus:border-sky-500"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button type="submit" className="rounded-lg bg-sky-600 py-2.5 font-medium text-white hover:bg-sky-500">
          {submitLabel}
        </button>
      </form>
    </BottomSheet>
  )
}
