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
    // панели в одну колонку (телефон, узкое окно): точки летели бы сквозь соседние панели — без анимации
    if (window.matchMedia('(max-width: 1100px)').matches) return
    const picked = items.length > maxPerFrame ? sample(items, maxPerFrame) : items
    const root = layer.parentElement!
    const base = root.getBoundingClientRect()
    for (const f of picked) {
      const a = root.querySelector(`[data-anchor="${f.from}"]`)
      const b = root.querySelector(`[data-anchor="${f.to}"]`)
      if (!a || !b) continue
      const ra = a.getBoundingClientRect()
      const rb = b.getBoundingClientRect()
      const leftToRight = ra.left + ra.width / 2 < rb.left + rb.width / 2
      const x1 = (leftToRight ? ra.right : ra.left) - base.left
      const y1 = ra.top + ra.height / 2 - base.top
      const x2 = (leftToRight ? rb.left : rb.right) - base.left
      const y2 = rb.top + rb.height / 2 - base.top
      const dot = document.createElement('span')
      dot.className = 'flight-dot'
      dot.style.background = f.color
      layer.appendChild(dot)
      const midY = (y1 + y2) / 2 - 18
      const anim = dot.animate(
        [
          { transform: `translate(${x1}px, ${y1}px) scale(0.6)`, opacity: 0 },
          { transform: `translate(${(x1 + x2) / 2}px, ${midY}px) scale(1)`, opacity: 1, offset: 0.5 },
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
