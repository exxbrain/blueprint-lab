import { useEffect, useRef } from 'react'

export interface Flight {
  from: string
  to: string
  color: string
}

interface Props {
  /** Мутабельная очередь: слой забирает из неё всё при каждом рендере */
  queue: Flight[]
  maxPerFrame?: number
  duration?: number
}

/**
 * Слой анимаций поверх схемы: точки «летят» между элементами с data-anchor.
 * Анимация через Web Animations API, без React-состояния — дёшево даже при высоком потоке.
 * Ставится внутрь контейнера с position: relative, который содержит все якоря.
 */
export function FlightLayer({ queue, maxPerFrame = 6, duration = 650 }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const layer = ref.current
    if (!layer) return
    const items = queue.splice(0)
    if (items.length === 0) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const picked = items.length > maxPerFrame ? sample(items, maxPerFrame) : items
    const root = layer.parentElement!
    const base = root.getBoundingClientRect()
    for (const f of picked) {
      const a = root.querySelector(`[data-anchor="${f.from}"]`)
      const b = root.querySelector(`[data-anchor="${f.to}"]`)
      if (!a || !b) continue
      const ra = a.getBoundingClientRect()
      const rb = b.getBoundingClientRect()
      const dx = rb.left + rb.width / 2 - (ra.left + ra.width / 2)
      const dy = rb.top + rb.height / 2 - (ra.top + ra.height / 2)
      // панели рядом (компьютер) — летим вбок от края к краю с горкой вверх;
      // панели одна под другой (телефон, узкое окно) — вниз или вверх от края к краю с горкой вбок
      const vertical = Math.abs(dy) > Math.abs(dx)
      let x1, y1, x2, y2, mx, my
      if (vertical) {
        const down = dy > 0
        x1 = ra.left + ra.width / 2 - base.left
        y1 = (down ? ra.bottom : ra.top) - base.top
        x2 = rb.left + rb.width / 2 - base.left
        y2 = (down ? rb.top : rb.bottom) - base.top
        mx = (x1 + x2) / 2 + 18
        my = (y1 + y2) / 2
      } else {
        const leftToRight = dx > 0
        x1 = (leftToRight ? ra.right : ra.left) - base.left
        y1 = ra.top + ra.height / 2 - base.top
        x2 = (leftToRight ? rb.left : rb.right) - base.left
        y2 = rb.top + rb.height / 2 - base.top
        mx = (x1 + x2) / 2
        my = (y1 + y2) / 2 - 18
      }
      const dot = document.createElement('span')
      dot.className = 'flight-dot'
      dot.style.background = f.color
      // свечение рисуется один раз вместе со слоем шарика (двигается transform) — кадры оно не утяжеляет
      dot.style.boxShadow = `0 0 8px ${f.color}`
      layer.appendChild(dot)
      const anim = dot.animate(
        [
          { transform: `translate(${x1}px, ${y1}px) scale(0.6)`, opacity: 0 },
          { transform: `translate(${mx}px, ${my}px) scale(1)`, opacity: 1, offset: 0.5 },
          { transform: `translate(${x2}px, ${y2}px) scale(0.6)`, opacity: 0.2 },
        ],
        { duration: duration * (0.85 + Math.random() * 0.3), easing: 'ease-in-out' },
      )
      anim.onfinish = () => dot.remove()
    }
  })

  return <div ref={ref} className="flight-layer" aria-hidden />
}

function sample<T>(arr: T[], n: number): T[] {
  const out: T[] = []
  const step = arr.length / n
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)])
  return out
}
