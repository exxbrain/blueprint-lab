import { useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { tr } from '../../i18n'
import { KINDS, WORKLOADS, isStorage, type BEdge, type BNode, type Result } from './model'

export const NODE_W = 150
export const NODE_H = 74

interface Props {
  nodes: BNode[]
  edges: BEdge[]
  result: Result
  selected: string | null
  onSelect: (id: string | null) => void
  onMove: (id: string, x: number, y: number) => void
  onConnect: (from: string, to: string) => void
  /** Пока прикидка не сделана, нагрузку не показываем */
  hideLoad?: boolean
  /** Компонент перетащили из палитры: координаты центра в системе холста */
  onDropKind?: (kind: string, x: number, y: number) => void
  width?: number
  height?: number
}

export function utilColor(util: number, success: number): string {
  if (success < 0.99 || util >= 1) return 'var(--bad)'
  if (util >= 0.8) return 'var(--warn)'
  return 'var(--ok)'
}

export function BuilderCanvas({
  nodes,
  edges,
  result,
  selected,
  onSelect,
  onMove,
  onConnect,
  hideLoad,
  onDropKind,
  width = 1000,
  height = 540,
}: Props) {
  const rpsText = (v: number) => (hideLoad ? '?' : fmt(v))
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null)
  const [link, setLink] = useState<{ from: string; x: number; y: number } | null>(null)

  const toSvg = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current!
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse())
    return { x: p.x, y: p.y }
  }

  const nodeAt = (x: number, y: number) =>
    nodes.find((n) => x >= n.x && x <= n.x + NODE_W && y >= n.y && y <= n.y + NODE_H)

  const onPointerMove = (e: RPointerEvent) => {
    const p = toSvg(e)
    if (drag.current) {
      const x = Math.max(0, Math.min(width - NODE_W, p.x - drag.current.dx))
      const y = Math.max(0, Math.min(height - NODE_H, p.y - drag.current.dy))
      onMove(drag.current.id, Math.round(x / 10) * 10, Math.round(y / 10) * 10)
    } else if (link) {
      setLink({ ...link, x: p.x, y: p.y })
    }
  }

  const onPointerUp = (e: RPointerEvent) => {
    if (link) {
      const p = toSvg(e)
      const target = nodeAt(p.x, p.y)
      if (target && target.id !== link.from) onConnect(link.from, target.id)
    }
    drag.current = null
    setLink(null)
  }

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]))

  return (
    <svg
      ref={svgRef}
      className="builder-canvas"
      viewBox={`0 0 ${width} ${height}`}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(PALETTE_MIME)) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(e) => {
        const kind = e.dataTransfer.getData(PALETTE_MIME)
        if (!kind) return
        e.preventDefault()
        const p = toSvg(e)
        onDropKind?.(kind, p.x, p.y)
      }}
      onPointerDown={(e) => {
        if (e.target === svgRef.current) onSelect(null)
      }}
    >
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="#7cc4ff" />
        </marker>
        <marker id="arrow-async" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="#ffd166" />
        </marker>
      </defs>

      {edges.map((e) => {
        const a = byId[e.from]
        const b = byId[e.to]
        if (!a || !b) return null
        const st = result.edges[e.id]
        const rps = st?.rps ?? 0
        const x1 = a.x + NODE_W
        const y1 = a.y + NODE_H / 2
        const x2 = b.x
        const y2 = b.y + NODE_H / 2
        const mx = (x1 + x2) / 2
        const d = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2 - 2},${y2}`
        const w = rps > 0 ? Math.min(8, 1.5 + Math.log10(rps + 1) * 1.6) : 1.5
        const dur = rps > 0 ? Math.max(0.25, Math.min(4, 60 / Math.sqrt(rps))) : 0
        const childOk = (result.nodes[e.to]?.success ?? 1) >= 0.99
        return (
          <g
            key={e.id}
            className={'bedge' + (selected === e.id ? ' selected' : '')}
            onPointerDown={(ev) => {
              ev.stopPropagation()
              onSelect(e.id)
            }}
          >
            <path d={d} className="bedge-hit" />
            <path
              d={d}
              className="bedge-line"
              stroke={st?.async ? '#ffd166' : childOk ? '#7cc4ff' : '#ff6b7a'}
              strokeWidth={w}
              markerEnd={st?.async ? 'url(#arrow-async)' : 'url(#arrow)'}
            />
            {rps > 0 && (
              <path
                d={d}
                className="bedge-flow"
                strokeWidth={Math.max(2, w - 1)}
                style={{ animationDuration: `${dur}s` }}
              />
            )}
            {rps > 0 && (
              <text x={mx} y={(y1 + y2) / 2 - 8} className="bedge-label">
                {rpsText(rps)} rps{st?.async ? ' · async' : ''}
              </text>
            )}
          </g>
        )
      })}

      {link && byId[link.from] && (
        <line
          x1={byId[link.from].x + NODE_W}
          y1={byId[link.from].y + NODE_H / 2}
          x2={link.x}
          y2={link.y}
          className="link-temp"
        />
      )}

      {nodes.map((n) => {
        const st = result.nodes[n.id]
        const spec = KINDS[n.kind]
        const util = st?.util ?? 0
        const color = n.kind === 'client' ? 'var(--accent)' : utilColor(util, st?.success ?? 1)
        const overloaded = n.kind !== 'client' && util > 1
        return (
          <g
            key={n.id}
            className={'bnode' + (selected === n.id ? ' selected' : '') + (overloaded ? ' overloaded' : '')}
            transform={`translate(${n.x},${n.y})`}
            onPointerDown={(e) => {
              e.stopPropagation()
              const p = toSvg(e)
              drag.current = { id: n.id, dx: p.x - n.x, dy: p.y - n.y }
              onSelect(n.id)
            }}
          >
            <rect width={NODE_W} height={NODE_H} rx={10} className="bnode-box" style={{ stroke: color }} />
            <text x={12} y={24} className="bnode-title">
              {spec.icon} {n.label}
            </text>
            {n.kind === 'client' ? (
              <text x={12} y={46} className="bnode-sub">
                {rpsText(n.rps ?? 0)} rps · {WORKLOADS[n.workload ?? 'oltp'].short}
              </text>
            ) : (
              <text x={12} y={46} className="bnode-sub">
                ×{n.instances} · {rpsText(st?.in ?? 0)} rps · {Math.round(Math.min(util, 9.99) * 100)}%
              </text>
            )}
            {n.kind === 'client' ? (
              <text x={12} y={64} className="bnode-sub" style={{ fill: color }}>
                ✓ {((st?.success ?? 1) * 100).toFixed(1)}% · {Math.round(st?.latency ?? 0)} {tr('мс', 'ms')}
              </text>
            ) : (
              <>
                <rect x={12} y={56} width={NODE_W - 24} height={6} rx={3} className="bnode-bar-bg" />
                <rect
                  x={12}
                  y={56}
                  width={(NODE_W - 24) * Math.min(1, util)}
                  height={6}
                  rx={3}
                  className="bnode-bar"
                  style={{ fill: color }}
                />
              </>
            )}
            {st?.deadEnd && (
              <text x={0} y={-6} className="bnode-warn">
                ⚠ {tr('тупик: запросам некуда идти', 'dead end: requests have nowhere to go')}
                <title>{tr('Подключите к этому блоку то, что обработает запросы дальше', 'Connect something to this block to handle requests further')}</title>
              </text>
            )}
            {(st?.unsupported ?? 0) > 0 && (
              <text x={NODE_W} y={-6} textAnchor="end" className="bnode-warn">
                ⚠ {tr('не умеет', 'unsupported')} {Math.round((st?.unsupported ?? 0) * 100)}%
                <title>{tr('Это хранилище не подходит для части запросов: они падают', 'This storage cannot handle some of the requests: they fail')}</title>
              </text>
            )}
            {!isStorage(n.kind) && (
              <circle
                cx={NODE_W}
                cy={NODE_H / 2}
                r={7}
                className="bnode-port"
                onPointerDown={(e) => {
                  e.stopPropagation()
                  const p = toSvg(e)
                  setLink({ from: n.id, x: p.x, y: p.y })
                }}
              >
                <title>{tr('Потяните, чтобы связать', 'Drag to connect')}</title>
              </circle>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** Тип данных при перетаскивании компонента из палитры */
export const PALETTE_MIME = 'application/x-blueprint-kind'

/** Свободно ли место под блок (с зазором), с учётом границ холста */
export function isFree(nodes: BNode[], x: number, y: number, width = 1000, height = 540): boolean {
  if (x < 0 || y < 0 || x + NODE_W > width || y + NODE_H > height) return false
  return nodes.every((n) => Math.abs(n.x - x) >= NODE_W + 20 || Math.abs(n.y - y) >= NODE_H + 16)
}

/** Ближайшее свободное место к желаемой точке: обходим соседние клетки сетки по спирали */
export function freeSpot(nodes: BNode[], x: number, y: number): { x: number; y: number } {
  const snap = (v: number) => Math.round(v / 10) * 10
  for (let r = 0; r < 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const cx = snap(x + dx * (NODE_W + 30))
        const cy = snap(y + dy * (NODE_H + 26))
        if (isFree(nodes, cx, cy)) return { x: cx, y: cy }
      }
    }
  }
  return { x: snap(x), y: snap(y) }
}

export function fmt(n: number): string {
  if (n >= 10000) return (n / 1000).toFixed(0) + 'k'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return n.toFixed(0)
}
