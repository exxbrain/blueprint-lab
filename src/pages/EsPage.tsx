import { useEffect, useState } from 'react'
import { loadDraft, signature, useSaveDraft } from '../drafts'
import { ES_TASKS, type EsConfig, type EsTask } from '../sim/es/model'
import { Rich } from '../components/Rich'
import { ResultButton, ResultModal, useResultModal } from '../components/ResultModal'
import { hintStars, markScenario, recordStars, useProgress, useHints, referenceNote } from '../progress'
import { TaskGate, TaskLevelTag } from '../components/Level'
import { tr } from '../i18n'

export default function EsPage({ id }: { id?: string }) {
  const progress = useProgress()
  // без адреса — первая нерешённая задача, выбранная один раз
  const [entry] = useState(() => ES_TASKS.find((t) => !progress.scenarios[`data/es/${t.id}`]) ?? ES_TASKS[0])
  const task = ES_TASKS.find((t) => t.id === id) ?? entry
  return (
    <div className="page">
      <div className="crumbs">
        <a href="#/">{tr('Карта', 'Map', '地图')}</a> / Event Sourcing
      </div>
      <h1>
        📚 {task.title} <TaskLevelTag taskKey={`data/es/${task.id}`} full />
      </h1>
      <TaskGate taskKey={`data/es/${task.id}`}>
        <EsLab key={task.id} task={task} />
      </TaskGate>
    </div>
  )
}

const MARK_LABEL: Record<string, string> = {
  deleted: tr('удалено', 'deleted', '已删除'),
  edited: tr('изменено', 'edited', '已修改'),
  new: '',
  upcast: 'upcast',
  error: tr('ошибка', 'error', '错误'),
  snapshot: tr('снапшот', 'snapshot', '快照'),
}

function EsLab({ task }: { task: EsTask }) {
  // черновик: выбранные настройки переживают перезагрузку страницы
  const draftKey = `data/es/${task.id}`
  const draftSig = signature(Object.keys(task.start).sort())
  const [cfg, setCfg] = useState<EsConfig>(() => loadDraft<EsConfig>(draftKey, draftSig, (w) => typeof w === 'object') ?? task.start)
  const hintState = useHints(`data/es/${task.id}`)
  const hints = hintState.used
  const [mine, setMine] = useState<EsConfig | null>(null)
  // пока смотрим эталон, в черновике — свои настройки
  useSaveDraft(draftKey, draftSig, mine ?? cfg)
  const run = task.run(cfg)
  const goals = task.goals.map((g) => ({ text: g.text, ok: g.check(run, cfg) }))
  const solved = goals.every((g) => g.ok)
  const result$ = useResultModal(solved, !mine)

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
            {hints < task.hints.length && (
              <button onClick={hintState.take}>
                💡 {tr('Подсказка', 'Hint', '提示')} ({Math.min(hints, task.hints.length)}/{task.hints.length})
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
                {tr('↩ Вернуть мой выбор', '↩ Restore my choice', '↩ 恢复我的选择')}
              </button>
            ) : (
              <button
                title={referenceNote()}
                onClick={() => {
                  setMine(cfg)
                  hintState.reveal()
                  setCfg(task.solution)
                }}
              >
                {tr('👁 Показать эталон', '👁 Show reference', '👁 查看参考答案')}
              </button>
            )}
            {/* выбор сохраняется между перезагрузками — начать с чистого листа можно здесь */}
            {!mine && <button onClick={() => setCfg(task.start)}>{tr('↺ Заново', '↺ Start over', '↺ 重新开始')}</button>}
          </div>
        </div>
        <div className={'panel goal' + (solved ? ' success' : '')}>
          <h4>{solved ? (mine ? tr('👁 Эталон', '👁 Reference solution', '👁 参考答案') : tr('✅ Решено!', '✅ Solved!', '✅ 已解决！')) : tr('🎯 Цели', '🎯 Goals', '🎯 目标')}
            {solved && !mine && <span className="goal-stars">{[1, 2, 3].map((i) => <span key={i} className={i <= hintStars(hints) ? 'on' : ''}>★</span>)}</span>}
          </h4>
          <ul className="goal-list">
            {goals.map((g) => (
              <li key={g.text} className={g.ok ? 'ok-text' : ''}>
                {g.ok ? '✓' : '○'} {g.text}
              </li>
            ))}
          </ul>
          <ResultButton solved={solved && !mine} onClick={() => result$.setOpen(true)} />
        </div>
      </div>
      <ResultModal open={result$.open} onClose={() => result$.setOpen(false)} progressKey={`data/es/${task.id}`} stars={hintStars(hints)}>
        <div className="lesson">
          <h3>{tr('Разбор', 'Debrief', '解析')}</h3>
          <Rich paras={task.debrief} />
        </div>
      </ResultModal>

      <div className="es-grid">
        <aside className="panel">
          <h4>{tr('Решение', 'Decision', '决策')}</h4>
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
          <h4>{tr('Журнал событий', 'Event log', '事件日志')}</h4>
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
          <h4>{tr('Состояние', 'State', '状态')}</h4>
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
