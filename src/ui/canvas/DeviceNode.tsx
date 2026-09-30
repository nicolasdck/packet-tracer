import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { DeviceKind } from '../../engine'
import { DeviceIcon } from '../components/DeviceIcon'
import { ANCHOR, ICON_SIZE, NODE_WIDTH } from './geometry'

export type DeviceNodeData = {
  label: string
  kind: DeviceKind
  selected: boolean
  /** Highlighted as link wizard origin. */
  linkOrigin: boolean
}

export type DeviceNodeType = Node<DeviceNodeData, 'device'>

// Edges are drawn center to center; handles only exist so React Flow can render them.
const hiddenHandle = {
  top: ANCHOR.y,
  left: '50%',
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  border: 0,
  opacity: 0,
  pointerEvents: 'none',
} as const

export function DeviceNode({ data }: NodeProps<DeviceNodeType>) {
  const ring = data.linkOrigin
    ? 'ring-2 ring-amber-400'
    : data.selected
      ? 'ring-2 ring-sky-400'
      : 'ring-0'
  return (
    <div className="flex flex-col items-center" style={{ width: NODE_WIDTH }}>
      <div className={`rounded-xl bg-slate-900/40 ${ring}`} style={{ width: ICON_SIZE, height: ICON_SIZE }}>
        <DeviceIcon kind={data.kind} className="h-full w-full" />
      </div>
      <div className="mt-1 max-w-full truncate rounded px-1 text-center text-xs font-medium text-slate-200">
        {data.label}
      </div>
      <Handle type="source" position={Position.Top} style={hiddenHandle} isConnectable={false} />
      <Handle type="target" position={Position.Top} style={hiddenHandle} isConnectable={false} />
    </div>
  )
}
