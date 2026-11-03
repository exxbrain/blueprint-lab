import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactElement, type ReactNode } from 'react'
import { tr } from '../../i18n'
import { KINDS, WORKLOADS, isStorage, scaleText, type BEdge, type BNode, type Result } from './model'
import type { SpanStatus, Trace } from './emulate'

export const NODE_W = 150
export const NODE_H = 74
/** Масштаб как в Figma: 100% — 1 единица схемы на 1 пиксель экрана; от «весь холст» до 400% */
const MAX_SCALE = 4
type View = { x: number; y: number; w: number }
/** Фокус в поле ввода: клавиши достаются ему, а не схеме */
const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
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
  /** Рабочий экран на телефоне: слева сверху — своя плашка (назад, название, задача), справа рядом с масштабом — свои кнопки */
  lead?: ReactNode
  extra?: ReactNode
  /** При открытии вписать схему в экран */
  autoFit?: boolean
  width?: number
  height?: number
}

export type LiveTrace = Trace & { born: number }

/** Время одного перехода точки по связи, мс */
export const HOP_MS = 520

/** Почему блок — тупик: коротко на схеме и подробно во всплывающей подсказке */
const DEAD_END: Partial<Record<BNode['kind'], [string, string]>> = {
  service: [
    tr('нет хранилища: данных неоткуда взять', 'no storage: no data to serve'),
    tr(
      'Сервис сам по себе данных не хранит: товары, заказы, профили лежат в базе. Подключите хранилище. Без него сервис работает, только если это внешний API (профиль «Внешний API»).',
      'A service does not keep data by itself: products, orders and profiles live in a database. Connect a storage. Without one, a service works only if it is an external API (the "External API" profile).',
    ),
  ],
  cache: [
    tr('кэш пуст: нет источника данных', 'empty cache: no source of data'),
    tr(
      'Кэш хранит копии того, что уже прочитали из базы. Нет базы — нечего копировать, попаданий не бывает. Подключите базу к кэшу (read-through) или к сервису рядом с кэшем (cache-aside).',
      'A cache keeps copies of what was already read from a database. No database, nothing to copy, so there are no hits. Connect a database to the cache (read-through) or to the service next to the cache (cache-aside).',
    ),
  ],
  cdn: [
    tr('нет origin: файлам неоткуда взяться', 'no origin: files have nowhere to come from'),
    tr('CDN раздаёт копии файлов из origin-хранилища. Подключите хранилище файлов за CDN.', 'A CDN serves copies of files from an origin store. Connect a file storage behind the CDN.'),
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
  lead,
  extra,
  autoFit,
  width = 1000,
  height = 540,
}: Props) {
  const rpsText = (v: number) => (hideLoad ? '?' : fmt(v))
  const svgRef = useRef<SVGSVGElement>(null)
  /** Нажатие на блок: щелчок открывает окно, а сдвиг больше 4 px — это перетаскивание, окно не открываем */
  const drag = useRef<{ id: string; dx: number; dy: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null)
  /** Нажатие на связь: окно открываем при отпускании без сдвига — иначе это начало жеста двумя пальцами */
  const tap = useRef<{ id: string; pid: number; x: number; y: number } | null>(null)
  /** Все указатели, что сейчас нажаты на холсте: второй палец превращает любое касание в масштаб и сдвиг */
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const [link, setLink] = useState<{ from: string; x: number; y: number } | null>(null)

  // ---- масштаб, как в Figma: видимая часть холста; null — весь холст. Пропорции как у холста, высота не прыгает
  const [view, setView] = useState<View | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view
  /** Размер холста на экране: на компьютере — 1000×540, на телефоне — весь экран любой формы */
  const [box, setBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const ro = new ResizeObserver(() => {
      const w = svg.clientWidth
      const h = svg.clientHeight
      if (!w || !h) return
      // холст сменил форму (растянулся на весь экран, телефон повернули): видимая часть сохраняет свой центр
      const was = aspectRef.current
      aspectRef.current = h / w
      if (Math.abs(was - h / w) > 1e-6) setView((v) => v && clampView({ x: v.x, y: v.y + (v.w * (was - h / w)) / 2, w: v.w }))
      setBox({ w, h })
    })
    ro.observe(svg)
    return () => ro.disconnect()
    // clampView читает пропорции через ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // пропорции видимой части — как у холста на экране; через ref: колесо и клавиши читают свежие
  const aspectRef = useRef(height / width)
  aspectRef.current = box.w && box.h ? box.h / box.w : height / width
  const A = () => aspectRef.current
  /** Самая крупная видимая часть: весь холст целиком, по центру */
  const maxW = () => Math.max(width, height / A())
  const whole = (): View => {
    const w = maxW()
    return { x: (width - w) / 2, y: (height - w * A()) / 2, w }
  }
  // окно параметров стоит у блока: при смене масштаба ему нужно пересчитать место
  useEffect(() => {
    window.dispatchEvent(new Event('canvas-view'))
  }, [view])
  const minW = () => (svgRef.current?.clientWidth || width) / MAX_SCALE
  const clampView = (v: View): View | null => {
    const w = Math.max(Math.min(minW(), maxW()), Math.min(maxW(), v.w))
    if (w >= maxW() - 1) return null
    const h = w * A()
    // видимая часть меньше холста — не выходит за холст; больше — держит холст целиком в кадре,
    // но может сдвинуться, чтобы посередине оказалась схема, а не пустой край холста
    const along = (pos: number, size: number, total: number) =>
      size <= total ? Math.max(0, Math.min(total - size, pos)) : Math.max(total - size, Math.min(0, pos))
    return { x: along(v.x, w, width), y: along(v.y, h, height), w }
  }
  /** Приблизить в k раз, держа точку at (координаты холста) на месте; без at — относительно середины */
  const zoomBy = (k: number, at?: { x: number; y: number }) =>
    setView((v) => {
      const c = v ?? whole()
      const p = at ?? { x: c.x + c.w / 2, y: c.y + (c.w * A()) / 2 }
      const w = c.w / k
      return clampView({ x: p.x - (p.x - c.x) * (w / c.w), y: p.y - (p.y - c.y) * (w / c.w), w })
    })
  /** Показать прямоугольник схемы целиком и как можно крупнее */
  const fitBoxView = (x0: number, y0: number, x1: number, y1: number) => {
    const w = Math.max(x1 - x0, (y1 - y0) / A())
    setView(clampView({ x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - (w * A()) / 2, w }))
  }
  /** Shift+1 — вписать схему */
  const fitNodes = () => {
    if (!nodes.length) return setView(null)
    const pad = 30
    fitBoxView(
      Math.min(...nodes.map((n) => n.x)) - pad,
      Math.min(...nodes.map((n) => n.y)) - pad,
      Math.max(...nodes.map((n) => n.x + NODE_W)) + pad,
      Math.max(...nodes.map((n) => n.y + NODE_H)) + pad,
    )
  }
  /** Shift+2 — к выбранному блоку или связи */
  const fitSelection = () => {
    const sel = nodes.find((n) => n.id === selected)
    const e = edges.find((x) => x.id === selected)
    const ends = sel ? [sel] : e ? nodes.filter((n) => n.id === e.from || n.id === e.to) : []
    if (!ends.length) return
    const pad = 60
    fitBoxView(
      Math.min(...ends.map((n) => n.x)) - pad,
      Math.min(...ends.map((n) => n.y)) - pad,
      Math.max(...ends.map((n) => n.x + NODE_W)) + pad,
      Math.max(...ends.map((n) => n.y + NODE_H)) + pad,
    )
  }
  /** Shift+0 — 100%: одна единица схемы на пиксель, вокруг середины видимой части */
  const zoomTo100 = () => {
    const c = viewRef.current ?? whole()
    zoomBy(c.w / (svgRef.current?.clientWidth || width))
  }
  const cur = view ?? whole()
  // ширина на экране: из наблюдателя размера, а до его первого отклика — прямым замером
  const scale = (box.w || svgRef.current?.clientWidth || width) / cur.w
  // рабочий экран: при открытии схема вписывается в экран, как только известен его размер
  const fitted = useRef(false)
  useEffect(() => {
    if (!autoFit || fitted.current || !box.w) return
    fitted.current = true
    fitNodes()
    // только один раз, когда стал известен размер
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFit, box.w])
  const [zoomMenu, setZoomMenu] = useState(false)
  const zoomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!zoomMenu) return
    const close = (e: PointerEvent) => !zoomRef.current?.contains(e.target as Node) && setZoomMenu(false)
    document.addEventListener('pointerdown', close, true)
    return () => document.removeEventListener('pointerdown', close, true)
  }, [zoomMenu])

  // жесты: одним пальцем или мышью по пустому месту — сдвиг приближенной схемы; двумя пальцами где угодно — масштаб и сдвиг;
  // пробел + перетаскивание и средняя кнопка мыши — сдвиг откуда угодно
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ view: View; mid: { x: number; y: number }; dist: number; rect: DOMRect } | null>(null)
  const [panning, setPanning] = useState(false)
  const startGesture = () => {
    const pts = [...touches.current.values()]
    setPanning(pts.length > 0)
    if (!pts.length || !svgRef.current) return (gesture.current = null)
    const two = pts.length >= 2
    gesture.current = {
      view: viewRef.current ?? whole(),
      mid: two ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0],
      dist: two ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0,
      rect: svgRef.current.getBoundingClientRect(),
    }
  }
  const moveGesture = () => {
    const g = gesture.current
    const pts = [...touches.current.values()]
    if (!g || !pts.length) return
    const two = pts.length >= 2 && g.dist > 0
    const mid = two ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0]
    const w = two ? g.view.w * (g.dist / Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y))) : g.view.w
    // точка холста под пальцами в начале жеста остаётся под пальцами
    const s0 = g.rect.width / g.view.w
    const px = g.view.x + (g.mid.x - g.rect.left) / s0
    const py = g.view.y + (g.mid.y - g.rect.top) / s0
    const s = g.rect.width / w
    setView(clampView({ x: px - (mid.x - g.rect.left) / s, y: py - (mid.y - g.rect.top) / s, w }))
  }
  const endTouch = (id: number) => {
    if (!touches.current.delete(id)) return false
    startGesture()
    return true
  }
  /** Второй палец: начатое перетаскивание блока или связи отменяется, блок возвращается на место */
  const cancelDrag = () => {
    const d = drag.current
    if (d?.moved) onMove(d.id, d.ox, d.oy)
    if (d?.moved || link) onDragging?.(false)
    drag.current = null
    tap.current = null
    setLink(null)
  }
  const resetPointers = () => {
    touches.current.clear()
    pointers.current.clear()
    gesture.current = null
    setPanning(false)
  }

  // колесо, как в Figma: Ctrl/⌘ или щипок на тачпаде — масштаб у курсора; без них — сдвиг приближенной схемы
  // (Shift — вбок). Если схеме двигаться некуда, колесо листает страницу
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || fit) return
    const onWheel = (e: WheelEvent) => {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? svg.clientHeight : 1
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        zoomBy(Math.exp(-e.deltaY * unit * 0.003), toSvg(e))
        return
      }
      const v = viewRef.current
      if (!v) return
      let dx = e.deltaX * unit
      let dy = e.deltaY * unit
      if (e.shiftKey && !dx) [dx, dy] = [dy, 0]
      const k = v.w / svg.clientWidth
      const next = clampView({ x: v.x + dx * k, y: v.y + dy * k, w: v.w })
      if (!next || (Math.abs(next.x - v.x) < 0.01 && Math.abs(next.y - v.y) < 0.01)) return
      e.preventDefault()
      setView(next)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
    // zoomBy, clampView и toSvg читают состояние через ref и setView с функцией
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit])

  // клавиши, как в Figma: Shift+1 — вписать, Shift+2 — к выбранному, Shift+0 — 100%, +/− — масштаб,
  // пробел + перетаскивание — сдвиг. Ctrl/⌘ + = и − перехватываем, только пока мышь над схемой
  const hover = useRef(false)
  const spaceRef = useRef(false)
  const [space, setSpace] = useState(false)
  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  keys.current = (e: KeyboardEvent) => {
    if (fit || typing(e.target) || e.altKey) return
    const mod = e.ctrlKey || e.metaKey
    if (e.shiftKey && !mod && e.code === 'Digit1') fitNodes()
    else if (e.shiftKey && !mod && e.code === 'Digit2') fitSelection()
    else if (e.shiftKey && !mod && e.code === 'Digit0') zoomTo100()
    else if ((e.key === '+' || e.key === '=') && (!mod || hover.current)) zoomBy(1.5)
    else if ((e.key === '-' || e.key === '_') && (!mod || hover.current)) zoomBy(1 / 1.5)
    else if (e.code === 'Space' && hover.current && !mod) {
      if (!e.repeat) {
        spaceRef.current = true
        setSpace(true)
      }
    } else return
    e.preventDefault()
  }
  useEffect(() => {
    const down = (e: KeyboardEvent) => keys.current(e)
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      spaceRef.current = false
      setSpace(false)
    }
    const blur = () => {
      spaceRef.current = false
      setSpace(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])
  // новый блок: если схема приближена и блок вне видимой части — сдвинуть к нему; прокрутить страницу и подсветить
  useEffect(() => {
    if (!reveal) return
    const n = nodes.find((x) => x.id === reveal)
    if (!n) return
    setView((v) => {
      if (!v) return v
      const h = v.w * A()
      const inside = n.x >= v.x && n.x + NODE_W <= v.x + v.w && n.y >= v.y && n.y + NODE_H <= v.y + h
      return inside ? v : clampView({ x: n.x + NODE_W / 2 - v.w / 2, y: n.y + NODE_H / 2 - h / 2, w: v.w })
    })
    const raf = requestAnimationFrame(() => {
      const el = svgRef.current?.querySelector(`[data-id="${reveal}"]`)
      if (!el) return
      const r = el.getBoundingClientRect()
      const top = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0
      if (r.top < top || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(raf)
    // только при появлении нового блока
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal])

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
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      moveGesture()
      return
    }
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

  const capture = (id: number) => {
    try {
      svgRef.current?.setPointerCapture(id)
    } catch {
      // указатель уже отпущен — захватывать нечего
    }
  }

  const onPointerUp = (e: RPointerEvent) => {
    if (svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId)
    pointers.current.delete(e.pointerId)
    if (endTouch(e.pointerId)) return
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
    <div
      className={'canvas-stage' + (space ? ' space' : '') + (panning ? ' panning' : '')}
      onPointerEnter={() => (hover.current = true)}
      onPointerLeave={() => (hover.current = false)}
    >
    {!fit && (
      <div className={'canvas-zoom' + (lead ? ' ws-bar' : '')}>
      {lead && <div className="ws-pill ws-left">{lead}</div>}
      <div className="ws-pill ws-right" role="group" aria-label={tr('Масштаб схемы', 'Diagram zoom')} ref={zoomRef}>
        <button
          className="zoom-pct"
          onClick={() => setZoomMenu(!zoomMenu)}
          aria-expanded={zoomMenu}
          aria-haspopup="menu"
          title={tr('Масштаб: на телефоне — двумя пальцами, на компьютере — Ctrl/⌘ + колесо или щипок', 'Zoom: two fingers on a phone, Ctrl/⌘ + wheel or pinch on a computer')}
        >
          {Math.round(scale * 100)}% ▾
        </button>
        {zoomMenu && (
          <div className="panel zoom-menu" role="menu">
            {(
              [
                [tr('Приблизить', 'Zoom in'), '+', () => zoomBy(1.5), scale < MAX_SCALE - 0.01],
                [tr('Отдалить', 'Zoom out'), '−', () => zoomBy(1 / 1.5), !!view],
                [tr('Вписать схему', 'Zoom to fit'), 'Shift+1', fitNodes, nodes.length > 0],
                [tr('К выбранному', 'Zoom to selection'), 'Shift+2', fitSelection, !!selected],
                ['100%', 'Shift+0', zoomTo100, true],
                [tr('Весь холст', 'Whole canvas'), '', () => setView(null), !!view],
              ] as const
            ).map(([label, key, act, ok]) => (
              <button
                key={label}
                role="menuitem"
                disabled={!ok}
                onClick={() => {
                  act()
                  setZoomMenu(false)
                }}
              >
                <span>{label}</span>
                <kbd>{key}</kbd>
              </button>
            ))}
            <p className="small muted">
              {tr('Сдвиг: колесо, пробел + перетаскивание, средняя кнопка мыши; на телефоне — пальцем.', 'Pan: wheel, space + drag, middle mouse button; on a phone, drag with a finger.')}
            </p>
          </div>
        )}
        {extra}
      </div>
      </div>
    )}
    <svg
      ref={svgRef}
      className={'builder-canvas' + (view ? ' zoomed' : '')}
      viewBox={fit && nodes.length ? fitBox(nodes) : `${cur.x} ${cur.y} ${cur.w} ${cur.w * A()}`}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={(e) => {
        // при захвате указателя «уход» с холста не конец жеста
        if (!touches.current.has(e.pointerId)) onPointerUp(e)
      }}
      onContextMenu={() => {
        // меню браузера забирает указатель: отпускания может не быть — жест не должен «залипнуть»
        cancelDrag()
        resetPointers()
      }}
      onPointerDownCapture={(e) => {
        if (fit) return
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        const mouse = e.pointerType === 'mouse'
        const panMouse = mouse && (e.button === 1 || (e.button === 0 && spaceRef.current))
        const secondFinger = !mouse && pointers.current.size >= 2
        if (!panMouse && !secondFinger) return
        // сдвиг или щипок перехватывают нажатие у блоков и связей
        e.stopPropagation()
        e.preventDefault()
        if (secondFinger) {
          cancelDrag()
          touches.current = new Map(pointers.current)
        } else touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        capture(e.pointerId)
        startGesture()
      }}
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
        if (fit) return
        touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        capture(e.pointerId)
        startGesture()
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
        const spec = KINDS[n.kind]
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
            <text x={12} y={24} className="bnode-title">
              {n.kind === 'client' && !hideLoad ? (
                <tspan className={'bnode-mood ' + clientMood(st?.success ?? 1, st?.latency ?? 0)}>{MOOD_FACE[clientMood(st?.success ?? 1, st?.latency ?? 0)]}</tspan>
              ) : (
                spec.icon
              )}{' '}
              {n.label}
              {n.kind === 'client' && !hideLoad && (
                <title>
                  {clientMood(st?.success ?? 1, st?.latency ?? 0) === 'happy'
                    ? tr('Пользователи довольны', 'Users are happy')
                    : clientMood(st?.success ?? 1, st?.latency ?? 0) === 'meh'
                      ? tr('Пользователи недовольны: ошибки или медленные ответы', 'Users are unhappy: errors or slow responses')
                      : tr('Пользователи злятся: много ошибок или очень долго', 'Users are angry: many errors or very slow')}
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
                ⚠ {DEAD_END[n.kind]?.[0] ?? tr('тупик: запросам некуда идти', 'dead end: requests have nowhere to go')}
                <title>{DEAD_END[n.kind]?.[1] ?? tr('Подключите к этому блоку то, что обработает запросы дальше', 'Connect something to this block to handle requests further')}</title>
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
                  if (e.button !== 0 || (e.pointerType === 'mouse' && e.ctrlKey)) return
                  const p = toSvg(e)
                  setLink({ from: n.id, x: p.x, y: p.y })
                  onDragging?.(true)
                  capture(e.pointerId)
                }}
              >
                <title>{tr('Потяните, чтобы связать', 'Drag to connect')}</title>
              </circle>
            )}
          </g>
        )
      })}
      {traces && traces.length > 0 && <TrafficLayer traces={traces} nodes={byId} edges={edges} />}
    </svg>
    </div>
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
      : h.status === 'slow' ? tr('медленно', 'slow')
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
