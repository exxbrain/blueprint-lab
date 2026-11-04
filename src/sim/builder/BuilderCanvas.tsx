import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactElement } from 'react'
import { tr } from '../../i18n'
import { useViewport, type Rect, type Viewport } from '../../components/editor/useViewport'
import { WORKLOADS, canLinkFrom, scaleText, type BEdge, type BNode, type Result } from './model'
import type { SpanStatus, Trace } from './emulate'
import { KindGlyph } from './KindIcon'

export const NODE_W = 150
export const NODE_H = 74

/** Рамка вокруг блоков (с отступом) — для «вписать схему» и «к выбранному» */
export function nodesBox(ns: BNode[], pad: number): Rect | null {
  if (!ns.length) return null
  const x = Math.min(...ns.map((n) => n.x)) - pad
  const y = Math.min(...ns.map((n) => n.y)) - pad
  return { x, y, w: Math.max(...ns.map((n) => n.x + NODE_W)) + pad - x, h: Math.max(...ns.map((n) => n.y + NODE_H)) + pad - y }
}

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
  /** Живые запросы: точки бегут по связям */
  traces?: LiveTrace[]
  /** Началось или закончилось перетаскивание блока или связи — окно параметров на это время прячется */
  onDragging?: (active: boolean) => void
  /** Обрезать холст по блокам (для витрины на главной) */
  fit?: boolean
  /** Только что добавленный блок: показать его — прокрутить к нему и подсветить */
  reveal?: string | null
  /** Масштаб и сдвиг — общие для всех редакторов схем (useViewport на странице); без него — свой, для витрины */
  vp?: Viewport
  width?: number
  height?: number
}

export type LiveTrace = Trace & { born: number }

/** Время одного перехода точки по связи, мс */
export const HOP_MS = 520

/** Почему блок — тупик: коротко на схеме и подробно во всплывающей подсказке */
const DEAD_END: Partial<Record<BNode['kind'], [string, string]>> = {
  service: [
    tr('нет хранилища: данных неоткуда взять', 'no storage: no data to serve', '没有存储：无数据可提供'),
    tr(
      'Сервис сам по себе данных не хранит: товары, заказы, профили лежат в базе. Подключите хранилище. Без него сервис работает, только если это внешний API (профиль «Внешний API»).',
      'A service does not keep data by itself: products, orders and profiles live in a database. Connect a storage. Without one, a service works only if it is an external API (the "External API" profile).',
      '服务本身不保存数据：商品、订单和用户资料都存放在数据库里。请连接一个存储。没有存储时，只有当服务本身是外部 API（服务类型“外部 API”）时才能正常工作。',
    ),
  ],
  cache: [
    tr('кэш пуст: нет источника данных', 'empty cache: no source of data', '缓存为空：没有数据源'),
    tr(
      'Кэш хранит копии того, что сервис уже прочитал из базы. Нет базы — нечего копировать, попаданий не бывает. Подключите базу к тому же сервису, что и кэш (cache-aside): сам Redis в базу не ходит.',
      'A cache keeps copies of what the service already read from a database. No database, nothing to copy, so there are no hits. Connect a database to the same service as the cache (cache-aside): Redis itself never calls the database.',
      '缓存保存的是服务已经从数据库读取过的数据副本。没有数据库，就没有可复制的内容，也就不会有命中。请把数据库连接到与缓存相同的服务上（cache-aside）：Redis 本身不会访问数据库。',
    ),
  ],
  cdn: [
    tr('нет origin: файлам неоткуда взяться', 'no origin: files have nowhere to come from', '没有 origin：文件无从获取'),
    tr('CDN раздаёт копии файлов из origin-хранилища. Подключите хранилище файлов за CDN.', 'A CDN serves copies of files from an origin store. Connect a file storage behind the CDN.', 'CDN 分发的是来自 origin 存储的文件副本。请在 CDN 后面连接一个文件存储。'),
  ],
}

