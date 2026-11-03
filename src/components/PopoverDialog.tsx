import { useEffect, useRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useBottomSheet, useCloseOnOutside, usePhone } from './popover'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Окно параметров элемента по правилам диалога.
 * Компьютер: колонка сбоку от элемента, схема рядом остаётся доступной; закрывается крестиком, Esc и щелчком мимо.
 * Телефон: модальная шторка снизу — под ней затемнение (нажатие по нему закрывает и ничего под ним не нажимает),
 * заголовок с крестиком закреплён, страница под шторкой не листается, Tab не уходит из окна.
 * Фокус при открытии — в окно (не в поле ввода: иначе на телефоне выскочит клавиатура), после закрытия — обратно.
 * Esc обрабатывает страница: она же закрывает и другие свои окна.
 */
export function PopoverDialog({
  label,
  className,
  style,
  onClose,
  keep,
  rootProps,
  children,
}: {
  label: string
  className: string
  style: CSSProperties
  onClose: () => void
  /** Щелчок по этим элементам не закрывает окно: например, по другому блоку схемы — окно переключится на него */
  keep: string
  rootProps?: HTMLAttributes<HTMLDivElement>
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const phone = usePhone()
  useCloseOnOutside(ref, onClose, keep + ', .sheet-scrim')
  const sheet = useBottomSheet(ref, body, onClose)

  // фокус: в окно при открытии, обратно при закрытии
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    ref.current?.focus({ preventScroll: true })
    return () => {
      if (prev?.isConnected) prev.focus({ preventScroll: true })
    }
  }, [])

  // модальная шторка: страница под ней не листается
  useEffect(() => {
    if (!phone) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [phone])

  // модальная шторка: Tab ходит по кругу внутри окна
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    rootProps?.onKeyDown?.(e)
    if (!phone || e.key !== 'Tab' || !ref.current) return
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  // через портал в body: position: fixed внутри панелей с эффектами считался бы от панели
  return createPortal(
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div
        {...rootProps}
        ref={ref}
        role="dialog"
        aria-modal={phone || undefined}
        aria-label={label}
        tabIndex={-1}
        className={className + (sheet.full ? ' sheet-full' : '')}
        style={style}
        onKeyDown={onKeyDown}
      >
        <div className="sheet-handle" {...sheet.handle} aria-hidden />
        <div className="popover-body" ref={body}>
          {children}
        </div>
      </div>
    </>,
    document.body,
  )
}
