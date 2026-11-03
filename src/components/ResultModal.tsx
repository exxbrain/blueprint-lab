import { useEffect, useRef, useState, type ReactNode } from 'react'
import { tr } from '../i18n'
import { TASK_XP, XP, taskLevel } from '../levels'
import { nextAfter } from './LevelMap'
import { useProgress } from '../progress'

/** Открывает окно результата в момент, когда задача становится решённой (а не при каждом рендере) */
export function useResultModal(solved: boolean, enabled = true) {
  const [open, setOpen] = useState(false)
  const was = useRef(solved)
  useEffect(() => {
    if (solved && !was.current && enabled) setOpen(true)
    if (!solved) setOpen(false)
    was.current = solved
  }, [solved, enabled])
  return { open, setOpen }
}

/** Кнопка «Результат» на месте, где раньше был разбор: место под неё есть всегда, поэтому ничего не прыгает */
export function ResultButton({ solved, onClick }: { solved: boolean; onClick: () => void }) {
  // до решения кнопка невидима, но место занимает — поэтому при решении ничего не сдвигается
  return (
    <button className={'result-btn' + (solved ? '' : ' reserved')} onClick={onClick} aria-hidden={!solved} tabIndex={solved ? 0 : -1} disabled={!solved}>
      🏆 {tr('Результат и разбор', 'Result and debrief')}
    </button>
  )
}

/** Окно «уровень пройден»: звёзды, опыт, разбор, следующий уровень */
export function ResultModal({
  open,
  onClose,
  progressKey,
  stars,
  title,
  next: custom,
  children,
}: {
  open: boolean
  onClose: () => void
  progressKey: string
  stars: number
  title?: string
  /** Свой следующий шаг (например, следующий этап проекта) вместо следующей задачи на карте */
  next?: { label: string; onClick: () => void }
  children: ReactNode
}) {
  const progress = useProgress()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  // переход по ссылке и закрытие окна: сначала переход — закрытие убирает ссылку из документа,
  // а по ссылке, которой уже нет в документе, браузер не переходит
  const go = (e: React.MouseEvent, to: string) => {
    e.preventDefault()
    window.location.hash = to
    onClose()
  }
  const level = taskLevel(progressKey)
  const xp = level ? Math.round(TASK_XP[level] * (1 + 0.25 * (stars - 1))) : 0
  const next = nextAfter(progress, progressKey)
  const best = progress.stars?.[progressKey] ?? 0
  return (
    <div className="ref-overlay result-overlay" onClick={onClose}>
      <div className="ref-modal panel result-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={tr('Результат', 'Result')}>
        <div className="result-hero">
          <div className="result-stars" aria-label={tr(`${stars} из 3`, `${stars} of 3`)}>
            {[1, 2, 3].map((i) => (
              <span key={i} className={i <= stars ? 'on' : ''} style={{ animationDelay: `${i * 0.15}s` }}>
                ★
              </span>
            ))}
          </div>
          <h2>{title ?? tr('Уровень пройден!', 'Level complete!')}</h2>
          {best > stars && (
            <div className="small muted">
              {tr(`За задачу засчитан ваш лучший результат: ${'★'.repeat(best)}`, `Your best result for this task counts: ${'★'.repeat(best)}`)}
            </div>
          )}
          {xp > 0 && (
            <div className="result-xp">
              +{xp} {XP}
            </div>
          )}
          <button className="icon result-close" onClick={onClose} title={tr('Закрыть (Esc)', 'Close (Esc)')}>
            ✕
          </button>
        </div>
        <div className="result-body">{children}</div>
        <div className="row result-actions">
          {custom && (
            <button
              className="primary"
              onClick={() => {
                onClose()
                custom.onClick()
              }}
            >
              ▶ {custom.label}
            </button>
          )}
          {!custom && next && (
            <a className="btn primary" href={next.href} onClick={(e) => go(e, next.href)}>
              ▶ {tr('Следующее задание', 'Next task')}: {next.title}
            </a>
          )}
          <button onClick={onClose}>{tr('Остаться и улучшить', 'Stay and improve')}</button>
          <a className="btn" href="#/" onClick={(e) => go(e, '#/')}>
            🗺️ {tr('К карте', 'To the map')}
          </a>
        </div>
      </div>
    </div>
  )
}
