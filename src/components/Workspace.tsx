import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import { tr } from '../i18n'

/**
 * Рабочий экран на телефоне, как в Figma: поле на весь экран, инструменты — на плавающих панелях.
 * Слева сверху — назад, название и кнопка задачи; справа — инструменты экрана; снизу — панель кнопок.
 * Задача (условие, цели, проверка) — модальной шторкой; при входе она открыта.
 */
export function Workspace({
  title,
  backHref = '#/',
  panel,
  panelOpen,
  setPanelOpen,
  right,
  metrics,
  bottom,
  children,
  scroll,
}: {
  title: string
  backHref?: string
  panel: ReactNode
  panelOpen: boolean
  setPanelOpen: (open: boolean) => void
  right?: ReactNode
  /** Главные цифры — маленькой плашкой под панелью; нажатие открывает задачу */
  metrics?: ReactNode
  bottom?: ReactNode
  children: ReactNode
  /** Поле листается (доска, список), а не двигается пальцами */
  scroll?: boolean
}) {
  useEffect(() => {
    document.body.classList.add('ws-mode')
    return () => document.body.classList.remove('ws-mode')
  }, [])
  return (
    <div className="ws wsx">
      <div className={'wsx-field' + (scroll ? ' scroll' : '')}>{children}</div>
      <div className="wsx-top">
        <div className="ws-pill ws-left">
          <a className="btn icon ws-btn" href={backHref} title={tr('На карту', 'To the map')} aria-label={tr('На карту', 'To the map')}>
            ←
          </a>
          <button className="ws-title" onClick={() => setPanelOpen(true)}>
            {title}
          </button>
          <button className="icon ws-btn" onClick={() => setPanelOpen(true)} title={tr('Задача и цели', 'Task and goals')} aria-label={tr('Задача и цели', 'Task and goals')}>
            ▤
          </button>
        </div>
        {right && <div className="ws-pill ws-right">{right}</div>}
      </div>
      {metrics && (
        <button className="ws-metrics" onClick={() => setPanelOpen(true)} title={tr('Метрики и цели', 'Metrics and goals')}>
          {metrics}
        </button>
      )}
      {bottom && (
        <div className="ws-tools" role="toolbar">
          {bottom}
        </div>
      )}
      {panelOpen && (
        <Sheet title={title} onClose={() => setPanelOpen(false)}>
          {panel}
          <button className="primary ws-start" onClick={() => setPanelOpen(false)}>
            {scroll ? tr('К заданию', 'To the task') : tr('К схеме', 'To the diagram')} →
          </button>
        </Sheet>
      )}
    </div>
  )
}

/** Кнопка нижней панели: значок и короткая подпись */
export function Tool({ icon, label, on, onClick, badge }: { icon: string; label: string; on?: boolean; onClick: () => void; badge?: ReactNode }) {
  return (
    <button className={'ws-tool' + (on ? ' on' : '')} onClick={onClick} aria-pressed={on}>
      <span className="ws-tool-icon">
        {icon}
        {badge !== undefined && <span className="ws-badge">{badge}</span>}
      </span>
      <span className="ws-tool-label">{label}</span>
    </button>
  )
}

/** Модальная шторка снизу: затемнение (нажатие закрывает), закреплённый заголовок, Esc */
export function Sheet({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    ref.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (prev?.isConnected) prev.focus({ preventScroll: true })
    }
  }, [onClose])
  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="ws-sheet open" ref={ref} tabIndex={-1} role="dialog" aria-modal aria-label={typeof title === 'string' ? title : undefined}>
        <div className="ws-panel-head">
          <b>{title}</b>
          <button className="icon" onClick={onClose} title={tr('Закрыть (Esc)', 'Close (Esc)')} aria-label={tr('Закрыть', 'Close')}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </>
  )
}

const MIN_SCALE = 0.15
const MAX_SCALE = 4
interface T {
  s: number
  x: number
  y: number
}

/**
 * Масштаб и сдвиг поля пальцами, как в Figma: двумя пальцами — масштаб и сдвиг (где бы они ни лежали),
 * одним по пустому месту — сдвиг; на тачпаде — щипок и прокрутка. Поле — содержимое естественного размера w×h.
 */
