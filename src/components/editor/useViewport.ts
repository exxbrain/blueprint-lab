import { useCallback, useEffect, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react'
import { inMenu } from '../popover'

/** Масштаб как в Figma: 100% — 1 единица схемы на 1 пиксель экрана; от «весь холст» до 400% */
export const MAX_SCALE = 4

/** Прямоугольник в координатах схемы */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
type View = { x: number; y: number; w: number }

/** Фокус в поле ввода: клавиши достаются ему, а не схеме */
const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

export interface ViewportOptions {
  /** Размер схемы в её единицах */
  width: number
  height: number
  /** Витрина: без масштаба и жестов */
  disabled?: boolean
  /** Что нарисовано — для «вписать схему»; без него — рамка всего, что в svg */
  content?: () => Rect | null
  /** Выбранное — для «к выбранному» */
  selection?: () => Rect | null
  /** При открытии вписать схему (не крупнее 100%) — на телефоне */
  autoFit?: boolean
  /** Второй палец лёг на поле: начатое перетаскивание элемента нужно отменить */
  onSecondFinger?: () => void
}

/**
 * Общая для всех редакторов схем (конструктор, C4, распил) работа с полем, как в Figma.
 * Видимая часть задаётся viewBox: схема остаётся векторной и попадание по элементам точное.
 * - проценты масштаба, «вписать», «к выбранному», 100%, «весь холст»;
 * - колесо: с Ctrl/⌘ и щипок на тачпаде — масштаб у курсора, без — сдвиг приближенной схемы (иначе листается страница);
 * - пробел + перетаскивание и средняя кнопка мыши — сдвиг откуда угодно;
 * - пальцы: одним по пустому месту — сдвиг приближенной схемы, двумя где угодно — масштаб и сдвиг;
 * - клавиши: Shift+1, Shift+2, Shift+0, +/−.
 * Поле может быть любой формы (на телефоне — весь экран): пропорции видимой части берутся из размера svg на экране.
 */
export function useViewport(o: ViewportOptions) {
  const { width, height } = o
  const opts = useRef(o)
  opts.current = o
  const [box, setBox] = useState({ w: 0, h: 0 })
  // холст пересоздаётся при смене раскладки (телефон ↔ компьютер): ref-колбэк, и подписки переходят на новый
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [svgEl, setSvgEl] = useState<SVGSVGElement | null>(null)
  const bindSvg = useCallback((node: SVGSVGElement | null) => {
    // новый холст — прежний замер (пропорции другой раскладки) не годится: мерить заново
    if (node && node !== svgRef.current) setBox({ w: 0, h: 0 })
    svgRef.current = node
    setSvgEl(node)
  }, [])

  const [view, setView] = useState<View | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view
  const aspectRef = useRef(height / width)
  aspectRef.current = box.w && box.h ? box.h / box.w : height / width
  const A = () => aspectRef.current
  const maxW = () => Math.max(width, height / A())
  const minW = () => (svgRef.current?.clientWidth || width) / MAX_SCALE
  /** Весь холст целиком, по центру */
  const whole = (): View => {
    const w = maxW()
    return { x: (width - w) / 2, y: (height - w * A()) / 2, w }
  }
  const clampView = (v: View): View | null => {
    const w = Math.max(Math.min(minW(), maxW()), Math.min(maxW(), v.w))
    if (w >= maxW() - 1) return null
    const h = w * A()
    // меньше холста — не выходит за холст; больше — держит холст в кадре, но может встать серединой на схему
    const along = (pos: number, size: number, total: number) =>
      size <= total ? Math.max(0, Math.min(total - size, pos)) : Math.max(total - size, Math.min(0, pos))
    return { x: along(v.x, w, width), y: along(v.y, h, height), w }
  }

  // размер svg на экране; сменил форму (растянулся на экран, повернули телефон) — видимая часть держит центр
  useEffect(() => {
    const svg = svgEl
    if (!svg || o.disabled) return
    const ro = new ResizeObserver(() => {
      const w = svg.clientWidth
      const h = svg.clientHeight
      if (!w || !h) return
      const was = aspectRef.current
      aspectRef.current = h / w
      if (Math.abs(was - h / w) > 1e-6) setView((v) => v && clampView({ x: v.x, y: v.y + (v.w * (was - h / w)) / 2, w: v.w }))
      setBox({ w, h })
    })
    ro.observe(svg)
    return () => ro.disconnect()
    // clampView читает пропорции через ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svgEl, o.disabled])
  // окна у элементов (параметры, свойства) пересчитывают место, когда схема сдвинулась
  useEffect(() => {
    window.dispatchEvent(new Event('canvas-view'))
  }, [view])

  const toSvg = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current!
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse())
    return { x: p.x, y: p.y }
  }
  /** Приблизить в k раз, держа точку at (координаты схемы) на месте; без at — относительно середины */
  const zoomBy = (k: number, at?: { x: number; y: number }) =>
    setView((v) => {
      const c = v ?? whole()
      const p = at ?? { x: c.x + c.w / 2, y: c.y + (c.w * A()) / 2 }
      const w = c.w / k
      return clampView({ x: p.x - (p.x - c.x) * (w / c.w), y: p.y - (p.y - c.y) * (w / c.w), w })
    })
  /** Показать прямоугольник целиком и как можно крупнее (не крупнее maxScale) */
  const fitRect = (r: Rect, maxScale = MAX_SCALE) => {
    const cw = svgRef.current?.clientWidth || width
    // ширину ограничиваем до расчёта угла: упор в предел масштаба не сдвигает схему от центра
    const raw = Math.max(r.w, r.h / A(), cw / maxScale)
    const w = Math.max(Math.min(minW(), maxW()), Math.min(maxW(), raw))
    setView(clampView({ x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - (w * A()) / 2, w }))
  }
  const drawn = (): Rect | null => {
    if (opts.current.content) return opts.current.content()
    try {
      const b = svgRef.current?.getBBox()
      return b && b.width > 0 && b.height > 0 ? { x: b.x - 20, y: b.y - 20, w: b.width + 40, h: b.height + 40 } : null
    } catch {
      return null // svg ещё не отрисован
    }
  }
  const fit = (maxScale = MAX_SCALE) => {
    const r = drawn()
    if (!r) return setView(null)
    fitRect(r, maxScale)
  }
  const fitSelection = () => {
    const r = opts.current.selection?.()
    if (r) fitRect(r)
  }
  const to100 = () => zoomBy((viewRef.current ?? whole()).w / (svgRef.current?.clientWidth || width))
  /** Новый элемент: если схема приближена и он вне видимой части — сдвинуть к нему */
  const reveal = (r: Rect) =>
    setView((v) => {
      if (!v) return v
      const h = v.w * A()
      const inside = r.x >= v.x && r.x + r.w <= v.x + v.w && r.y >= v.y && r.y + r.h <= v.y + h
      return inside ? v : clampView({ x: r.x + r.w / 2 - v.w / 2, y: r.y + r.h / 2 - h / 2, w: v.w })
    })

  const cur = view ?? whole()
  const scale = (box.w || svgRef.current?.clientWidth || width) / cur.w
  const wholeScale = (svgRef.current?.clientWidth || width) / maxW()

  // при открытии — вписать (не крупнее 100%) и вписывать при смене размера экрана, пока масштаб не трогали руками;
  // ещё раз чуть позже: схема может доиграть анимацию раскладки
  const auto = useRef(true)
  useEffect(() => {
    if (!o.autoFit || !auto.current || !box.w) return
    fit(1)
    // при каждом новом размере
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.autoFit, box.w, box.h])
  useEffect(() => {
    if (!o.autoFit) return
    const t = setTimeout(() => auto.current && fit(1), 500)
    return () => clearTimeout(t)
    // один раз после открытия
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.autoFit])
  /** Действие человека: дальше масштаб сам не перевписывается */
  const byHand = () => (auto.current = false)

  // ---- жесты
  const pointers = useRef(new Map<number, { x: number; y: number; touch: boolean }>())
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ view: View; mid: { x: number; y: number }; dist: number; rect: DOMRect } | null>(null)
  const [panning, setPanning] = useState(false)
  const lastPan = useRef(0)
  /** Текущий жест уже сдвигал схему */
  const panMoved = useRef(false)
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
    // точка схемы под пальцами в начале жеста остаётся под пальцами
    const s0 = g.rect.width / g.view.w
    const px = g.view.x + (g.mid.x - g.rect.left) / s0
    const py = g.view.y + (g.mid.y - g.rect.top) / s0
    const s = g.rect.width / w
    lastPan.current = Date.now()
    panMoved.current = true
    byHand()
    setView(clampView({ x: px - (mid.x - g.rect.left) / s, y: py - (mid.y - g.rect.top) / s, w }))
  }
  const capture = (id: number) => {
    try {
      svgRef.current?.setPointerCapture(id)
    } catch {
      // указатель уже отпущен — захватывать нечего
    }
  }
  const hover = useRef(false)
  const spaceRef = useRef(false)
  const [space, setSpace] = useState(false)

  /** Для svg: перехват нажатий — сдвиг пробелом и средней кнопкой, второй палец — масштаб */
  /** Холст сообщает, как отменить своё начатое перетаскивание, — на случай второго пальца */
  const secondFinger = useRef<(() => void) | null>(null)
  const onPointerDownCapture = (e: RPointerEvent) => {
    if (o.disabled) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse' })
    const mouse = e.pointerType === 'mouse'
    const panMouse = mouse && (e.button === 1 || (e.button === 0 && spaceRef.current))
    const twoFingers = !mouse && pointers.current.size >= 2
    if (!panMouse && !twoFingers) return
    // сдвиг или щипок забирают нажатие у элементов схемы
    e.stopPropagation()
    e.preventDefault()
    if (twoFingers) {
      opts.current.onSecondFinger?.()
      secondFinger.current?.()
      touches.current = new Map([...pointers.current].map(([id, p]) => [id, { x: p.x, y: p.y }]))
    } else touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    capture(e.pointerId)
    startGesture()
  }
  /** Нажатие по пустому месту схемы: одним пальцем или мышью — сдвиг (если схема приближена) */
  const onBackgroundDown = (e: RPointerEvent) => {
    if (o.disabled || e.button !== 0 || (e.pointerType === 'mouse' && e.ctrlKey)) return
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    capture(e.pointerId)
    startGesture()
  }
  /** Первым в onPointerMove: true — движение забрал жест */
  const onMove = (e: RPointerEvent) => {
    const was = pointers.current.get(e.pointerId)
    if (was) pointers.current.set(e.pointerId, { ...was, x: e.clientX, y: e.clientY })
    if (!touches.current.has(e.pointerId)) return false
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    moveGesture()
    return true
  }
  /** Первым в onPointerUp/Cancel: true — отпускание завершило жест */
  const onUp = (e: RPointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (!touches.current.delete(e.pointerId)) return false
    // отпустили после сдвига (даже если перед этим держали указатель) — щелчок «мимо» за ним не считается
    if (panMoved.current) lastPan.current = Date.now()
    if (!touches.current.size) panMoved.current = false
    startGesture()
    return true
  }
  /** Жест не отпускает указатель при уходе с холста */
  const holds = (id: number) => touches.current.has(id)
  /** Контекстное меню: долгое касание пальцем — не меню; мышь — забыть жест, отпускания может не быть */
  const onContextMenu = (e: RMouseEvent, reset?: () => void) => {
    if ([...pointers.current.values()].some((p) => p.touch)) {
      e.preventDefault()
      return
    }
    reset?.()
    touches.current.clear()
    pointers.current.clear()
    gesture.current = null
    panMoved.current = false
    setPanning(false)
  }

  // колесо: Ctrl/⌘ или щипок на тачпаде — масштаб у курсора; без них — сдвиг приближенной схемы (Shift — вбок)
  useEffect(() => {
    const svg = svgEl
    if (!svg || o.disabled) return
    const onWheel = (e: WheelEvent) => {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? svg.clientHeight : 1
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        byHand()
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
      // схеме двигаться некуда — листается страница
      if (!next || (Math.abs(next.x - v.x) < 0.01 && Math.abs(next.y - v.y) < 0.01)) return
      e.preventDefault()
      byHand()
      setView(next)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
    // всё нужное читается через ref и setView с функцией
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svgEl, o.disabled])

  // клавиши: Shift+1 — вписать, Shift+2 — к выбранному, Shift+0 — 100%, +/− — масштаб, пробел — рука.
  // Ctrl/⌘ + = и − перехватываем, только пока мышь над схемой
  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  keys.current = (e: KeyboardEvent) => {
    if (o.disabled || typing(e.target) || inMenu(e.target) || e.altKey) return
    const mod = e.ctrlKey || e.metaKey
    if (e.shiftKey && !mod && e.code === 'Digit1') fit()
    else if (e.shiftKey && !mod && e.code === 'Digit2') fitSelection()
    else if (e.shiftKey && !mod && e.code === 'Digit0') to100()
    else if ((e.key === '+' || e.key === '=') && (!mod || hover.current)) zoomBy(1.5)
    else if ((e.key === '-' || e.key === '_') && (!mod || hover.current)) zoomBy(1 / 1.5)
    else if (
      e.code === 'Space' &&
      hover.current &&
      !mod &&
      !(document.activeElement instanceof HTMLButtonElement) &&
      !(document.activeElement instanceof HTMLAnchorElement)
    ) {
      if (!e.repeat) {
        spaceRef.current = true
        setSpace(true)
      }
    } else return
    byHand()
    e.preventDefault()
  }
  useEffect(() => {
    if (o.disabled) return
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
  }, [o.disabled])

  /** Последний сдвиг пальцем или мышью был только что: щелчок «по пустому месту» после него — не щелчок */
  const recentlyPanned = () => Date.now() - lastPan.current < 350
  return {
    svgRef,
    bindSvg,
    recentlyPanned,
    viewBox: `${cur.x} ${cur.y} ${cur.w} ${cur.w * A()}`,
    zoomed: !!view,
    scale,
    canZoomIn: scale < MAX_SCALE - 0.01,
    /** 100% недостижимо, если весь холст и так крупнее (широкий экран) */
    can100: wholeScale < 1,
    hasSelection: () => !!opts.current.selection?.(),
    // кнопки и меню — тоже действия человека
    zoomBy: (k: number, at?: { x: number; y: number }) => {
      byHand()
      zoomBy(k, at)
    },
    fit: (maxScale?: number) => {
      byHand()
      fit(maxScale)
    },
    fitSelection: () => {
      byHand()
      fitSelection()
    },
    to100: () => {
      byHand()
      to100()
    },
    reset: () => {
      byHand()
      setView(null)
    },
    secondFinger,
    reveal,
    toSvg,
    capture,
    /** Обёртке холста: наведение (для клавиш) и курсоры руки */
    stage: {
      className: (space ? ' space' : '') + (panning ? ' panning' : ''),
      onPointerEnter: () => (hover.current = true),
      onPointerLeave: () => (hover.current = false),
    },
    onPointerDownCapture,
    onBackgroundDown,
    onMove,
    onUp,
    holds,
    onContextMenu,
  }
}

export type Viewport = ReturnType<typeof useViewport>
