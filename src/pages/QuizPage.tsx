import { tr } from '../i18n'
import { useState } from 'react'
import type { Module } from '../content/types'
import { recordQuiz } from '../progress'
import { href } from '../router'

export function QuizPage({ mod }: { mod: Module }) {
  const [i, setI] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [score, setScore] = useState(0)
  const [finished, setFinished] = useState(false)
  const qs = mod.quiz
  const q = qs[i]

  const restart = () => {
    setI(0)
    setPicked(null)
    setScore(0)
    setFinished(false)
  }

  if (finished) {
    const ratio = score / qs.length
    return (
      <div className="page narrow">
        <div className="crumbs">
          <a href="#/">{tr('Карта', 'Map')}</a> / <a href={href(mod.id)}>{mod.title}</a> / {tr('Квиз', 'Quiz')}
        </div>
        <div className={'panel' + (ratio >= 0.8 ? ' success' : '')} style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: '3rem' }}>{ratio >= 0.8 ? '🏆' : ratio >= 0.5 ? '👍' : '📚'}</div>
          <h2>
            {tr(`${score} из ${qs.length}`, `${score} of ${qs.length}`)}
          </h2>
          <p className="muted">
            {ratio >= 0.8
              ? tr('Отлично! Квиз засчитан.', 'Great! Quiz passed.')
              : tr('Для зачёта нужно 80%. Перечитайте уроки и попробуйте ещё раз.', 'You need 80% to pass. Review the lessons and try again.')}
          </p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button onClick={restart}>{tr('Пройти заново', 'Try again')}</button>
            <a href={href(mod.id)}>
              <button className="primary">{tr('К модулю', 'Back to module')}</button>
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page narrow">
      <div className="crumbs">
        <a href="#/">{tr('Карта', 'Map')}</a> / <a href={href(mod.id)}>{mod.title}</a> / {tr('Квиз', 'Quiz')}
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted">
          {tr(`Вопрос ${i + 1} из ${qs.length}`, `Question ${i + 1} of ${qs.length}`)}
        </span>
        <span className="muted">{tr('верно', 'correct')}: {score}</span>
      </div>
      <div className="progressbar" style={{ margin: '8px 0 20px' }}>
        <div style={{ width: `${(i / qs.length) * 100}%` }} />
      </div>
      <div className="quiz-q panel" key={i}>
        <h3>{q.q}</h3>
        <div className="options">
          {q.options.map((o, k) => {
            let cls = 'option'
            if (picked !== null) {
              if (k === q.correct) cls += ' correct'
              else if (k === picked) cls += ' wrong'
            }
            return (
              <button
                key={k}
                className={cls}
                disabled={picked !== null && k !== picked && k !== q.correct}
                onClick={() => {
                  if (picked !== null) return
                  setPicked(k)
                  if (k === q.correct) setScore(score + 1)
                }}
              >
                {o}
              </button>
            )
          })}
        </div>
        {picked !== null && (
          <>
            <div className="explain">
              <b className={picked === q.correct ? 'ok-text' : 'bad-text'}>
                {picked === q.correct ? tr('Верно. ', 'Correct. ') : tr('Неверно. ', 'Incorrect. ')}
              </b>
              {q.explain}
            </div>
            <div style={{ marginTop: 14, textAlign: 'right' }}>
              <button
                className="primary"
                onClick={() => {
                  if (i + 1 < qs.length) {
                    setI(i + 1)
                    setPicked(null)
                  } else {
                    recordQuiz(mod.id, score / qs.length)
                    setFinished(true)
                  }
                }}
              >
                {i + 1 < qs.length ? tr('Дальше →', 'Next →') : tr('Результат', 'Result')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
