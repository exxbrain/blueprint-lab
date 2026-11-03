import { useEffect } from 'react'
import { findRef, type RefEntry } from '../content/reference'
import { tr } from '../i18n'

/** Полное описание паттерна или компонента */
export function RefBody({ e }: { e: RefEntry }) {
  return (
    <div className="ref-body">
      <p className="ref-summary">{e.summary}</p>
      <dl>
        <dt>{tr('Проблема', 'Problem', '问题')}</dt>
        <dd>{e.problem}</dd>
        <dt>{tr('Как работает', 'How it works', '工作原理')}</dt>
        <dd>{e.solution}</dd>
        <dt>{tr('Когда применять', 'When to use', '适用场景')}</dt>
        <dd>{e.when}</dd>
        {e.avoid !== '—' && (
          <>
            <dt>{tr('Когда не стоит', 'When not to', '不适用场景')}</dt>
            <dd>{e.avoid}</dd>
          </>
        )}
        {e.tools !== '—' && (
          <>
            <dt>{tr('Чем реализуют', 'Tools', '实现工具')}</dt>
            <dd className="ref-tools">{e.tools}</dd>
          </>
        )}
      </dl>
    </div>
  )
}

/** Всплывающая карточка справочника поверх страницы */
export function RefModal({ id, onClose }: { id: string; onClose: () => void }) {
  const e = findRef(id)
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  if (!e) return null
  return (
    <div className="ref-overlay" onClick={onClose}>
      <div className="ref-modal panel" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-label={e.title}>
        <div className="card-head">
          <h3>
            {e.icon} {e.title} <span className="badge ok">{e.category}</span>
          </h3>
          <button className="icon" onClick={onClose} title={tr('Закрыть (Esc)', 'Close (Esc)', '关闭（Esc）')}>
            ✕
          </button>
        </div>
        <RefBody e={e} />
        <a
          className="small"
          href={`#/reference/${e.id}`}
          onClick={(ev) => {
            // сначала переход, потом закрытие: иначе ссылка исчезает из документа раньше перехода
            ev.preventDefault()
            window.location.hash = `#/reference/${e.id}`
            onClose()
          }}
        >
          {tr('Весь справочник →', 'Full reference →', '完整参考手册 →')}
        </a>
      </div>
    </div>
  )
}