export function usePanZoom(w: number, h: number) {
  const outer = useRef<HTMLDivElement>(null)
  const [t, setT] = useState<T>({ s: 1, x: 0, y: 0 })
  const tRef = useRef(t)
  tRef.current = t
  const rect = () => outer.current?.getBoundingClientRect() ?? new DOMRect(0, 0, w, h)
  const clampS = (s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s))
  /** Поле не уезжает целиком: на экране всегда остаётся хотя бы его кусок */
  const keep = (n: T): T => {
    const r = rect()
    const margin = 80
    return { s: n.s, x: Math.max(margin - w * n.s, Math.min(r.width - margin, n.x)), y: Math.max(margin - h * n.s, Math.min(r.height - margin, n.y)) }
  }
  /** Что нарисовано на поле: рамка содержимого схемы (как «вписать» в Figma), иначе всё поле */
  const contentBox = () => {
    const svg = outer.current?.querySelector('.pz-inner svg') as SVGGraphicsElement | null
    try {
      const b = svg?.getBBox()
      if (b && b.width > 0 && b.height > 0) return { x: b.x - 20, y: b.y - 20, w: b.width + 40, h: b.height + 40 }
    } catch {
      /* svg ещё не отрисован */
    }
    return { x: 0, y: 0, w, h }
  }
  const fit = () => {
    const r = rect()
    if (!r.width || !r.height) return
    // сверху и снизу — плавающие панели: схему вписываем между ними
    const top = 104
    const bottom = 84
    const c = contentBox()
    const s = clampS(Math.min(r.width / c.w, (r.height - top - bottom) / c.h))
    setT({ s, x: (r.width - c.w * s) / 2 - c.x * s, y: top + (r.height - top - bottom - c.h * s) / 2 - c.y * s })
  }
  const zoomAt = (k: number, cx?: number, cy?: number) => {
    touched.current = true
    setT((c) => {
      const r = rect()
      const px = (cx ?? r.left + r.width / 2) - r.left
      const py = (cy ?? r.top + r.height / 2) - r.top
      const s = clampS(c.s * k)
      return keep({ s, x: px - (px - c.x) * (s / c.s), y: py - (py - c.y) * (s / c.s) })
    })
  }
  const to100 = () => zoomAt(1 / tRef.current.s)

  /** Масштаб уже трогали руками: тогда при смене размера поле не вписываем заново */
  const touched = useRef(false)
  // вписать при открытии и при смене размера экрана (поворот телефона), пока масштаб не трогали
  useEffect(() => {
    const el = outer.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (!touched.current) fit()
    })
    ro.observe(el)
    // схема дорисовывается после первого кадра (и анимирует раскладку): вписываем ещё раз, когда она готова
    const raf = requestAnimationFrame(() => !touched.current && fit())
    const late = setTimeout(() => !touched.current && fit(), 500)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(raf)
      clearTimeout(late)
    }
    // fit читает размеры при вызове
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, h])

  // колесо и тачпад: Ctrl/⌘ или щипок — масштаб у курсора, иначе — сдвиг
  useEffect(() => {
    const el = outer.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      touched.current = true
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.003), e.clientX, e.clientY)
      else setT((c) => keep({ ...c, x: c.x - (e.shiftKey ? e.deltaY : e.deltaX), y: c.y - (e.shiftKey ? 0 : e.deltaY) }))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ t: T; mid: { x: number; y: number }; dist: number; ids: number[] } | null>(null)
  const start = (ids: number[]) => {
    const p = ids.map((id) => pointers.current.get(id)!)
    const two = p.length >= 2
    gesture.current = {
      t: tRef.current,
      ids,
      mid: two ? { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 } : p[0],
      dist: two ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0,
    }
  }
  /** Пустое место поля: сам контейнер, корневой svg или помеченный фон */
  const isBackground = (el: Element) => el === outer.current || el.classList.contains('pz-inner') || el.tagName.toLowerCase() === 'svg' || el.classList.contains('pz-bg')
  const handlers = {
    onPointerDownCapture: (e: RPointerEvent<HTMLDivElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const ids = [...pointers.current.keys()]
      if (ids.length >= 2) {
        // второй палец: это масштаб и сдвиг, у элементов поля его забираем
        e.stopPropagation()
        start(ids.slice(0, 2))
      } else if (isBackground(e.target as Element) || (e.pointerType === 'mouse' && e.button === 1)) start(ids)
      if (gesture.current) {
        try {
          outer.current?.setPointerCapture(e.pointerId)
        } catch {
          /* синтетические события без захвата */
        }
      }
    },
    onPointerMoveCapture: (e: RPointerEvent<HTMLDivElement>) => {
      if (!pointers.current.has(e.pointerId)) return
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const g = gesture.current
      if (!g || !g.ids.includes(e.pointerId)) return
      // пока идёт жест, элементы поля движения не получают
      e.stopPropagation()
      touched.current = true
      const p = g.ids.map((id) => pointers.current.get(id)).filter(Boolean) as { x: number; y: number }[]
      const two = p.length >= 2 && g.dist > 0
      const mid = two ? { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 } : p[0]
      const s = two ? clampS(g.t.s * (Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) / g.dist)) : g.t.s
      const r = rect()
      // точка поля под пальцами в начале жеста остаётся под пальцами
      const fx = (g.mid.x - r.left - g.t.x) / g.t.s
      const fy = (g.mid.y - r.top - g.t.y) / g.t.s
      setT(keep({ s, x: mid.x - r.left - fx * s, y: mid.y - r.top - fy * s }))
    },
    onPointerUpCapture: (e: RPointerEvent<HTMLDivElement>) => {
      pointers.current.delete(e.pointerId)
      const g = gesture.current
      if (!g || !g.ids.includes(e.pointerId)) return
      const rest = [...pointers.current.keys()].filter((id) => g.ids.includes(id))
      if (rest.length) start(rest)
      else gesture.current = null
    },
    onPointerCancelCapture: (e: RPointerEvent<HTMLDivElement>) => {
      pointers.current.delete(e.pointerId)
      gesture.current = null
    },
    onContextMenu: () => {
      pointers.current.clear()
      gesture.current = null
    },
  }
  const inner: CSSProperties = { width: w, height: h, transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})`, transformOrigin: '0 0' }
  const refit = () => {
    touched.current = false
    fit()
  }
  return { outer, handlers, inner, scale: t.s, fit: refit, zoomIn: () => zoomAt(1.5), zoomOut: () => zoomAt(1 / 1.5), to100 }
}

/** Масштаб одним инструментом: проценты и меню, как в Figma */
export function ZoomMenu({ pz }: { pz: ReturnType<typeof usePanZoom> }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('pointerdown', close, true)
    return () => document.removeEventListener('pointerdown', close, true)
  }, [open])
  const items: [string, string, () => void][] = [
    [tr('Приблизить', 'Zoom in'), '+', pz.zoomIn],
    [tr('Отдалить', 'Zoom out'), '−', pz.zoomOut],
    [tr('Вписать схему', 'Zoom to fit'), 'Shift+1', pz.fit],
    ['100%', 'Shift+0', pz.to100],
  ]
  return (
    <div className="ws-zoom" ref={ref}>
      <button className="zoom-pct" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu">
        {Math.round(pz.scale * 100)}% ▾
      </button>
      {open && (
        <div className="panel zoom-menu" role="menu">
          {items.map(([label, key, act]) => (
            <button
              key={label}
              role="menuitem"
              onClick={() => {
                act()
                setOpen(false)
              }}
            >
              <span>{label}</span>
              <kbd>{key}</kbd>
            </button>
          ))}
          <p className="small muted">{tr('Двумя пальцами — масштаб и сдвиг, одним по пустому месту — сдвиг.', 'Two fingers zoom and pan; one finger on empty space pans.')}</p>
        </div>
      )}
    </div>
  )
}

/** Поле со схемой: масштаб и сдвиг пальцами */
export function PanZoomField({ pz, children }: { pz: ReturnType<typeof usePanZoom>; children: ReactNode }) {
  return (
    <div className="pz" ref={pz.outer} {...pz.handlers}>
      <div className="pz-inner" style={pz.inner}>
        {children}
      </div>
    </div>
  )
}
