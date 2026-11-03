import { useEffect, useRef, type ReactNode } from 'react'
import { tr } from '../i18n'

/**
 * Рабочий экран на телефоне, как в Figma: поле на весь экран, инструменты — на плавающих панелях.
 * Слева сверху — назад, название и кнопка задачи; справа — инструменты экрана; снизу — панель кнопок.
 * Задача (условие, цели, проверка) — модальной шторкой; при входе она открыта.
 */
export function Workspace({
  title,
  backHref = '#/',
  panel,
  panelOpen,
  setPanelOpen,
  right,
  metrics,
  bottom,
  children,
  scroll,
}: {
  title: string
  backHref?: string
  panel: ReactNode
  panelOpen: boolean
  setPanelOpen: (open: boolean) => void
  right?: ReactNode
  /** Главные цифры — маленькой плашкой под панелью; нажатие открывает задачу */
  metrics?: ReactNode
  bottom?: ReactNode
  children: ReactNode
  /** Поле листается (доска, список), а не двигается пальцами */
  scroll?: boolean
}) {
  useEffect(() => {
    document.body.classList.add('ws-mode')
    return () => document.body.classList.remove('ws-mode')
  }, [])
  return (
    <div className="ws wsx">
      <div className={'wsx-field' + (scroll ? ' scroll' : '')}>{children}</div>
      <div className="wsx-top">
        <div className="ws-pill ws-left">
          <a className="btn icon ws-btn" href={backHref} title={tr('На карту', 'To the map', '返回地图')} aria-label={tr('На карту', 'To the map', '返回地图')}>
            ←
          </a>
          <button className="ws-title" onClick={() => setPanelOpen(true)}>
            {title}
          </button>
          <button className="icon ws-btn" onClick={() => setPanelOpen(true)} title={tr('Задача и цели', 'Task and goals', '任务与目标')} aria-label={tr('Задача и цели', 'Task and goals', '任务与目标')}>
            ▤
          </button>
        </div>
        {right && <div className="ws-pill ws-right">{right}</div>}
      </div>
      {metrics && (
        <button className="ws-metrics" onClick={() => setPanelOpen(true)} title={tr('Метрики и цели', 'Metrics and goals', '指标与目标')}>
          {metrics}
        </button>
      )}
      {bottom && (
        <div className="ws-tools" role="toolbar">
          {bottom}
        </div>
      )}
      {panelOpen && (
        <Sheet title={title} onClose={() => setPanelOpen(false)}>
          {panel}
          <button className="primary ws-start" onClick={() => setPanelOpen(false)}>
            {scroll ? tr('К заданию', 'To the task', '前往任务') : tr('К схеме', 'To the diagram', '前往图表')} →
          </button>
        </Sheet>
      )}
    </div>
  )
}

/** Кнопка нижней панели: значок и короткая подпись */
export function Tool({ icon, label, on, onClick, badge }: { icon: string; label: string; on?: boolean; onClick: () => void; badge?: ReactNode }) {
  return (
    <button className={'ws-tool' + (on ? ' on' : '')} onClick={onClick} aria-pressed={on}>
      <span className="ws-tool-icon">
        {icon}
        {badge !== undefined && <span className="ws-badge">{badge}</span>}
      </span>
      <span className="ws-tool-label">{label}</span>
    </button>
  )
}

/**
 * Затемнение под модальным окном: закрывает его нажатием по самому затемнению.
 * Щелчок — «хвост» касания, которое это окно открыло (Android шлёт click элементу, что под пальцем к отпусканию), — не считается.
 */
export function Scrim({ onClose }: { onClose: () => void }) {
  const down = useRef(false)
  return (
    <div
      className="sheet-scrim"
      aria-hidden
      onPointerDown={() => (down.current = true)}
      onClick={() => {
        if (down.current) onClose()
        down.current = false
      }}
    />
  )
}

/** Модальная шторка снизу: затемнение (нажатие закрывает), закреплённый заголовок, Esc */
export function Sheet({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  // закрытие — через ref: родители передают новую функцию на каждой отрисовке, а фокус должен ставиться один раз
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    ref.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (prev?.isConnected) prev.focus({ preventScroll: true })
    }
  }, [])
  return (
    <>
      <Scrim onClose={onClose} />
      <div className="ws-sheet open" ref={ref} tabIndex={-1} role="dialog" aria-modal aria-label={typeof title === 'string' ? title : undefined}>
        <div className="ws-panel-head">
          <b>{title}</b>
          <button className="icon" onClick={onClose} title={tr('Закрыть (Esc)', 'Close (Esc)', '关闭（Esc）')} aria-label={tr('Закрыть', 'Close', '关闭')}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </>
  )
}
