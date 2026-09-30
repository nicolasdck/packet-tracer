import { BaseEdge, EdgeLabelRenderer, useInternalNode, type Edge, type EdgeProps } from '@xyflow/react'
import { ANCHOR } from './geometry'

export type LinkEdgeData = {
  sourcePort: string
  targetPort: string
  /** Perpendicular offset in px, to separate parallel links. */
  offset: number
  selected: boolean
}

export type LinkEdgeType = Edge<LinkEdgeData, 'link'>

const LABEL_DISTANCE = 52

function PortLabel({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <div
      className="nodrag nopan pointer-events-none absolute rounded bg-slate-900/90 px-1 text-[10px] leading-4 text-slate-300"
      style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
    >
      {text}
    </div>
  )
}

export function LinkEdge({ id, source, target, data }: EdgeProps<LinkEdgeType>) {
  const s = useInternalNode(source)
  const t = useInternalNode(target)
  if (!s || !t || !data) return null

  const sx0 = s.internals.positionAbsolute.x + ANCHOR.x
  const sy0 = s.internals.positionAbsolute.y + ANCHOR.y
  const tx0 = t.internals.positionAbsolute.x + ANCHOR.x
  const ty0 = t.internals.positionAbsolute.y + ANCHOR.y
  const dx = tx0 - sx0
  const dy = ty0 - sy0
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  // Perpendicular shift for parallel links.
  const ox = -uy * data.offset
  const oy = ux * data.offset
  const sx = sx0 + ox
  const sy = sy0 + oy
  const tx = tx0 + ox
  const ty = ty0 + oy
  const d = Math.min(LABEL_DISTANCE, len * 0.4)

  return (
    <>
      <BaseEdge
        id={id}
        path={`M ${sx} ${sy} L ${tx} ${ty}`}
        interactionWidth={24}
        style={{ stroke: data.selected ? '#38bdf8' : '#94a3b8', strokeWidth: data.selected ? 3 : 2 }}
      />
      <EdgeLabelRenderer>
        <PortLabel x={sx + ux * d} y={sy + uy * d} text={data.sourcePort} />
        <PortLabel x={tx - ux * d} y={ty - uy * d} text={data.targetPort} />
      </EdgeLabelRenderer>
    </>
  )
}
