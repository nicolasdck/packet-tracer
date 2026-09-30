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
