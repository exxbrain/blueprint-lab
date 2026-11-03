import { useEffect, useState } from 'react'
import { ES_TASKS, type EsConfig, type EsTask } from '../sim/es/model'
import { Rich } from '../components/Rich'
import { hintStars, markScenario, recordStars, useProgress } from '../progress'
import { TaskGate, TaskMarks } from '../components/Level'
import { tr } from '../i18n'

export default function EsPage() {
  const progress = useProgress()
  const [id, setId] = useState(ES_TASKS[0].id)
  const task = ES_TASKS.find((t) => t.id === id)!
  return (
    <div className="page">
      <div className="crumbs">
        <a href="#/">{tr('Главная', 'Home')}</a> / <a href="#/data">{tr('Распределённые данные', 'Distributed data')}</a> / Event Sourcing
      </div>
      <h1>📚 Event Sourcing</h1>
      <div className="row tabs">
        {ES_TASKS.map((t, i) => (
          <button key={t.id} className={t.id === id ? 'primary' : ''} onClick={() => setId(t.id)}>
            {progress.scenarios[`data/es/${t.id}`] ? '✓ ' : ''}
            {i + 1}. {t.title} <TaskMarks taskKey={`data/es/${t.id}`} />
          </button>
        ))}
      </div>
      <TaskGate taskKey={`data/es/${task.id}`}>
        <EsLab key={task.id} task={task} />
      </TaskGate>
    </div>
  )
}

const MARK_LABEL: Record<string, string> = {
  deleted: tr('удалено', 'deleted'),
  edited: tr('изменено', 'edited'),
  new: '',
  upcast: 'upcast',
  error: tr('ошибка', 'error'),
  snapshot: tr('снапшот', 'snapshot'),
}

function EsLab({ task }: { task: EsTask }) {
  const [cfg, setCfg] = useState<EsConfig>(task.start)
  const [hints, setHints] = useState(0)
  const [mine, setMine] = useState<EsConfig | null>(null)
  const run = task.run(cfg)
  const goals = task.goals.map((g) => ({ text: g.text, ok: g.check(run, cfg) }))
  const solved = goals.every((g) => g.ok)

  useEffect(() => {
    if (solved && !mine) {
      markScenario(`data/es/${task.id}`)
      recordStars(`data/es/${task.id}`, hintStars(hints))
    }
  }, [solved, mine, task.id, hints])

  return (
    <>
      <div className="scenario-head">
        <div className="panel lesson">
          <Rich paras={task.brief} />
          {hints > 0 && (
            <ol className="small">
              {task.hints.slice(0, hints).map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ol>
          )}
          <div className="row">
            {hints < task.hints.length && !solved && (
              <button onClick={() => setHints(hints + 1)}>
                💡 {tr('Подсказка', 'Hint')} ({hints}/{task.hints.length})
              </button>
            )}
            {mine ? (
              <button
                className="primary"
                onClick={() => {
                  setCfg(mine)
                  setMine(null)
                }}
              >
                {tr('↩ Вернуть мой выбор', '↩ Restore my choice')}
              </button>
            ) : (
              <button
                onClick={() => {
                  setMine(cfg)
                  setCfg(task.solution)
                }}
              >
                {tr('👁 Показать эталон', '👁 Show reference')}
              </button>
            )}
          </div>
        </div>
        <div className={'panel goal' + (solved ? ' success' : '')}>
          <h4>{solved ? (mine ? tr('👁 Эталон', '👁 Reference solution') : tr('✅ Решено!', '✅ Solved!')) : tr('🎯 Цели', '🎯 Goals')}
            {solved && !mine && <span className="goal-stars">{[1, 2, 3].map((i) => <span key={i} className={i <= hintStars(hints) ? 'on' : ''}>★</span>)}</span>}
          </h4>
          <ul className="goal-list">
            {goals.map((g) => (
              <li key={g.text} className={g.ok ? 'ok-text' : ''}>
                {g.ok ? '✓' : '○'} {g.text}
              </li>
            ))}
          </ul>
        </div>
      </div>
      {solved && !mine && (
        <div className="panel success lesson" style={{ marginBottom: 12 }}>
          <h3>{tr('Разбор', 'Debrief')}</h3>
          <Rich paras={task.debrief} />
        </div>
      )}

      <div className="es-grid">
        <aside className="panel">
          <h4>{tr('Решение', 'Decision')}</h4>
          {task.options.map((o) => (
            <div key={o.key} className="es-option">
              <div className="small muted">{o.label}</div>
              <div className="mode-options">
                {o.choices.map((ch) => (
                  <button
                    key={ch.value}
                    className={cfg[o.key] === ch.value ? 'primary' : ''}
                    onClick={() => setCfg({ ...cfg, [o.key]: ch.value })}
                  >
                    {ch.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </aside>

        <div className="panel">
          <h4>{tr('Журнал событий', 'Event log')}</h4>
          <ol className="es-log">
            {run.events.map((e) => (
              <li key={`${e.seq}-${e.type}`} className={'es-event ' + (e.mark ?? '')}>
                <span className="es-seq">#{e.seq}</span>
                <span className="es-type">
                  {e.type}
                  {e.version ? <span className="es-ver"> v{e.version}</span> : null}
                </span>
                <span className="es-data">{e.data}</span>
                {e.mark && MARK_LABEL[e.mark] && <span className={'badge es-badge ' + e.mark}>{MARK_LABEL[e.mark]}</span>}
                {e.note && <span className="small muted es-note">{e.note}</span>}
              </li>
            ))}
          </ol>
          {run.log.length > 0 && (
            <ul className="review-items">
              {run.log.map((l) => (
                <li key={l.text} className={l.tone}>
                  <span className="review-icon">{l.tone === 'ok' ? '✓' : l.tone === 'bad' ? '✗' : l.tone === 'warn' ? '⚠' : 'ℹ'}</span> {l.text}
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside className="panel">
          <h4>{tr('Состояние', 'State')}</h4>
          <table className="cmp small es-facts">
            <tbody>
              {run.facts.map((f) => (
                <tr key={f.label} className={f.tone === 'bad' ? 'bad-text' : f.tone === 'ok' ? 'ok-text' : f.tone === 'warn' ? 'warn-text' : ''}>
                  <td>{f.label}</td>
                  <td>
                    <b>{f.value}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </aside>
      </div>
    </>
  )
}
