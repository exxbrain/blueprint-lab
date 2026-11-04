import { useEffect, useRef, useState } from 'react'
import { tr } from '../../i18n'
import { modalAbove, usePhone } from '../popover'
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
    // Esc закрывает только меню: событие помечено обработанным, страница (окно блока, выделение) его пропускает
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || modalAbove()) return
      e.preventDefault()
      setOpen(false)
    }
    document.addEventListener('pointerdown', close, true)
    // в фазе погружения — раньше обработчиков страницы, куда бы ни был фокус
    window.addEventListener('keydown', esc, true)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', esc, true)
    }
  }, [open])
  const items: [string, string, () => void, boolean][] = [
    [tr('Приблизить', 'Zoom in', '放大'), '+', () => vp.zoomBy(1.5), vp.canZoomIn],
    [tr('Отдалить', 'Zoom out', '缩小'), '−', () => vp.zoomBy(1 / 1.5), vp.zoomed],
    [tr('Вписать схему', 'Zoom to fit', '缩放以适应图表'), 'Shift+1', () => vp.fit(), true],
    [tr('К выбранному', 'Zoom to selection', '缩放到所选内容'), 'Shift+2', vp.fitSelection, vp.hasSelection()],
    ['100%', 'Shift+0', vp.to100, vp.can100],
    [tr('Весь холст', 'Whole canvas', '整个画布'), '', vp.reset, vp.zoomed],
  ]
  return (
    <div className="zoom-tool" ref={ref}>
      <button
        className="zoom-pct"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={tr('Масштаб: на телефоне — двумя пальцами, на компьютере — Ctrl/⌘ + колесо или щипок', 'Zoom: two fingers on a phone, Ctrl/⌘ + wheel or pinch on a computer', '缩放：手机上用双指，电脑上用 Ctrl/⌘ + 滚轮或触控板双指捏合')}
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
              ? tr('Двумя пальцами — масштаб и сдвиг, одним по пустому месту — сдвиг приближенной схемы.', 'Two fingers zoom and pan; one finger on empty space pans a zoomed diagram.', '双指可缩放和平移；放大后，单指在空白处拖动即可平移图表。')
              : tr('Сдвиг: колесо, пробел + перетаскивание, средняя кнопка мыши.', 'Pan: wheel, space + drag, middle mouse button.', '平移：滚轮、按住空格拖动，或按住鼠标中键拖动。')}
          </p>
        </div>
      )}
    </div>
  )
}
