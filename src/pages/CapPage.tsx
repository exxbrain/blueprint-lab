import { useEffect, useMemo, useState } from 'react'
import { CAP_TASKS, dcOf, latencyFor, runCap, type CapConfig, type CapTask, type Dc, type StepResult } from '../sim/cap/model'
import { Rich } from '../components/Rich'
import { markScenario, useProgress } from '../progress'

export default function CapPage() {
  const progress = useProgress()
  const [id, setId] = useState(CAP_TASKS[0].id)
  const task = CAP_TASKS.find((t) => t.id === id)!
  return (
    <div className="page">
      <div className="crumbs">
        <a href="#/">Главная</a> / <a href="#/data">Распределённые данные</a> / CAP и кворумы
      </div>
      <h1>⚖️ CAP и кворумы</h1>
      <div className="row tabs">
        {CAP_TASKS.map((t, i) => (
          <button key={t.id} className={t.id === id ? 'primary' : ''} onClick={() => setId(t.id)}>
            {progress.scenarios[`data/cap/${t.id}`] ? '✓ ' : ''}
            {i + 1}. {t.title}
          </button>
        ))}
      </div>
      <CapLab key={task.id} task={task} />
    </div>
  )
}

const STEP_LABEL: Record<StepResult['step']['t'], string> = {
  write: '✍️',
  read: '👁',
  partition: '✂️',
  heal: '🔗',
  down: '💥',
  up: '🔄',
}

