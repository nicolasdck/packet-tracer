import { dismissInstall, promptInstall, useInstallMode } from '../pwa/install'

/** Offers to install the app; hidden once installed or dismissed. */
export function InstallBanner() {
  const mode = useInstallMode()
  if (mode === 'none') return null

  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl border border-sky-800 bg-sky-950 px-4 py-3 text-sm text-sky-100">
      <img src="/icon-192.png" alt="" className="h-10 w-10 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">Install Mini Packet Tracer</div>
        {mode === 'native' ? (
          <div className="text-sky-300">Works offline, opens full screen.</div>
        ) : (
          <div className="text-sky-300">
            Tap <span className="font-medium text-sky-100">Share</span>, then{' '}
            <span className="font-medium text-sky-100">Add to Home Screen</span>.
          </div>
        )}
      </div>
      {mode === 'native' && (
        <button
          type="button"
          onClick={() => void promptInstall()}
          className="rounded-lg bg-sky-600 px-3 py-1.5 font-medium text-white hover:bg-sky-500"
        >
          Install
        </button>
      )}
      <button type="button" onClick={dismissInstall} className="px-1 text-sky-300 hover:text-white" aria-label="Dismiss">
        ✕
      </button>
    </div>
  )
}
