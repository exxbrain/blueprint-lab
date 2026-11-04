import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

/** Перерисовка при прокрутке и изменении окна — колонка держится у элемента */
export function usePopoverReflow() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const h = () => setTick((t) => t + 1)
    window.addEventListener('resize', h)
    window.addEventListener('scroll', h, true)
    // масштаб и сдвиг схемы — элемент на экране переехал
    window.addEventListener('canvas-view', h)
    return () => {
      window.removeEventListener('resize', h)
      window.removeEventListener('scroll', h, true)
      window.removeEventListener('canvas-view', h)
    }
  }, [])
}

/**
 * Колонка сбоку от элемента (координаты экрана): верх — на уровне элемента, высота — по содержимому.
 * Не помещается ниже — PopoverDialog поднимет её, но не выше шапки (лишнего пустого места нет).
 */
export function sideColumn(left: number, right: number, width: number, anchorTop?: number): CSSProperties {
  const header = (document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0) + 8
  const x = right + 12 + width <= window.innerWidth - 8 ? right + 12 : Math.max(8, left - 12 - width)
  const top = Math.max(header, Math.min(anchorTop ?? header, window.innerHeight - 160))
  return { left: x, top, maxHeight: window.innerHeight - 8 - top }
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

const PHONE = '(max-width: 640px)'

/** Телефонная раскладка (та же граница, что в CSS) */
export function usePhone(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(PHONE)
      // и смена медиазапроса, и изменение размера окна: событие медиазапроса браузер иногда придерживает
      m.addEventListener('change', cb)
      window.addEventListener('resize', cb)
      return () => {
        m.removeEventListener('change', cb)
        window.removeEventListener('resize', cb)
      }
    },
    () => window.matchMedia(PHONE).matches,
  )
}

/**
 * На телефоне окно — шторка снизу. Сначала она занимает чуть больше половины экрана;
 * стоит прокрутить содержимое — вытягивается почти до шапки. За полоску сверху её тянут:
 * вверх — развернуть, вниз — свернуть, а свёрнутую — закрыть. Касание полоски — развернуть или свернуть.
 * На компьютере ничего не делает: там окно — колонка сбоку.
 */
export function useBottomSheet(root: RefObject<HTMLElement | null>, body: RefObject<HTMLElement | null>, onClose: () => void) {
  const [full, setFull] = useState(false)
  const drag = useRef<{ y: number; h: number; dy: number } | null>(null)
  useEffect(() => {
    const el = body.current
    if (!el) return
    const onScroll = () => {
      if (el.scrollTop > 4 && window.matchMedia(PHONE).matches) setFull(true)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [body])

  const style = (css: Partial<CSSStyleDeclaration>) => root.current && Object.assign(root.current.style, css)
  const handle = {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (!root.current) return
      drag.current = { y: e.clientY, h: root.current.getBoundingClientRect().height, dy: 0 }
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* синтетические события без захвата */
      }
      style({ transition: 'none' })
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const d = drag.current
      if (!d) return
      d.dy = e.clientY - d.y
      // вниз шторка уезжает целиком, вверх — растёт
      if (d.dy > 0) style({ transform: `translateY(${d.dy}px)`, maxHeight: '' })
      else style({ transform: '', maxHeight: `${d.h - d.dy}px` })
    },
    onPointerUp: () => {
      const d = drag.current
      if (!d) return
      drag.current = null
      style({ transition: '', transform: '', maxHeight: '' })
      if (Math.abs(d.dy) < 6) setFull(!full)
      else if (d.dy < -40) setFull(true)
      else if (d.dy > 60) {
        if (full) setFull(false)
        else onClose()
      }
    },
    onPointerCancel: () => {
      drag.current = null
      style({ transition: '', transform: '', maxHeight: '' })
    },
  }
  return { full, handle }
}

/**
 * Клавиша нажата в открытом меню (язык, масштаб, добавление) или на кнопке, которая его открыла
 * (у меню масштаба и «Добавить» фокус после открытия остаётся на кнопке): она для меню, а не для схемы
 */
export function inMenu(t: EventTarget | null): boolean {
  return !!(t as Element | null)?.closest?.('[role="menu"], [aria-haspopup="menu"][aria-expanded="true"]')
}

/** Фокус в поле ввода или списке: клавиши достаются ему, а не схеме */
export function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

