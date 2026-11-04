import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { tr } from '../../i18n'
import type { Viewport } from '../../components/editor/useViewport'
import { BOUNDARY, CANVAS, EL_H, EL_W, KIND_INFO, type C4Exercise, type DiagramState, type Placed } from './model'

/** Тип данных при перетаскивании карточки из списка кандидатов */
export const C4_MIME = 'application/x-blueprint-c4-card'

interface Props {
  ex: C4Exercise
  diagram: DiagramState
  selected: string | null
  onSelect: (id: string | null) => void
  onMove: (card: string, x: number, y: number) => void
  onConnect: (from: string, to: string) => void
  onDropCard: (card: string, x: number, y: number) => void
  /** Масштаб и сдвиг — общие для всех редакторов схем (useViewport на странице) */
  vp: Viewport
  /** Начали или закончили тянуть элемент или связь — окно свойств на это время прячется */
  onDragging?: (active: boolean) => void
}

/** Точка на границе прямоугольника элемента в направлении к точке (tx, ty) */
function edgePoint(p: Placed, tx: number, ty: number) {
  const cx = p.x + EL_W / 2
  const cy = p.y + EL_H / 2
  const dx = tx - cx
  const dy = ty - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const sx = EL_W / 2 / Math.abs(dx || 1e-9)
  const sy = EL_H / 2 / Math.abs(dy || 1e-9)
  const s = Math.min(sx, sy)
  return { x: cx + dx * s, y: cy + dy * s }
}

