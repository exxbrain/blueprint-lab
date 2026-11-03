import { useEffect, useRef, useState } from 'react'
import { LANGS, lang, setLang } from '../i18n'

/** Выбор языка: кнопка с текущим языком и меню — каждый язык своим названием, текущий отмечен */
export function LangPicker() {
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
  const cur = LANGS.find((l) => l.id === lang) ?? LANGS[0]
  return (
    <div className="lang-picker" ref={ref}>
      <button className={'lang-btn' + (open ? ' primary' : '')} onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" aria-label="Language / Язык / 语言">
        <span aria-hidden>🌐</span> <span className="lang-name">{cur.name}</span>
        <span className="lang-short">{cur.short}</span> ▾
      </button>
      {open && (
        <div className="panel lang-menu" role="menu">
          {LANGS.map((l) => (
            <button
              key={l.id}
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
