import { useEffect, useRef, useState } from 'react'
import { tr } from '../../i18n'
import { usePhone } from '../popover'
import type { Viewport } from './useViewport'

/**
 * Масштаб одним инструментом, как в Figma: проценты и меню.
 * Одно на все редакторы схем; на компьютере в меню подписаны сочетания клавиш, на телефоне — жесты.
 */
export function ZoomMenu({ vp }: { vp: Viewport }) {
  const phone = usePhone()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  const items: [string, string, () => void, boolean][] = [
    [tr('Приблизить', 'Zoom in'), '+', () => vp.zoomBy(1.5), vp.canZoomIn],
    [tr('Отдалить', 'Zoom out'), '−', () => vp.zoomBy(1 / 1.5), vp.zoomed],
    [tr('Вписать схему', 'Zoom to fit'), 'Shift+1', () => vp.fit(), true],
    [tr('К выбранному', 'Zoom to selection'), 'Shift+2', vp.fitSelection, vp.hasSelection()],
    ['100%', 'Shift+0', vp.to100, vp.can100],
    [tr('Весь холст', 'Whole canvas'), '', vp.reset, vp.zoomed],
  ]
  return (
    <div className="zoom-tool" ref={ref}>
      <button
        className="zoom-pct"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={tr('Масштаб: на телефоне — двумя пальцами, на компьютере — Ctrl/⌘ + колесо или щипок', 'Zoom: two fingers on a phone, Ctrl/⌘ + wheel or pinch on a computer')}
      >
        {Math.round(vp.scale * 100)}% ▾
      </button>
      {open && (
        <div className="panel zoom-menu" role="menu">
          {items.map(([label, key, act, ok]) => (
            <button
              key={label}
              role="menuitem"
              disabled={!ok}
              onClick={() => {
                act()
                setOpen(false)
              }}
            >
              <span>{label}</span>
              {!phone && key && <kbd>{key}</kbd>}
            </button>
          ))}
          <p className="small muted">
            {phone
              ? tr('Двумя пальцами — масштаб и сдвиг, одним по пустому месту — сдвиг приближенной схемы.', 'Two fingers zoom and pan; one finger on empty space pans a zoomed diagram.')
              : tr('Сдвиг: колесо, пробел + перетаскивание, средняя кнопка мыши.', 'Pan: wheel, space + drag, middle mouse button.')}
          </p>
        </div>
      )}
    </div>
  )
}
