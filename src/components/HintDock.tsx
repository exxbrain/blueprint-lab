import { useEffect, useRef, useState } from 'react'
import { tr } from '../i18n'
import type { Diagnosis } from '../sim/builder/diagnose'

/**
 * Подсказки прямо на поле: те же, что в условии задачи, и тот же счётчик (он ограничивает звёзды).
 * Работаешь на холсте — подсказка под рукой, не нужно прокручивать к условию.
 */
export function HintDock({
  hints,
  used,
  take,
  live,
  liveLocked,
  onPick,
  compact,
}: {
  hints: string[]
  used: number
  take: () => void
  /** Что прямо сейчас мешает на поле — бесплатно, звёзды не снижает */
  live?: Diagnosis[]
  /** Почему диагностика пока молчит (например, до прикидки нагрузки) */
  liveLocked?: string
  onPick?: (nodeId: string) => void
  /** Только значок и счётчик — для плавающей панели на телефоне */
  compact?: boolean
}) {
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
  if (!hints.length && !live) return null
  const worst = live?.find((d) => d.tone === 'bad') ? 'bad' : live?.find((d) => d.tone === 'warn') ? 'warn' : live?.length ? 'ok' : null
  return (
    <div className="hint-dock" ref={ref}>
      <button className={'hint-dock-btn' + (open ? ' primary' : '')} onClick={() => setOpen(!open)} aria-expanded={open} aria-label={tr('Подсказки', 'Hints', '提示')}>
        {worst && !liveLocked && <span className={'hint-dot ' + worst} />}
        💡{!compact && ` ${tr('Подсказки', 'Hints', '提示')}`}
        {hints.length > 0 && (compact ? ` ${shown}/${hints.length}` : ` (${shown}/${hints.length})`)}
      </button>
      {open && (
        <div className="panel hint-dock-card" role="dialog">
          {live && (
            <div className="live-hints">
              <div className="pattern-group-title">🔍 {tr('Сейчас на поле', 'Right now on the field', '画布上当前的情况')}</div>
              {liveLocked ? (
                <p className="small muted">{liveLocked}</p>
              ) : (
                <ul>
                  {live.slice(0, 3).map((d, i) => (
                    <li key={i + d.text} className={'live-hint ' + d.tone}>
                      {d.nodeId && onPick ? (
                        <button className="live-hint-link" onClick={() => onPick(d.nodeId!)} title={tr('Показать блок', 'Show the block', '显示该组件')}>
                          {d.text}
                        </button>
                      ) : (
                        d.text
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="small muted hint-dock-note">{tr('Это бесплатно: звёзды не снижает.', 'This is free: it does not lower your stars.', '这是免费的：不会降低你的星级。')}</p>
            </div>
          )}
          {hints.length > 0 && live && <div className="pattern-group-title">💡 {tr('Подсказки к решению', 'Hints toward the solution', '解题提示')}</div>}
          {hints.length === 0 ? null : shown > 0 ? (
            <ol className="small">
              {hints.slice(0, shown).map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ol>
          ) : (
            <p className="small muted">{tr('Подсказок пока не брали.', 'No hints taken yet.', '还没有使用过提示。')}</p>
          )}
          {hints.length > 0 && shown < hints.length && (
            <button onClick={take}>
              💡 {shown === 0 ? tr('Взять подсказку', 'Take a hint', '获取提示') : tr('Ещё подсказка', 'Another hint', '再要一条提示')}
            </button>
          )}
          {hints.length > 0 && (
            <p className="small muted hint-dock-note">
              {tr('Каждая подсказка снижает потолок звёзд: без подсказок — ★★★, с одной — ★★.', 'Each hint lowers the star ceiling: no hints ★★★, one hint ★★.', '每条提示都会降低星级上限：不用提示 ★★★，用一条 ★★。')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