/** Настроение клиентов: довольны, так себе, недовольны */
export type Mood = 'happy' | 'meh' | 'angry'
export const MOOD_FACE: Record<Mood, string> = { happy: '😀', meh: '😐', angry: '😡' }
export function clientMood(success: number, latency: number): Mood {
  if (success >= 0.995 && latency <= 300) return 'happy'
  if (success >= 0.95 && latency <= 1000) return 'meh'
  return 'angry'
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
  traces,
  onDragging,
  fit,
  reveal,
  vp: outer,
  width = 1000,
  height = 540,
}: Props) {
  const rpsText = (v: number) => (hideLoad ? '?' : fmt(v))
  /** Нажатие на блок: щелчок открывает окно, а сдвиг больше 4 px — это перетаскивание, окно не открываем */
  const drag = useRef<{ id: string; dx: number; dy: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null)
  /** Нажатие на связь: окно открываем при отпускании без сдвига — иначе это начало жеста двумя пальцами */
  const tap = useRef<{ id: string; pid: number; x: number; y: number } | null>(null)
  const [link, setLink] = useState<{ from: string; x: number; y: number } | null>(null)

  /** Второй палец: начатое перетаскивание блока или связи отменяется, блок возвращается на место */
  const cancelDrag = () => {
    const d = drag.current
    if (d?.moved) onMove(d.id, d.ox, d.oy)
    if (d?.moved || link) onDragging?.(false)
    drag.current = null
    tap.current = null
    setLink(null)
  }
  // масштаб, сдвиг, клавиши и жесты — общие для всех редакторов схем; страница передаёт свой, витрина — без масштаба
  const own = useViewport({ width, height, disabled: fit || !!outer, content: () => nodesBox(nodes, 30) })
  const vp = outer ?? own
  useEffect(() => {
    vp.secondFinger.current = cancelDrag
  })
  const svgRef = vp.svgRef
  // новый блок: если схема приближена и блок вне видимой части — сдвинуть к нему; прокрутить страницу и подсветить
  useEffect(() => {
    if (!reveal) return
    const n = nodes.find((x) => x.id === reveal)
    if (!n) return
    const raf = vp.show({ x: n.x, y: n.y, w: NODE_W, h: NODE_H }, reveal)
    return () => cancelAnimationFrame(raf)
    // только при появлении нового блока
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal])

  const toSvg = vp.toSvg
  const capture = vp.capture

  const nodeAt = (x: number, y: number) =>
    nodes.find((n) => x >= n.x && x <= n.x + NODE_W && y >= n.y && y <= n.y + NODE_H)

  const onPointerMove = (e: RPointerEvent) => {
    if (vp.onMove(e)) return
    const p = toSvg(e)
    if (drag.current) {
      if (!drag.current.moved) {
        if (Math.hypot(e.clientX - drag.current.sx, e.clientY - drag.current.sy) < 4) return
        drag.current.moved = true
        onSelect(null)
        onDragging?.(true)
      }
      const x = Math.max(0, Math.min(width - NODE_W, p.x - drag.current.dx))
      const y = Math.max(0, Math.min(height - NODE_H, p.y - drag.current.dy))
      onMove(drag.current.id, Math.round(x / 10) * 10, Math.round(y / 10) * 10)
    } else if (link) {
      setLink({ ...link, x: p.x, y: p.y })
    }
  }

  const onPointerUp = (e: RPointerEvent) => {
    if (svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId)
    if (vp.onUp(e)) return
    // связь: отпустили почти там же, где нажали, — это щелчок, открыть или закрыть её окно
    const t = tap.current
    if (t && t.pid === e.pointerId) {
      tap.current = null
      if (Math.hypot(e.clientX - t.x, e.clientY - t.y) < 6) onSelect(selected === t.id ? null : t.id)
      return
    }
    if (drag.current?.moved || link) onDragging?.(false)
    // щелчок без движения — открыть параметры блока
    // повторный щелчок по выбранному блоку закрывает окно
    if (drag.current && !drag.current.moved) onSelect(selected === drag.current.id ? null : drag.current.id)
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
      ref={vp.bindSvg}
      className={'builder-canvas' + (vp.zoomed ? ' zoomed' : '')}
      viewBox={fit && nodes.length ? fitBox(nodes) : vp.viewBox}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={(e) => {
        // при захвате указателя «уход» с холста не конец жеста
        if (!vp.holds(e.pointerId)) onPointerUp(e)
      }}
      // долгое касание пальцем — не меню; меню мыши забирает отпускание — перетаскивание сбрасывается
      onContextMenu={(e) => vp.onContextMenu(e, cancelDrag)}
      onPointerDownCapture={vp.onPointerDownCapture}
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
        const t = e.target as Element
        if (t !== svgRef.current && !t.classList?.contains('canvas-bg')) return
        if (e.button !== 0 || (e.pointerType === 'mouse' && e.ctrlKey)) return
        onSelect(null)
        vp.onBackgroundDown(e)
      }}
    >
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="#7cc4ff" />
        </marker>
        <marker id="arrow-async" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="#ffd166" />
        </marker>
        {/* сетка — часть холста: при масштабе и сдвиге она движется вместе со схемой */}
        <pattern id="canvas-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" className="canvas-grid-line" />
        </pattern>
      </defs>
      <rect className="canvas-bg" x={-width * 3} y={-height * 5} width={width * 7} height={height * 11} fill="url(#canvas-grid)" />
      {/* границы холста: за них блоки не уходят — на вытянутом экране видно, где можно строить */}
      {!fit && <rect className="canvas-frame" x={0} y={0} width={width} height={height} rx={6} />}

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
        const d = edgePath(a, b)
        const w = rps > 0 ? Math.min(8, 1.5 + Math.log10(rps + 1) * 1.6) : 1.5
        const dur = rps > 0 ? Math.max(0.25, Math.min(4, 60 / Math.sqrt(rps))) : 0
        const childOk = (result.nodes[e.to]?.success ?? 1) >= 0.99
        return (
          <g
            key={e.id}
            data-id={e.id}
            className={'bedge' + (selected === e.id ? ' selected' : '')}
            onPointerDown={(ev) => {
              ev.stopPropagation()
              if (ev.button !== 0 || (ev.pointerType === 'mouse' && ev.ctrlKey)) return
              tap.current = { id: e.id, pid: ev.pointerId, x: ev.clientX, y: ev.clientY }
              capture(ev.pointerId)
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
        const util = st?.util ?? 0
        const color = n.kind === 'client' ? 'var(--accent)' : utilColor(util, st?.success ?? 1)
        const overloaded = n.kind !== 'client' && util > 1
        return (
          <g
            key={n.id}
            data-id={n.id}
            className={'bnode' + (selected === n.id ? ' selected' : '') + (overloaded ? ' overloaded' : '') + (reveal === n.id ? ' bnode-new' : '')}
            transform={`translate(${n.x},${n.y})`}
            onPointerDown={(e) => {
              e.stopPropagation()
              // правая кнопка и Ctrl+щелчок на Mac — контекстное меню, а не перетаскивание
              if (e.button !== 0 || (e.pointerType === 'mouse' && e.ctrlKey)) return
              const p = toSvg(e)
              drag.current = { id: n.id, dx: p.x - n.x, dy: p.y - n.y, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y, moved: false }
              // захватываем указатель: блок тащится, даже когда курсор проходит над окном параметров
              capture(e.pointerId)
            }}
          >
            <rect width={NODE_W} height={NODE_H} rx={10} className="bnode-box" style={{ stroke: color }} />
            {/* у клиентов под нагрузкой на месте значка — их настроение */}
            {!(n.kind === 'client' && !hideLoad) && <KindGlyph kind={n.kind} x={12} y={10} color={color} />}
            <text x={n.kind === 'client' && !hideLoad ? 12 : 34} y={24} className="bnode-title">
              {n.kind === 'client' && !hideLoad && (
                <>
                  <tspan className={'bnode-mood ' + clientMood(st?.success ?? 1, st?.latency ?? 0)}>{MOOD_FACE[clientMood(st?.success ?? 1, st?.latency ?? 0)]}</tspan>{' '}
                </>
              )}
              {n.label}
              {n.kind === 'client' && !hideLoad && (
                <title>
                  {clientMood(st?.success ?? 1, st?.latency ?? 0) === 'happy'
                    ? tr('Пользователи довольны', 'Users are happy', '用户很满意')
                    : clientMood(st?.success ?? 1, st?.latency ?? 0) === 'meh'
                      ? tr('Пользователи недовольны: ошибки или медленные ответы', 'Users are unhappy: errors or slow responses', '用户不太满意：出现错误或响应缓慢')
                      : tr('Пользователи злятся: много ошибок или очень долго', 'Users are angry: many errors or very slow', '用户很生气：错误很多或响应非常慢')}
                </title>
              )}
            </text>
            {n.kind === 'client' ? (
              <text x={12} y={46} className="bnode-sub">
                {rpsText(n.rps ?? 0)} rps · {WORKLOADS[n.workload ?? 'oltp'].short}
              </text>
            ) : (
              <text x={12} y={46} className="bnode-sub">
                {scaleText(n)} · {rpsText(st?.in ?? 0)} rps · {Math.round(Math.min(util, 9.99) * 100)}%
              </text>
            )}
            {n.kind === 'client' ? (
              <text x={12} y={64} className="bnode-sub" style={{ fill: color }}>
                ✓ {((st?.success ?? 1) * 100).toFixed(1)}% · {Math.round(st?.latency ?? 0)} {tr('мс', 'ms', 'ms')}
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
                ⚠ {DEAD_END[n.kind]?.[0] ?? tr('тупик: запросам некуда идти', 'dead end: requests have nowhere to go', '死胡同：请求无处可去')}
                <title>{DEAD_END[n.kind]?.[1] ?? tr('Подключите к этому блоку то, что обработает запросы дальше', 'Connect something to this block to handle requests further', '请给这个组件接上能继续处理请求的下一环')}</title>
              </text>
            )}
            {(st?.unsupported ?? 0) > 0 && (
              <text x={NODE_W} y={-6} textAnchor="end" className="bnode-warn">
                ⚠ {tr('не умеет', 'unsupported', '不支持')} {Math.round((st?.unsupported ?? 0) * 100)}%
                <title>{tr('Это хранилище не подходит для части запросов: они падают', 'This storage cannot handle some of the requests: they fail', '这个存储无法处理部分请求：这些请求会失败')}</title>
              </text>
            )}
            {/* порт связи — только у тех, кто сам кого-то вызывает (у кэша и хранилищ его нет) */}
            {canLinkFrom(n.kind) && (
              <circle
                cx={NODE_W}
                cy={NODE_H / 2}
                r={7}
                className="bnode-port"
                onPointerDown={(e) => {
                  e.stopPropagation()
                  if (e.button !== 0 || (e.pointerType === 'mouse' && e.ctrlKey)) return
                  const p = toSvg(e)
                  setLink({ from: n.id, x: p.x, y: p.y })
                  onDragging?.(true)
                  capture(e.pointerId)
                }}
              >
                <title>{tr('Потяните, чтобы связать', 'Drag to connect', '拖动以连接')}</title>
              </circle>
            )}
          </g>
        )
      })}
      {traces && traces.length > 0 && <TrafficLayer traces={traces} nodes={byId} edges={edges} />}
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

