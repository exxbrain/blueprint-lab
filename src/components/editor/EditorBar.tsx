import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { tr } from '../../i18n'
import { PopoverDialog } from '../PopoverDialog'
import { sideColumn, usePopoverReflow } from '../popover'
import { ZoomMenu } from './ZoomMenu'
import type { Viewport } from './useViewport'

/**
 * Строка над схемой — общая для редакторов: слева «＋ Добавить…» с меню, справа масштаб и свои кнопки (подсказки).
 * Меню закрывается щелчком мимо и Esc.
 */
export function EditorBar({
  add,
  vp,
  right,
}: {
  add?: { label: string; caption?: string; open: boolean; setOpen: (open: boolean) => void; menu: ReactNode }
  vp?: Viewport
  right?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const setOpen = useRef(add?.setOpen)
  setOpen.current = add?.setOpen
  useEffect(() => {
    if (!add?.open) return
    // в фазе погружения: элементы схемы останавливают всплытие, а меню должно закрыться и от щелчка по ним
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen.current?.(false)
    // Esc закрывает только меню: событие помечено обработанным, страница (окно блока, выделение) его пропускает
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      setOpen.current?.(false)
    }
    document.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', esc)
    }
  }, [add?.open])
  return (
    <div className="add-bar editor-bar" ref={ref}>
      {add && (
        <button className={'add-btn' + (add.open ? ' primary' : '')} onClick={() => add.setOpen(!add.open)} aria-expanded={add.open} aria-haspopup="menu">
          ＋ {add.label}
        </button>
      )}
      {add?.caption && <span className="small muted">{add.caption}</span>}
      <div className="editor-bar-right">
        {vp && <ZoomMenu vp={vp} />}
        {right}
      </div>
      {add?.open && (
        <div className="panel palette add-menu" role="menu">
          {add.menu}
        </div>
      )}
    </div>
  )
}

/**
 * Окно свойств выбранного элемента — общее для редакторов: на компьютере колонка сбоку от элемента
 * (элемент на схеме помечен data-id), на телефоне — модальная шторка. Щелчок по другому элементу (keep) переключает окно.
 */
export function ElementDialog({
  wrap,
  id,
  label,
  title,
  tone,
  keep,
  onClose,
  children,
}: {
  wrap: HTMLElement | null
  id: string
  label: string
  /** Заголовок с крестиком; без него — свой заголовок внутри children */
  title?: ReactNode
  tone?: string
  keep: string
  onClose: () => void
  children: ReactNode
}) {
  usePopoverReflow()
  // элемент мог появиться в той же отрисовке (только что поставили): место считаем ещё раз, когда он уже в документе
  const [, relayout] = useState(0)
  useLayoutEffect(() => relayout((n) => n + 1), [id])
  const el = wrap?.querySelector(`[data-id="${CSS.escape(id)}"]`)
  const r = el?.getBoundingClientRect()
  const style = r ? sideColumn(r.left, r.right, 320, r.top) : { left: 8, top: 72 }
  return (
    <PopoverDialog
      label={label}
      className={'node-popover' + (tone ? ' tone-' + tone : '')}
      style={style}
      onClose={onClose}
      keep={keep}
      rootProps={{ onPointerDown: (e) => e.stopPropagation() }}
    >
      {title !== undefined && (
        <div className="card-head">
          <b>{title}</b>
          <button className="icon" onClick={onClose} title={tr('Закрыть (Esc)', 'Close (Esc)', '关闭（Esc）')} aria-label={tr('Закрыть', 'Close', '关闭')}>
            ✕
          </button>
        </div>
      )}
      {children}
    </PopoverDialog>
  )
}
