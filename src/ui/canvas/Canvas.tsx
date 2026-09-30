import {
  Background,
  BackgroundVariant,
  ReactFlow,
  type Dimensions,
  type NodeChange,
  type XYPosition,
} from '@xyflow/react'
import { useMemo, useState } from 'react'
import { interfaceStatus, isIosDevice, moveDevice, shortIfName, type Project } from '../../engine'
import { useCliStore } from '../store/cliStore'
import { usePcStore } from '../store/pcStore'
import { useProjectStore } from '../store/projectStore'
import { useUiStore } from '../store/uiStore'
import { DeviceNode, type DeviceNodeType } from './DeviceNode'
import { LinkEdge, type LinkEdgeType } from './LinkEdge'

const nodeTypes = { device: DeviceNode }
const edgeTypes = { link: LinkEdge }
const PARALLEL_SPACING = 14

function buildEdges(project: Project, selectedLinkId: string | null): LinkEdgeType[] {
  const links = Object.values(project.links)
  // Group links between the same pair of devices to fan them out.
  const groups = new Map<string, string[]>()
  for (const l of links) {
    const key = [l.a.deviceId, l.b.deviceId].sort().join('|')
    groups.set(key, [...(groups.get(key) ?? []), l.id])
  }
  return links.map((l) => {
    const key = [l.a.deviceId, l.b.deviceId].sort().join('|')
    const group = groups.get(key) ?? [l.id]
    // Offsets are defined relative to the sorted pair so reversed links fan out consistently.
    const sign = l.a.deviceId <= l.b.deviceId ? 1 : -1
    const offset = (group.indexOf(l.id) - (group.length - 1) / 2) * PARALLEL_SPACING * sign
    const isUp = (e: typeof l.a) => interfaceStatus(project, e.deviceId, e.port).protocol === 'up'
    return {
      id: l.id,
      type: 'link',
      source: l.a.deviceId,
      target: l.b.deviceId,
      data: {
        sourcePort: shortIfName(l.a.port),
        targetPort: shortIfName(l.b.port),
        offset,
        sourceUp: isUp(l.a),
        targetUp: isUp(l.b),
        selected: l.id === selectedLinkId,
      },
    }
  })
}

export function Canvas({ project }: { project: Project }) {
  const apply = useProjectStore((s) => s.apply)
  const selection = useUiStore((s) => s.selection)
  const linkDraft = useUiStore((s) => s.linkDraft)
  const select = useUiStore((s) => s.select)
  const pickLinkDevice = useUiStore((s) => s.pickLinkDevice)
  const openCli = useCliStore((s) => s.open)
  const openPc = usePcStore((s) => s.open)

  // React Flow owns measurements and in-flight drag positions; the project stores the rest.
  const [measured, setMeasured] = useState<Record<string, Dimensions>>({})
  const [dragging, setDragging] = useState<Record<string, XYPosition>>({})

  const selectedDeviceId = selection?.kind === 'device' ? selection.id : null
  const selectedLinkId = selection?.kind === 'link' ? selection.id : null

  const nodes = useMemo<DeviceNodeType[]>(
    () =>
      Object.values(project.devices).map((d) => ({
        id: d.id,
        type: 'device',
        position: dragging[d.id] ?? d.position,
        measured: measured[d.id],
        data: {
          label: d.label,
          kind: d.kind,
          selected: d.id === selectedDeviceId,
          linkOrigin: linkDraft?.a?.deviceId === d.id,
        },
      })),
    [project.devices, dragging, measured, selectedDeviceId, linkDraft],
  )

  const edges = useMemo(() => buildEdges(project, selectedLinkId), [project, selectedLinkId])

  function onNodesChange(changes: NodeChange<DeviceNodeType>[]) {
    const nextMeasured: Record<string, Dimensions> = {}
    const nextDragging: Record<string, XYPosition> = {}
    const dropped: { id: string; position: XYPosition | undefined }[] = []
    for (const c of changes) {
      if (c.type === 'dimensions' && c.dimensions) nextMeasured[c.id] = c.dimensions
      if (c.type === 'position') {
        if (c.dragging && c.position) nextDragging[c.id] = c.position
        else if (!c.dragging) dropped.push({ id: c.id, position: c.position ?? dragging[c.id] })
      }
    }
    if (Object.keys(nextMeasured).length) setMeasured((m) => ({ ...m, ...nextMeasured }))
    if (dropped.length) {
      // Commit the final position to the project once, on drop.
      apply((p) =>
        dropped.reduce(
          (acc, { id, position }) => (position && acc.devices[id] ? moveDevice(acc, id, position) : acc),
          p,
        ),
      )
    }
    if (Object.keys(nextDragging).length || dropped.length) {
      setDragging((prev) => {
        const next = { ...prev, ...nextDragging }
        for (const { id } of dropped) delete next[id]
        return next
      })
    }
  }

  return (
    <ReactFlow<DeviceNodeType, LinkEdgeType>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={(_, node) => {
        if (linkDraft) return pickLinkDevice(node.id)
        select({ kind: 'device', id: node.id })
        const device = project.devices[node.id]
        if (!device) return
        if (isIosDevice(device)) openCli(node.id)
        else openPc(node.id)
      }}
      onEdgeClick={(_, edge) => {
        if (!linkDraft) select({ kind: 'link', id: edge.id })
      }}
      onPaneClick={() => select(null)}
      nodesConnectable={false}
      elementsSelectable={false}
      deleteKeyCode={null}
      fitView
      fitViewOptions={{ maxZoom: 1, padding: 0.3 }}
      minZoom={0.2}
      maxZoom={2.5}
      colorMode="dark"
      attributionPosition="top-right"
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="#334155" />
    </ReactFlow>
  )
}
