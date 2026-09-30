import { useReactFlow } from '@xyflow/react'
import { CATALOG, DEVICE_KINDS, addDevice, type DeviceKind, type Position, type Project } from '../../engine'
import { BottomSheet } from '../components/BottomSheet'
import { DeviceIcon } from '../components/DeviceIcon'
import { useProjectStore } from '../store/projectStore'
import { ANCHOR } from './geometry'

const MIN_GAP = 40

/** Shifts the position diagonally until it no longer overlaps another device. */
function freeSpot(project: Project, pos: Position): Position {
  const devices = Object.values(project.devices)
  let { x, y } = pos
  for (let i = 0; i < 20; i++) {
    if (!devices.some((d) => Math.abs(d.position.x - x) < MIN_GAP && Math.abs(d.position.y - y) < MIN_GAP)) break
    x += MIN_GAP
    y += MIN_GAP
  }
  return { x, y }
}

export function Palette({ onClose }: { onClose(): void }) {
  const apply = useProjectStore((s) => s.apply)
  const { screenToFlowPosition } = useReactFlow()

  function add(kind: DeviceKind) {
    const rect = document.querySelector('.react-flow')?.getBoundingClientRect()
    const center = rect
      ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      : { x: 0, y: 0 }
    const target = { x: Math.round(center.x - ANCHOR.x), y: Math.round(center.y - ANCHOR.y) }
    apply((p) => addDevice(p, kind, freeSpot(p, target)).project)
    onClose()
  }

  return (
    <BottomSheet title="Add device" onClose={onClose}>
      <div className="grid grid-cols-3 gap-3">
        {DEVICE_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => add(kind)}
            className="flex flex-col items-center gap-1 rounded-xl bg-slate-700/60 p-3 text-center text-xs text-slate-200 hover:bg-slate-700 active:bg-slate-600"
          >
            <DeviceIcon kind={kind} className="h-12 w-12" />
            {CATALOG[kind].displayName}
          </button>
        ))}
      </div>
    </BottomSheet>
  )
}
