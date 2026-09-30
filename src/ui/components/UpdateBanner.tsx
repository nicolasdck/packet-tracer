import { useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { flushAutosave } from '../persistence/autosave'

/** How often an open app checks for a new version. */
const CHECK_INTERVAL_MS = 5 * 60 * 1000

/**
 * Registers the service worker and shows a banner when a new version is
 * available. Installed PWAs rarely check on their own, so we also check
 * periodically and each time the app comes back to the foreground.
 */
export function UpdateBanner() {
  const [updating, setUpdating] = useState(false)
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return
      const check = () => {
        if (navigator.onLine) void registration.update()
      }
      setInterval(check, CHECK_INTERVAL_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
    },
  })

  if (!needRefresh) return null

  return (
    <div
      role="status"
      className="fixed inset-x-3 z-[60] flex items-center gap-3 rounded-xl bg-sky-600 px-4 py-3 text-sm text-white shadow-lg md:inset-x-auto md:right-4 md:max-w-sm"
      style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}
    >
      <span className="flex-1">A new version is available.</span>
      <button
        type="button"
        disabled={updating}
        onClick={async () => {
          setUpdating(true)
          // Don't lose the last edits: the page reloads right after.
          await flushAutosave()
          await updateServiceWorker(true)
        }}
        className="rounded-lg bg-white px-3 py-1.5 font-medium text-sky-700 disabled:opacity-60"
      >
        {updating ? 'Refreshing…' : 'Refresh app'}
      </button>
      <button type="button" onClick={() => setNeedRefresh(false)} className="px-1 text-white/80" aria-label="Dismiss">
        ✕
      </button>
    </div>
  )
}
