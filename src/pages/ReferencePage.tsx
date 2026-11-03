import { useEffect, useState } from 'react'
import { COMPONENT_REF, PATTERN_REF, type RefEntry } from '../content/reference'
import { RefBody } from '../components/RefCard'
import { tr } from '../i18n'

export default function ReferencePage({ focus }: { focus?: string }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(focus ?? null)

  useEffect(() => {
    if (!focus) return
    setOpen(focus)
    setTimeout(() => document.getElementById(`ref-${focus}`)?.scrollIntoView({ block: 'center' }), 50)
  }, [focus])

  const match = (e: RefEntry) => {
    const s = q.trim().toLowerCase()
    if (!s) return true
    return [e.title, e.summary, e.problem, e.solution, e.tools, e.category].some((x) => x.toLowerCase().includes(s))
  }

  const section = (title: string, list: RefEntry[]) => {
    const shown = list.filter(match)
    if (!shown.length) return null
    const groups = [...new Set(shown.map((e) => e.category))]
    return (
      <>
        <h2 className="section-title">{title}</h2>
        {groups.map((g) => (
          <div key={g}>
            <div className="pattern-group-title">{g}</div>
            <div className="ref-grid">
              {shown
                .filter((e) => e.category === g)
                .map((e) => (
                  <div key={e.id} id={`ref-${e.id}`} className={'panel ref-item' + (open === e.id ? ' open' : '')}>
                    <button className="ref-head" onClick={() => setOpen(open === e.id ? null : e.id)}>
                      <span className="ref-icon">{e.icon}</span>
                      <span>
                        <b>{e.title}</b>
                        <span className="small muted ref-sum"> — {e.summary}</span>
                      </span>
                      <span className="muted">{open === e.id ? '▾' : '▸'}</span>
                    </button>
                    {open === e.id && <RefBody e={e} />}
                  </div>
                ))}
            </div>
          </div>
        ))}
      </>
    )
  }

  return (
    <div className="page narrow ref-page">
      <div className="crumbs">
        <a href="#/">{tr('Карта', 'Map', '地图')}</a> / {tr('Справочник', 'Reference', '参考手册')}
      </div>
      <h1>📖 {tr('Справочник', 'Reference', '参考手册')}</h1>
      <p className="muted">
        {tr(
          'Паттерны микросервисов и компоненты конструктора: какую проблему решают, как работают, когда применять и чем реализуют.',
          'Microservice patterns and builder components: what problem they solve, how they work, when to use them and which tools implement them.',
          '微服务模式与构建器组件：它们解决什么问题、如何工作、何时使用，以及有哪些工具可以实现。',
        )}
      </p>
      <input
        type="text"
        className="ref-search"
        placeholder={tr('Поиск: retry, кэш, Kafka…', 'Search: retry, cache, Kafka…', '搜索：retry、缓存、Kafka…')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {section(tr('Паттерны микросервисов', 'Microservice patterns', '微服务模式'), PATTERN_REF)}
      {section(tr('Компоненты конструктора', 'Builder components', '构建器组件'), COMPONENT_REF)}
    </div>
  )
}