/**
 * Ближайшее свободное место к желаемой точке: обходим соседние клетки сетки по спирали.
 * within — сначала искать только внутри этой области (видимая часть схемы), и лишь если там тесно — где угодно
 */
export function freeSpot(nodes: BNode[], x: number, y: number, within?: Rect): { x: number; y: number } {
  const snap = (v: number) => Math.round(v / 10) * 10
  const inside = (cx: number, cy: number) =>
    !within || (cx >= within.x && cy >= within.y && cx + NODE_W <= within.x + within.w && cy + NODE_H <= within.y + within.h)
  for (const strict of within ? [true, false] : [false]) {
    // мелкий шаг внутри видимой части (при сильном приближении в неё помещается всего пара блоков), крупный — по всему холсту
    const sx = strict ? 40 : NODE_W + 30
    const sy = strict ? 30 : NODE_H + 26
    for (let r = 0; r < (strict ? 30 : 12); r++) {
      // клетки кольца — от ближайшей к желаемой точке, а не с левого верхнего угла
      const ring: [number, number][] = []
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) ring.push([dx * sx, dy * sy])
      ring.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]))
      for (const [ox, oy] of ring) {
        const cx = snap(x + ox)
        const cy = snap(y + oy)
        if ((!strict || inside(cx, cy)) && isFree(nodes, cx, cy)) return { x: cx, y: cy }
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

function edgeGeom(a: BNode, b: BNode) {
  const x1 = a.x + NODE_W
  const y1 = a.y + NODE_H / 2
  const x2 = b.x - 2
  const y2 = b.y + NODE_H / 2
  const mx = (x1 + x2 + 2) / 2
  return { x1, y1, x2, y2, mx }
}

function edgePath(a: BNode, b: BNode): string {
  const { x1, y1, x2, y2, mx } = edgeGeom(a, b)
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`
}

/** Точка на кривой связи при t ∈ [0, 1] */
function pointOn(a: BNode, b: BNode, t: number) {
  const { x1, y1, x2, y2, mx } = edgeGeom(a, b)
  const u = 1 - t
  const bez = (p0: number, p1: number, p2: number, p3: number) => u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
  return { x: bez(x1, mx, mx, x2), y: bez(y1, y1, y2, y2) }
}

const DOT: Record<SpanStatus, string> = {
  ok: '#7cc4ff',
  hit: '#5be49b',
  miss: '#ffb454',
  slow: '#ff9f43',
  error: '#ff6b7a',
  queued: '#ffd166',
  async: '#ffd166',
}

interface Flight {
  key: string
  a: BNode
  b: BNode
  start: number
  status: SpanStatus
}

interface Mark {
  key: string
  node: BNode
  at: number
  text: string
  status: SpanStatus
}

/** Раскладывает запрос во времени: дочерние вызовы идут по очереди, после ответа предыдущего */
export function schedule(t: LiveTrace, nodes: Record<string, BNode>, edges: BEdge[]) {
  const byEdge = Object.fromEntries(edges.map((e) => [e.id, e]))
  const ready: Record<string, number> = { [t.clientId]: t.born }
  const flights: Flight[] = []
  const marks: Mark[] = []
  let end = t.born
  t.hops.forEach((h, i) => {
    const e = byEdge[h.edgeId]
    if (!e || !nodes[e.from] || !nodes[e.to]) return
    const start = ready[e.from] ?? t.born
    const arrive = start + HOP_MS
    flights.push({ key: `${t.id}-${i}`, a: nodes[e.from], b: nodes[e.to], start, status: h.status })
    ready[e.to] = arrive
    // следующий вызов того же блока — после того, как этот ответил
    ready[e.from] = start + HOP_MS * (h.status === 'queued' || h.status === 'async' ? 0.6 : 1.4)
    end = Math.max(end, arrive)
    const text =
      h.status === 'error' ? (t.httpStatus ? String(t.httpStatus) : 'ERR')
      : h.status === 'hit' ? 'HIT'
      : h.status === 'miss' ? 'MISS'
      : h.status === 'slow' ? tr('медленно', 'slow', '慢')
      : h.status === 'queued' ? 'ack'
      : ''
    if (text) marks.push({ key: `${t.id}-m${i}`, node: nodes[e.to], at: arrive, text, status: h.status })
  })
  if (t.status === 'error' && !t.hops.length && nodes[t.clientId])
    marks.push({ key: `${t.id}-c`, node: nodes[t.clientId], at: t.born, text: 'ECONNREFUSED', status: 'error' })
  return { flights, marks, end }
}

function TrafficLayer({ traces, nodes, edges }: { traces: LiveTrace[]; nodes: Record<string, BNode>; edges: BEdge[] }) {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    let raf = 0
    const tick = () => {
      setNow(performance.now())
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  const dots: ReactElement[] = []
  const labels: ReactElement[] = []
  for (const t of traces) {
    const { flights, marks } = schedule(t, nodes, edges)
    for (const f of flights) {
      const p = (now - f.start) / HOP_MS
      if (p < 0 || p > 1) continue
      const pt = pointOn(f.a, f.b, p)
      dots.push(<circle key={f.key} cx={pt.x} cy={pt.y} r={f.status === 'error' ? 6 : 5} fill={DOT[f.status]} className="tdot" />)
    }
    for (const m of marks) {
      const age = now - m.at
      if (age < 0 || age > 1400) continue
      labels.push(
        <text
          key={m.key}
          x={m.node.x + NODE_W - 8}
          y={m.node.y + 18 - age / 60}
          textAnchor="end"
          className={'tmark ' + m.status}
          style={{ opacity: 1 - age / 1400 }}
        >
          {m.text}
        </text>,
      )
    }
  }
  return (
    <g className="traffic" pointerEvents="none">
      {dots}
      {labels}
    </g>
  )
}

function fitBox(nodes: BNode[]): string {
  const pad = 30
  const x0 = Math.min(...nodes.map((n) => n.x)) - pad
  const y0 = Math.min(...nodes.map((n) => n.y)) - pad
  const x1 = Math.max(...nodes.map((n) => n.x + NODE_W)) + pad
  const y1 = Math.max(...nodes.map((n) => n.y + NODE_H)) + pad
  return `${x0} ${y0} ${x1 - x0} ${Math.max(y1 - y0, 200)}`
}
