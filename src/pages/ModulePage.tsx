import { tr } from '../i18n'
import type { Module } from '../content/types'
import { useProgress } from '../progress'
import { href } from '../router'
import { moduleProgress } from './Home'

export function ModulePage({ mod }: { mod: Module }) {
  const progress = useProgress()
  const { done, total } = moduleProgress(mod, progress)
  const quizScore = progress.quizzes[mod.id]
  return (
    <div className="page narrow">
      <div className="crumbs">
        <a href="#/">{tr('Главная', 'Home')}</a> / {mod.title}
      </div>
      <h1>
        {mod.icon} {mod.title}
      </h1>
      <p className="muted">{mod.summary}</p>
      {total > 0 && (
        <div className="progressbar" style={{ maxWidth: 400 }}>
          <div style={{ width: `${(done / total) * 100}%` }} />
        </div>
      )}

      {mod.lessons.length > 0 && (
        <>
          <h2 className="section-title">📖 {tr('Уроки', 'Lessons')}</h2>
          <div className="list">
            {mod.lessons.map((l, i) => (
              <a key={l.id} className="list-item" href={href(mod.id, 'lesson', l.id)}>
                <span className="num">{String(i + 1).padStart(2, '0')}</span>
                <span className="title">
                  {l.title}
                  <span className="desc">{l.summary}</span>
                </span>
                <span className="small muted">{l.minutes} {tr('мин', 'min')}</span>
                {progress.lessons[`${mod.id}/${l.id}`] && <span className="done-mark">✓</span>}
              </a>
            ))}
          </div>
        </>
      )}

      {mod.scenarios.length > 0 && (
        <>
          <h2 className="section-title">🚨 {tr('Задачи-инциденты', 'Incident challenges')}</h2>
          <div className="list">
            {mod.scenarios.map((s) => (
              <a key={s.id} className="list-item" href={href(mod.id, 'scenario', s.id)}>
                <span className="num">{'★'.repeat(s.difficulty)}</span>
                <span className="title">
                  {s.title}
                  <span className="desc">{s.summary}</span>
                </span>
                {progress.scenarios[`${mod.id}/${s.id}`] && <span className="done-mark">✓ {tr('решено', 'solved')}</span>}
              </a>
            ))}
          </div>
        </>
      )}

      {mod.quiz.length > 0 && (
        <>
          <h2 className="section-title">❓ {tr('Проверка знаний', 'Knowledge check')}</h2>
          <div className="list">
            <a className="list-item" href={href(mod.id, 'quiz')}>
              <span className="num">?</span>
              <span className="title">
                {tr(`Квиз: ${mod.quiz.length} вопросов`, `Quiz: ${mod.quiz.length} questions`)}
                <span className="desc">{tr('Засчитывается от 80% правильных ответов', 'Passed at 80% correct answers')}</span>
              </span>
              {quizScore !== undefined && (
                <span className={quizScore >= 0.8 ? 'done-mark' : 'warn-text'}>
                  {tr('лучший', 'best')}: {Math.round(quizScore * 100)}%
                </span>
              )}
            </a>
          </div>
        </>
      )}

      {mod.extras.length > 0 && (
        <>
          <h2 className="section-title">🛠 {tr('Симуляторы', 'Simulators')}</h2>
          <div className="list">
            {mod.extras.map((e) => (
              <a key={e.href} className="list-item" href={e.href}>
                <span className="num">{e.icon}</span>
                <span className="title">
                  {e.title}
                  <span className="desc">{e.desc}</span>
                </span>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
