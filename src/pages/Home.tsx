import { modules } from '../content/modules'
import type { Module } from '../content/types'
import { useProgress, type Progress } from '../progress'
import { href } from '../router'

export function moduleProgress(m: Module, p: Progress): { done: number; total: number } {
  const total = m.lessons.length + m.scenarios.length + (m.quiz.length ? 1 : 0)
  const done =
    m.lessons.filter((l) => p.lessons[`${m.id}/${l.id}`]).length +
    m.scenarios.filter((s) => p.scenarios[`${m.id}/${s.id}`]).length +
    ((p.quizzes[m.id] ?? 0) >= 0.8 ? 1 : 0)
  return { done, total }
}

export function Home() {
  const progress = useProgress()
  return (
    <div className="page">
      <section className="hero">
        <h1>Архитектура, которую можно потрогать</h1>
        <p>
          Короткие уроки, живые симуляции и задачи-инциденты. Роняйте брокеры, разгоняйте нагрузку, распиливайте
          монолит и смотрите, что из этого выйдет, не рискуя продом.
        </p>
      </section>
      <div className="tiles">
        {modules.map((m) => {
          const { done, total } = moduleProgress(m, progress)
          const content = (
            <>
              <div className="icon">{m.icon}</div>
              <h3>{m.title}</h3>
              <p>{m.summary}</p>
              {m.status === 'soon' ? (
                <span className="badge warn">скоро</span>
              ) : total > 0 ? (
                <>
                  <div className="progressbar">
                    <div style={{ width: `${(done / total) * 100}%` }} />
                  </div>
                  <div className="small muted" style={{ marginTop: 6 }}>
                    пройдено {done} из {total}
                  </div>
                </>
              ) : (
                <div className="small muted">{m.extras.map((e) => e.title).join(' · ')}</div>
              )}
            </>
          )
          return m.status === 'soon' ? (
            <div key={m.id} className="tile soon">
              {content}
            </div>
          ) : (
            <a key={m.id} className="tile" href={href(m.id)}>
              {content}
            </a>
          )
        })}
      </div>
    </div>
  )
}
