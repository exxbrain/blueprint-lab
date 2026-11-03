import { useEffect, useState, type CSSProperties, type RefObject } from 'react'

/** Перерисовка при прокрутке и изменении окна — колонка держится у элемента */
export function usePopoverReflow() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const h = () => setTick((t) => t + 1)
    window.addEventListener('resize', h)
    window.addEventListener('scroll', h, true)
    return () => {
      window.removeEventListener('resize', h)
      window.removeEventListener('scroll', h, true)
    }
  }, [])
}

/** Колонка сбоку от элемента (координаты экрана): от шапки до низа окна */
export function sideColumn(left: number, right: number, width: number): CSSProperties {
  const top = (document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 60) + 8
  const x = right + 12 + width <= window.innerWidth - 8 ? right + 12 : Math.max(8, left - 12 - width)
  return { left: x, top, bottom: 8 }
}


/**
 * Окно закрывается от клика где угодно мимо него — как обычное всплывающее окно.
 * Клик по другому элементу схемы (keep) не закрывает: он просто переключает окно на этот элемент.
 */
export function useCloseOnOutside(ref: RefObject<HTMLElement | null>, onClose: () => void, keep: string) {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null
      if (!t || ref.current?.contains(t) || t.closest?.(keep)) return
      onClose()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [ref, onClose, keep])
}
