import { useEffect, useRef, useState } from 'react'
import { tr } from '../i18n'

/**
 * Подсказки прямо на поле: те же, что в условии задачи, и тот же счётчик (он ограничивает звёзды).
 * Работаешь на холсте — подсказка под рукой, не нужно прокручивать к условию.
 */
export function HintDock({ hints, used, take }: { hints: string[]; used: number; take: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const shown = Math.min(used, hints.length)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open])
  if (!hints.length) return null
  return (
    <div className="hint-dock" ref={ref}>
      <button className={'hint-dock-btn' + (open ? ' primary' : '')} onClick={() => setOpen(!open)} aria-expanded={open}>
        💡 {tr('Подсказки', 'Hints')} ({shown}/{hints.length})
      </button>
      {open && (
        <div className="panel hint-dock-card" role="dialog">
          {shown > 0 ? (
            <ol className="small">
              {hints.slice(0, shown).map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ol>
          ) : (
            <p className="small muted">{tr('Подсказок пока не брали.', 'No hints taken yet.')}</p>
          )}
          {shown < hints.length && (
            <button onClick={take}>
              💡 {shown === 0 ? tr('Взять подсказку', 'Take a hint') : tr('Ещё подсказка', 'Another hint')}
            </button>
          )}
          <p className="small muted hint-dock-note">
            {tr('Каждая подсказка снижает потолок звёзд: без подсказок — ★★★, с одной — ★★.', 'Each hint lowers the star ceiling: no hints ★★★, one hint ★★.')}
          </p>
        </div>
      )}
    </div>
  )
}