function CapLab({ task }: { task: CapTask }) {
  const [cfg, setCfg] = useState<CapConfig>(task.start)
  const [pos, setPos] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [hints, setHints] = useState(0)
  const [mine, setMine] = useState<CapConfig | null>(null)
  const run = useMemo(() => runCap(cfg, task.steps), [cfg, task.steps])
  const goals = task.goals.map((g) => ({ text: g.text, ok: g.check(run, cfg) }))
  const solved = goals.every((g) => g.ok)

  useEffect(() => {
    if (solved && !mine) markScenario(`data/cap/${task.id}`)
  }, [solved, mine, task.id])

  useEffect(() => {
    if (!playing) return
    if (pos >= run.log.length) {
      setPlaying(false)
      return
    }
    const t = setTimeout(() => setPos(pos + 1), 900)
    return () => clearTimeout(t)
  }, [playing, pos, run.log.length])

  const set = (patch: Partial<CapConfig>) => {
    const next = { ...cfg, ...patch }
    next.w = Math.min(next.w, next.n)
    next.r = Math.min(next.r, next.n)
    setCfg(next)
    setPos(0)
    setPlaying(false)
  }
  const fixed = (k: keyof CapConfig) => task.fixed?.[k] !== undefined
  const current = pos > 0 ? run.log[pos - 1] : null
  const nodes = current?.nodes ?? Array.from({ length: cfg.n }, (_, i) => ({ id: i + 1, dc: dcOf(cfg.n, i + 1), up: true, items: [], ts: 0 }))
  const partitioned = current?.partitioned ?? false
  const m = run.metrics

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
                💡 Подсказка ({hints}/{task.hints.length})
              </button>
            )}
            {mine ? (
              <button
                className="primary"
                onClick={() => {
                  setCfg(mine)
                  setMine(null)
                  setPos(0)
                }}
              >
                ↩ Вернуть мои настройки
              </button>
            ) : (
              <button
                onClick={() => {
                  setMine(cfg)
                  setCfg(task.solution)
                  setPos(0)
                }}
              >
                👁 Показать эталон
              </button>
            )}
          </div>
        </div>
        <div className={'panel goal' + (solved ? ' success' : '')}>
          <h4>{solved ? (mine ? '👁 Эталон' : '✅ Решено!') : '🎯 Цели'}</h4>
          <ul className="goal-list">
            {goals.map((g) => (
              <li key={g.text} className={g.ok ? 'ok-text' : ''}>
                {g.ok ? '✓' : '○'} {g.text}
              </li>
            ))}
          </ul>
          <p className="small muted">Цели проверяются по всему сценарию — прогоните его до конца, чтобы увидеть, где что пошло не так.</p>
        </div>
      </div>
      {solved && !mine && (
        <div className="panel success lesson" style={{ marginBottom: 12 }}>
          <h3>Разбор</h3>
          <Rich paras={task.debrief} />
        </div>
      )}

      <div className="cap-grid">
        <aside className="panel">
          <h4>Настройки хранилища</h4>
          <label>
            реплик N
            <select value={cfg.n} disabled={fixed('n')} onChange={(e) => set({ n: Number(e.target.value) as 3 | 5 })}>
              <option value={3}>3 (A: 2, B: 1)</option>
              <option value={5}>5 (A: 3, B: 2)</option>
            </select>
          </label>
          <label>
            подтверждений записи W = {cfg.w}
            <input type="range" min={1} max={cfg.n} value={cfg.w} disabled={fixed('w')} onChange={(e) => set({ w: Number(e.target.value) })} />
          </label>
          <label>
            реплик на чтение R = {cfg.r}
            <input type="range" min={1} max={cfg.n} value={cfg.r} disabled={fixed('r')} onChange={(e) => set({ r: Number(e.target.value) })} />
          </label>
          <div className={'small ' + (cfg.r + cfg.w > cfg.n ? 'ok-text' : 'warn-text')}>
            R + W = {cfg.r + cfg.w} {cfg.r + cfg.w > cfg.n ? '>' : '≤'} N = {cfg.n}
            {cfg.r + cfg.w > cfg.n ? ' — кворумы пересекаются' : ' — чтение может не увидеть запись'}
          </div>
          <label>
            если реплик меньше W или R
            <select value={cfg.shortfall} disabled={fixed('shortfall')} onChange={(e) => set({ shortfall: e.target.value as CapConfig['shortfall'] })}>
              <option value="reject">отказать (строгий кворум)</option>
              <option value="sloppy">работать с теми, что есть (sloppy quorum)</option>
            </select>
          </label>
          <label>
            расхождения после восстановления
            <select value={cfg.resolve} disabled={fixed('resolve')} onChange={(e) => set({ resolve: e.target.value as CapConfig['resolve'] })}>
              <option value="lww">последняя запись побеждает (LWW)</option>
              <option value="merge">слить данные обеих сторон</option>
            </select>
          </label>
          <table className="cmp small">
            <tbody>
              <tr>
                <td>чтение</td>
                <td>{latencyFor(cfg.r)} мс</td>
              </tr>
              <tr>
                <td>запись</td>
                <td>{latencyFor(cfg.w)} мс</td>
              </tr>
            </tbody>
          </table>
        </aside>

        <div className="panel">
          <div className="row cap-controls">
            <button onClick={() => setPos(Math.max(0, pos - 1))} disabled={pos === 0}>
              ◀
            </button>
            <button className="primary" onClick={() => (pos >= run.log.length ? (setPos(0), setPlaying(true)) : setPlaying(!playing))}>
              {playing ? '⏸ Пауза' : pos >= run.log.length ? '↺ Сначала' : '▶ Проиграть'}
            </button>
            <button onClick={() => setPos(Math.min(run.log.length, pos + 1))} disabled={pos >= run.log.length}>
              ▶ Шаг
            </button>
            <button onClick={() => setPos(run.log.length)}>⏩ До конца</button>
            <span className="small muted">
              шаг {pos} из {run.log.length}
            </span>
          </div>
          <div className={'cap-dcs' + (partitioned ? ' partitioned' : '')}>
            {(['A', 'B'] as Dc[]).map((dc) => (
              <div key={dc} className="cap-dc">
                <h4>Дата-центр {dc}</h4>
                {nodes
                  .filter((x) => x.dc === dc)
                  .map((x) => (
                    <div key={x.id} className={'cap-node' + (x.up ? '' : ' down')}>
                      <div className="card-head">
                        <b>Узел {x.id}</b>
                        <span className={'badge ' + (x.up ? 'ok' : 'bad')}>{x.up ? 'в строю' : 'упал'}</span>
                      </div>
                      <div className="cap-items">
                        {x.items.length ? x.items.map((it) => <span key={it} className="cap-item">{it}</span>) : <span className="muted small">пусто</span>}
                      </div>
                    </div>
                  ))}
              </div>
            ))}
            <div className="cap-link">{partitioned ? '✂️ разрыв' : '🔗'}</div>
          </div>
          {current && <div className={'cap-current ' + current.outcome}>{current.text}</div>}
        </div>

        <aside className="panel">
          <h4>Сценарий</h4>
          <ol className="cap-steps">
            {run.log.map((s, i) => (
              <li
                key={i}
                className={(i < pos ? s.outcome : 'future') + (i === pos - 1 ? ' current' : '')}
                onClick={() => setPos(i + 1)}
                title={s.text}
              >
                {STEP_LABEL[s.step.t]}{' '}
                {s.step.t === 'write'
                  ? `${s.step.client}: записать «${s.step.item}»`
                  : s.step.t === 'read'
                    ? `${s.step.client}: прочитать`
                    : s.step.t === 'partition'
                      ? 'разрыв связи A ↔ B'
                      : s.step.t === 'heal'
                        ? 'связь восстановлена'
                        : s.step.t === 'down'
                          ? `узел ${s.step.node} падает`
                          : `узел ${s.step.node} возвращается`}
                {'note' in s.step && s.step.note && <span className="muted"> — {s.step.note}</span>}
                {i < pos && s.outcome === 'rejected' && <b className="warn-text"> · отказ</b>}
                {i < pos && s.outcome === 'stale' && <b className="bad-text"> · устарело</b>}
              </li>
            ))}
          </ol>
          <table className="cmp small">
            <tbody>
              <tr>
                <td>отказов записи A / B</td>
                <td>
                  {m.rejectedWrites.A} / {m.rejectedWrites.B}
                </td>
              </tr>
              <tr>
                <td>отказов чтения A / B</td>
                <td>
                  {m.rejectedReads.A} / {m.rejectedReads.B}
                </td>
              </tr>
              <tr className={m.staleReads ? 'bad-text' : ''}>
                <td>устаревших чтений</td>
                <td>{m.staleReads}</td>
              </tr>
              <tr className={m.lostWrites.length ? 'bad-text' : ''}>
                <td>потеряно подтверждённых</td>
                <td>{m.lostWrites.length ? m.lostWrites.join(', ') : 0}</td>
              </tr>
            </tbody>
          </table>
        </aside>
      </div>
    </>
  )
}
