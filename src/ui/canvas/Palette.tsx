import { useReactFlow } from '@xyflow/react'
import { MODELS, addDevice, shortIfName, type DeviceModel, type Position, type Project } from '../../engine'
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

/** "24 Fa · 2 Gi": how many ports of each type a model has. */
function portSummary(model: DeviceModel): string {
  const counts = new Map<string, number>()
  for (const port of model.ports) {
    const type = shortIfName(port).replace(/[\d/]+$/, '')
    counts.set(type, (counts.get(type) ?? 0) + 1)
  }
  return [...counts].map(([type, n]) => n + ' ' + type).join(' · ')
}

export function Palette({ onClose }: { onClose(): void }) {
  const apply = useProjectStore((s) => s.apply)
  const { screenToFlowPosition } = useReactFlow()

  function add(model: DeviceModel) {
    const rect = document.querySelector('.react-flow')?.getBoundingClientRect()
    const center = rect
      ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      : { x: 0, y: 0 }
    const target = { x: Math.round(center.x - ANCHOR.x), y: Math.round(center.y - ANCHOR.y) }
    apply((p) => addDevice(p, model.kind, freeSpot(p, target), model.id).project)
    onClose()
  }

  return (
    <BottomSheet title="Add device" onClose={onClose}>
      <div className="grid grid-cols-3 gap-3">
        {MODELS.map((model) => (
          <button
            key={model.id}
            type="button"
            onClick={() => add(model)}
            className="flex flex-col items-center gap-1 rounded-xl bg-slate-700/60 p-3 text-center text-xs text-slate-200 hover:bg-slate-700 active:bg-slate-600"
          >
            <DeviceIcon kind={model.kind} className="h-12 w-12" />
            {model.displayName}
            <span className="text-[10px] text-slate-400">{portSummary(model)}</span>
          </button>
        ))}
      </div>
    </BottomSheet>
  )
}
