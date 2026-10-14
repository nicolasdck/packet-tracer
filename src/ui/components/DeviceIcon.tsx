import type { DeviceKind } from '../../engine'

interface Props {
  kind: DeviceKind
  className?: string
}

/** Simple Cisco-style glyphs, drawn in a 48×48 box. */
export function DeviceIcon({ kind, className }: Props) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      {kind === 'router' && (
        <g>
          <ellipse cx="24" cy="28" rx="20" ry="8" fill="#0369a1" />
          <rect x="4" y="18" width="40" height="10" fill="#0284c7" />
          <ellipse cx="24" cy="18" rx="20" ry="8" fill="#38bdf8" />
          <g stroke="#0c4a6e" strokeWidth="2" strokeLinecap="round" fill="none">
            <path d="M14 15l6 3M34 21l-6-3M34 15l-6 3M14 21l6-3" />
          </g>
        </g>
      )}
      {(kind === 'switch-l2' || kind === 'switch-l3') && (
        <g>
          <rect x="4" y="14" width="40" height="20" rx="3" fill={kind === 'switch-l3' ? '#7c3aed' : '#0284c7'} />
          <g stroke="#e0f2fe" strokeWidth="2" strokeLinecap="round" fill="none">
            <path d="M12 20h16l-3-3M36 28H20l3 3" />
          </g>
          {kind === 'switch-l3' && <text x="38" y="23" fontSize="8" fontWeight="700" fill="#ede9fe" textAnchor="middle">L3</text>}
        </g>
      )}
      {kind === 'wireless-router' && (
        <g>
          <rect x="6" y="26" width="36" height="12" rx="3" fill="#0284c7" />
          <g stroke="#7dd3fc" strokeWidth="2.5" strokeLinecap="round">
            <path d="M14 26V12M34 26V12" />
          </g>
          <g stroke="#e0f2fe" strokeWidth="2" strokeLinecap="round" fill="none">
            <path d="M18 9a9 9 0 0 1 12 0M21 13a4.5 4.5 0 0 1 6 0" />
          </g>
          <g fill="#bbf7d0">
            <circle cx="14" cy="32" r="1.5" />
            <circle cx="19" cy="32" r="1.5" />
            <circle cx="24" cy="32" r="1.5" />
          </g>
        </g>
      )}
      {kind === 'laptop' && (
        <g>
          <rect x="10" y="10" width="28" height="19" rx="2" fill="#475569" />
          <rect x="12.5" y="12.5" width="23" height="14" fill="#7dd3fc" />
          <path d="M5 33h38l-3 4H8z" fill="#64748b" />
        </g>
      )}
      {kind === 'pc' && (
        <g>
          <rect x="7" y="8" width="34" height="24" rx="2" fill="#475569" />
          <rect x="10" y="11" width="28" height="18" fill="#7dd3fc" />
          <rect x="20" y="32" width="8" height="5" fill="#475569" />
          <rect x="13" y="37" width="22" height="3" rx="1" fill="#64748b" />
        </g>
      )}
      {kind === 'server' && (
        <g>
          <rect x="12" y="5" width="24" height="38" rx="2" fill="#475569" />
          <g fill="#94a3b8">
            <rect x="15" y="10" width="18" height="4" />
            <rect x="15" y="17" width="18" height="4" />
            <rect x="15" y="24" width="18" height="4" />
          </g>
          <circle cx="30" cy="37" r="2" fill="#22c55e" />
        </g>
      )}
    </svg>
  )
}