export function C4Canvas({ ex, diagram, selected, onSelect, onMove, onConnect, onDropCard, vp, onDragging }: Props) {
  const drag = useRef<{ card: string; dx: number; dy: number; ox: number; oy: number; moved: boolean } | null>(null)
  const [link, setLink] = useState<{ from: string; x: number; y: number } | null>(null)
  const cardOf = (id: string) => ex.cards.find((c) => c.id === id)!
  const byCard = new Map(diagram.placed.map((p) => [p.card, p]))

  const toSvg = vp.toSvg
  /** Второй палец: начатое перетаскивание отменяется, элемент возвращается на место */
  const cancelDrag = () => {
    const d = drag.current
    if (d?.moved) onMove(d.card, d.ox, d.oy)
    if (d?.moved || link) onDragging?.(false)
    drag.current = null
    setLink(null)
  }
  useEffect(() => {
    vp.secondFinger.current = cancelDrag
  })
  const at = (x: number, y: number) =>
    diagram.placed.find((p) => x >= p.x && x <= p.x + EL_W && y >= p.y && y <= p.y + EL_H)

  const onPointerMove = (e: RPointerEvent) => {
    if (vp.onMove(e)) return
    const p = toSvg(e)
    if (drag.current) {
      if (!drag.current.moved) onDragging?.(true)
      drag.current.moved = true
      const x = Math.max(0, Math.min(CANVAS.w - EL_W, p.x - drag.current.dx))
      const y = Math.max(0, Math.min(CANVAS.h - EL_H, p.y - drag.current.dy))
      onMove(drag.current.card, Math.round(x / 10) * 10, Math.round(y / 10) * 10)
    } else if (link) setLink({ ...link, x: p.x, y: p.y })
  }
  const onPointerUp = (e: RPointerEvent) => {
    if (vp.onUp(e)) return
    if (drag.current?.moved || link) onDragging?.(false)
    if (link) {
      const p = toSvg(e)
      const target = at(p.x, p.y)
      if (target && target.card !== link.from) onConnect(link.from, target.card)
    }
    drag.current = null
    setLink(null)
  }

  return (
    <svg
      ref={vp.bindSvg}
      className={'builder-canvas c4-canvas' + (vp.zoomed ? ' zoomed' : '')}
      viewBox={vp.viewBox}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={(e) => {
        // при захвате указателя «уход» с холста не конец жеста
        if (!vp.holds(e.pointerId)) onPointerUp(e)
      }}
      onContextMenu={(e) => vp.onContextMenu(e, cancelDrag)}
      onPointerDownCapture={vp.onPointerDownCapture}
      onPointerDown={(e) => {
        // пустое место (не элемент и не связь): снять выбор и двигать схему
        if ((e.target as Element).closest?.('.c4-el, .c4-rel')) return
        if (e.button !== 0 || (e.pointerType === 'mouse' && e.ctrlKey)) return
        onSelect(null)
        vp.onBackgroundDown(e)
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(C4_MIME)) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(e) => {
        const card = e.dataTransfer.getData(C4_MIME)
        if (!card) return
        e.preventDefault()
        const p = toSvg(e)
        onDropCard(card, p.x - EL_W / 2, p.y - EL_H / 2)
      }}
    >
      <defs>
        <marker id="c4-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="#b8c7d9" />
        </marker>
        <marker id="c4-arrow-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="#ffd166" />
        </marker>
      </defs>

      {ex.boundary && (
        <g>
          <rect x={BOUNDARY.x} y={BOUNDARY.y} width={BOUNDARY.w} height={BOUNDARY.h} rx={12} className="c4-boundary" />
          <text x={BOUNDARY.x + 12} y={BOUNDARY.y + BOUNDARY.h - 12} className="c4-boundary-label">
            {ex.boundary.name}
            <tspan className="c4-type"> [{ex.boundary.kind === 'system' ? 'Software System' : 'Container'}]</tspan>
          </text>
        </g>
      )}

      {diagram.rels.map((r) => {
        const a = byCard.get(r.from)
        const b = byCard.get(r.to)
        if (!a || !b) return null
        const p1 = edgePoint(a, b.x + EL_W / 2, b.y + EL_H / 2)
        const p2 = edgePoint(b, a.x + EL_W / 2, a.y + EL_H / 2)
        const mx = (p1.x + p2.x) / 2
        const my = (p1.y + p2.y) / 2
        const sel = selected === r.id
        const label = r.label.trim() || tr('⚠ без подписи', '⚠ no label', '⚠ 无标签')
        return (
          <g
            key={r.id}
            data-id={r.id}
            className={'c4-rel' + (sel ? ' selected' : '') + (r.label.trim() ? '' : ' unlabeled')}
            onPointerDown={(e) => {
              e.stopPropagation()
              onSelect(r.id)
            }}
          >
            <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} className="c4-rel-hit" />
            <line
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              className="c4-rel-line"
              markerEnd={sel ? 'url(#c4-arrow-sel)' : 'url(#c4-arrow)'}
            />
            <text x={mx} y={my - 4} className="c4-rel-label" textAnchor="middle">
              {label}
            </text>
            {r.tech.trim() && (
              <text x={mx} y={my + 10} className="c4-rel-tech" textAnchor="middle">
                [{r.tech}]
              </text>
            )}
          </g>
        )
      })}

      {link && byCard.get(link.from) && (
        <line
          x1={byCard.get(link.from)!.x + EL_W}
          y1={byCard.get(link.from)!.y + EL_H / 2}
          x2={link.x}
          y2={link.y}
          className="link-temp"
        />
      )}

      {diagram.placed.map((p) => {
        const c = cardOf(p.card)
        const kind = p.kind
        const typeLine = kind ? `[${KIND_INFO[kind].title}${p.tech.trim() ? ': ' + p.tech : ''}]` : tr('[тип не выбран]', '[no type]', '[未选择类型]')
        return (
          <g
            key={p.card}
            data-id={p.card}
            className={'c4-el ' + (kind ?? 'unknown') + (selected === p.card ? ' selected' : '')}
            transform={`translate(${p.x},${p.y})`}
            onPointerDown={(e) => {
              e.stopPropagation()
              // правая кнопка и Ctrl+щелчок на Mac — меню браузера, а не перетаскивание
              if (e.button !== 0 || (e.pointerType === 'mouse' && e.ctrlKey)) return
              const pt = toSvg(e)
              drag.current = { card: p.card, dx: pt.x - p.x, dy: pt.y - p.y, ox: p.x, oy: p.y, moved: false }
              vp.capture(e.pointerId)
              onSelect(p.card)
            }}
          >
            <rect width={EL_W} height={EL_H} rx={kind === 'person' ? 22 : 8} className="c4-el-box" />
            {kind === 'person' && <circle cx={EL_W / 2} cy={-9} r={10} className="c4-el-head" />}
            <text x={EL_W / 2} y={22} textAnchor="middle" className="c4-el-name">
              {c.name.length > 24 ? c.name.slice(0, 23) + '…' : c.name}
            </text>
            <text x={EL_W / 2} y={38} textAnchor="middle" className="c4-el-type">
              {typeLine.length > 30 ? typeLine.slice(0, 29) + '…]' : typeLine}
            </text>
            <text x={EL_W / 2} y={56} textAnchor="middle" className="c4-el-desc">
              {c.desc.length > 28 ? c.desc.slice(0, 27) + '…' : c.desc}
            </text>
            <circle
              cx={EL_W}
              cy={EL_H / 2}
              r={7}
              className="bnode-port"
              onPointerDown={(e) => {
                e.stopPropagation()
                if (e.button !== 0 || (e.pointerType === 'mouse' && e.ctrlKey)) return
                const pt = toSvg(e)
                setLink({ from: p.card, x: pt.x, y: pt.y })
                // указатель — холсту: связь тянется, даже если по пути окажется окно
                vp.capture(e.pointerId)
                onDragging?.(true)
              }}
            >
              <title>{tr('Потяните к другому элементу, чтобы провести связь', 'Drag to another element to draw a relationship', '拖到另一个元素上即可建立关系')}</title>
            </circle>
          </g>
        )
      })}
    </svg>
  )
}
