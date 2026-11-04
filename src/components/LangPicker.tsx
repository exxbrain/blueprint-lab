import { useEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent } from 'react'
import { LANGS, lang, setLang } from '../i18n'
import { modalAbove } from './popover'

/**
 * Выбор языка: кнопка с текущим языком и меню — каждый язык своим названием, текущий отмечен.
 * Клавиатура как у меню: открыть — фокус на текущем языке, стрелки ходят по пунктам, Esc — закрыть и вернуться к кнопке,
 * уход Tab'ом — закрыть.
 */
export function LangPicker() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const items = useRef<(HTMLButtonElement | null)[]>([])
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    // Esc — в фазе погружения, как у остальных меню: закрывает меню, даже если фокус ушёл из него;
    // фокус возвращается на кнопку, только если был в меню
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || modalAbove()) return
      e.preventDefault()
      if (ref.current?.contains(document.activeElement)) btn.current?.focus()
      setOpen(false)
    }
    // переход по адресу (в том числе «Назад») закрывает меню
    const away = () => setOpen(false)
    document.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', esc, true)
    window.addEventListener('hashchange', away)
    // фокус — на текущем языке
    items.current[Math.max(0, LANGS.findIndex((l) => l.id === lang))]?.focus()
    return () => {
      document.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', esc, true)
      window.removeEventListener('hashchange', away)
    }
  }, [open])
  const onMenuKey = (e: RKeyboardEvent) => {
    // клавиши меню — только меню: стрелки не должны двигать выбранный блок на схеме (Esc ловится выше, в фазе погружения)
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) e.stopPropagation()
    const list = items.current.filter(Boolean) as HTMLButtonElement[]
    const i = list.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      list[(i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus()
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      list[e.key === 'Home' ? 0 : list.length - 1]?.focus()
    } else if (e.key === 'Tab') setOpen(false)
  }
  const cur = LANGS.find((l) => l.id === lang) ?? LANGS[0]
  return (
    <div className="lang-picker" ref={ref}>
      <button
        ref={btn}
        className={'lang-btn' + (open ? ' primary' : '')}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        // доступное имя начинается с видимого текста: читалка называет текущий язык
        aria-label={`${cur.name} (${cur.short}) — Language / Язык / 语言`}
        title="Language / Язык / 语言"
      >
        <span aria-hidden>🌐</span> <span className="lang-name">{cur.name}</span>
        <span className="lang-short">{cur.short}</span> ▾
      </button>
      {open && (
        <div className="panel lang-menu" role="menu" onKeyDown={onMenuKey}>
          {LANGS.map((l, i) => (
            <button
              key={l.id}
              ref={(el) => {
                items.current[i] = el
              }}
              role="menuitemradio"
              aria-checked={l.id === lang}
              lang={l.id}
              className={l.id === lang ? 'on' : ''}
              onClick={() => {
                setOpen(false)
                if (l.id !== lang) setLang(l.id)
              }}
            >
              <span>{l.name}</span>
              {l.id === lang && <span aria-hidden>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
