import { useEffect, useMemo, useState } from 'react'
import { loadDraft, signature, useSaveDraft } from '../drafts'
import { CAP_TASKS, dcOf, latencyFor, runCap, type CapConfig, type CapTask, type Dc, type StepResult } from '../sim/cap/model'
import { Rich } from '../components/Rich'
import { ResultButton, ResultModal, useResultModal } from '../components/ResultModal'
import { hintStars, markScenario, recordStars, useProgress, useHints, referenceNote } from '../progress'
import { TaskGate, TaskLevelTag } from '../components/Level'
import { tr } from '../i18n'

export default function CapPage({ id }: { id?: string }) {
  const progress = useProgress()
  // без адреса — первая нерешённая задача, выбранная один раз
  const [entry] = useState(() => CAP_TASKS.find((t) => !progress.scenarios[`data/cap/${t.id}`]) ?? CAP_TASKS[0])
  const task = CAP_TASKS.find((t) => t.id === id) ?? entry
  return (
    <div className="page">
      <div className="crumbs">
        <a href="#/">{tr('Карта', 'Map', '地图')}</a> / {tr('CAP и кворумы', 'CAP and quorums', 'CAP 与法定人数')}
      </div>
      <h1>
        ⚖️ {task.title} <TaskLevelTag taskKey={`data/cap/${task.id}`} full />
      </h1>
      <TaskGate taskKey={`data/cap/${task.id}`}>
        <CapLab key={task.id} task={task} />
      </TaskGate>
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
  // черновик: выбранные настройки переживают перезагрузку страницы
  const draftKey = `data/cap/${task.id}`
  const draftSig = signature(Object.keys(task.start).sort())
  const [cfg, setCfg] = useState<CapConfig>(() => loadDraft<CapConfig>(draftKey, draftSig, (w) => typeof w === 'object' && Object.keys(task.start).every((k) => k in w)) ?? task.start)
  const [pos, setPos] = useState(0)
  const [playing, setPlaying] = useState(false)
  const hintState = useHints(`data/cap/${task.id}`)
  const hints = hintState.used
  const [mine, setMine] = useState<CapConfig | null>(null)
  // пока смотрим эталон, в черновике — свои настройки
  useSaveDraft(draftKey, draftSig, mine ?? cfg)
  const run = useMemo(() => runCap(cfg, task.steps), [cfg, task.steps])
  const goals = task.goals.map((g) => ({ text: g.text, ok: g.check(run, cfg) }))
  const solved = goals.every((g) => g.ok)
  const result$ = useResultModal(solved, !mine)

  useEffect(() => {
    if (solved && !mine) {
      markScenario(`data/cap/${task.id}`)
      recordStars(`data/cap/${task.id}`, hintStars(hints))
    }
  }, [solved, mine, task.id, hints])

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
                  setPos(0)
                }}
              >
                {tr('↩ Вернуть мои настройки', '↩ Restore my settings', '↩ 恢复我的设置')}
              </button>
            ) : (
              <button
                title={referenceNote()}
                onClick={() => {
                  setMine(cfg)
                  hintState.reveal()
                  setCfg(task.solution)
                  setPos(0)
                }}
              >
                {tr('👁 Показать эталон', '👁 Show reference', '👁 查看参考答案')}
              </button>
            )}
            {/* выбор сохраняется между перезагрузками — начать с чистого листа можно здесь */}
            {!mine && (
              <button
                onClick={() => {
                  setCfg(task.start)
                  setPos(0)
                  setPlaying(false)
                }}
              >
                {tr('↺ Заново', '↺ Start over', '↺ 重新开始')}
              </button>
            )}
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
          <p className="small muted">
            {tr(
              'Цели проверяются по всему сценарию — прогоните его до конца, чтобы увидеть, где что пошло не так.',
              'Goals are checked against the whole scenario — play it to the end to see where things went wrong.',
              '目标是根据整个场景来检查的——把它播放到最后，就能看到哪里出了问题。',
            )}
          </p>
        </div>
      </div>
      <ResultModal open={result$.open} onClose={() => result$.setOpen(false)} progressKey={`data/cap/${task.id}`} stars={hintStars(hints)}>
        <div className="lesson">
          <h3>{tr('Разбор', 'Debrief', '解析')}</h3>
          <Rich paras={task.debrief} />
        </div>
      </ResultModal>

      <div className="cap-grid">
        <aside className="panel">
          <h4>{tr('Настройки хранилища', 'Storage settings', '存储设置')}</h4>
          <label>
            {tr('реплик N', 'replicas N', '副本数 N')}
            <select value={cfg.n} disabled={fixed('n')} onChange={(e) => set({ n: Number(e.target.value) as 3 | 5 })}>
              <option value={3}>3 (A: 2, B: 1)</option>
              <option value={5}>5 (A: 3, B: 2)</option>
            </select>
          </label>
          <label>
            {tr('подтверждений записи W', 'write acknowledgements W', '写入确认数 W')} = {cfg.w}
            <input type="range" min={1} max={cfg.n} value={cfg.w} disabled={fixed('w')} onChange={(e) => set({ w: Number(e.target.value) })} />
          </label>
          <label>
            {tr('реплик на чтение R', 'replicas per read R', '每次读取的副本数 R')} = {cfg.r}
            <input type="range" min={1} max={cfg.n} value={cfg.r} disabled={fixed('r')} onChange={(e) => set({ r: Number(e.target.value) })} />
          </label>
          <div className={'small ' + (cfg.r + cfg.w > cfg.n ? 'ok-text' : 'warn-text')}>
            R + W = {cfg.r + cfg.w} {cfg.r + cfg.w > cfg.n ? '>' : '≤'} N = {cfg.n}
            {cfg.r + cfg.w > cfg.n ? tr(' — кворумы пересекаются', ' — quorums overlap', '——读写法定人数有交集') : tr(' — чтение может не увидеть запись', ' — a read may miss a write', '——读取可能看不到写入')}
          </div>
          <label>
            {tr('если реплик меньше W или R', 'if fewer than W or R replicas', '可用副本少于 W 或 R 时')}
            <select value={cfg.shortfall} disabled={fixed('shortfall')} onChange={(e) => set({ shortfall: e.target.value as CapConfig['shortfall'] })}>
              <option value="reject">{tr('отказать (строгий кворум)', 'reject (strict quorum)', '拒绝（严格法定人数）')}</option>
              <option value="sloppy">{tr('работать с теми, что есть (sloppy quorum)', 'use whatever is available (sloppy quorum)', '用现有的副本凑合（sloppy quorum）')}</option>
            </select>
          </label>
          <label>
            {tr('расхождения после восстановления', 'conflicts after recovery', '恢复后的数据冲突')}
            <select value={cfg.resolve} disabled={fixed('resolve')} onChange={(e) => set({ resolve: e.target.value as CapConfig['resolve'] })}>
              <option value="lww">{tr('последняя запись побеждает (LWW)', 'last write wins (LWW)', '最后写入者胜（LWW）')}</option>
              <option value="merge">{tr('слить данные обеих сторон', 'merge data from both sides', '合并双方的数据')}</option>
            </select>
          </label>
          <table className="cmp small">
            <tbody>
              <tr>
                <td>{tr('чтение', 'read', '读取')}</td>
                <td>{latencyFor(cfg.r)} {tr('мс', 'ms', 'ms')}</td>
              </tr>
              <tr>
                <td>{tr('запись', 'write', '写入')}</td>
                <td>{latencyFor(cfg.w)} {tr('мс', 'ms', 'ms')}</td>
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
              {playing ? tr('⏸ Пауза', '⏸ Pause', '⏸ 暂停') : pos >= run.log.length ? tr('↺ Сначала', '↺ Restart', '↺ 重新开始') : tr('▶ Проиграть', '▶ Play', '▶ 播放')}
            </button>
            <button onClick={() => setPos(Math.min(run.log.length, pos + 1))} disabled={pos >= run.log.length}>
              {tr('▶ Шаг', '▶ Step', '▶ 单步')}
            </button>
            <button onClick={() => setPos(run.log.length)}>{tr('⏩ До конца', '⏩ To the end', '⏩ 直接到最后')}</button>
            <span className="small muted">
              {tr(`шаг ${pos} из ${run.log.length}`, `step ${pos} of ${run.log.length}`, `第 ${pos} 步，共 ${run.log.length} 步`)}
            </span>
          </div>
          <div className={'cap-dcs' + (partitioned ? ' partitioned' : '')}>
            {(['A', 'B'] as Dc[]).map((dc) => (
              <div key={dc} className="cap-dc">
                <h4>{tr(`Дата-центр ${dc}`, `Data center ${dc}`, `数据中心 ${dc}`)}</h4>
                {nodes
                  .filter((x) => x.dc === dc)
                  .map((x) => (
                    <div key={x.id} className={'cap-node' + (x.up ? '' : ' down')}>
                      <div className="card-head">
                        <b>{tr(`Узел ${x.id}`, `Node ${x.id}`, `节点 ${x.id}`)}</b>
                        <span className={'badge ' + (x.up ? 'ok' : 'bad')}>{x.up ? tr('в строю', 'up', '运行中') : tr('упал', 'down', '已宕机')}</span>
                      </div>
                      <div className="cap-items">
                        {x.items.length ? x.items.map((it) => <span key={it} className="cap-item">{it}</span>) : <span className="muted small">{tr('пусто', 'empty', '空')}</span>}
                      </div>
                    </div>
                  ))}
              </div>
            ))}
            <div className="cap-link">{partitioned ? tr('✂️ разрыв', '✂️ partition', '✂️ 网络分区') : '🔗'}</div>
          </div>
          {current && <div className={'cap-current ' + current.outcome}>{current.text}</div>}
        </div>

        <aside className="panel">
          <h4>{tr('Сценарий', 'Scenario', '场景')}</h4>
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
                  ? tr(`${s.step.client}: записать «${s.step.item}»`, `${s.step.client}: write “${s.step.item}”`, `${s.step.client}：写入“${s.step.item}”`)
                  : s.step.t === 'read'
                    ? tr(`${s.step.client}: прочитать`, `${s.step.client}: read`, `${s.step.client}：读取`)
                    : s.step.t === 'partition'
                      ? tr('разрыв связи A ↔ B', 'network partition A ↔ B', 'A ↔ B 之间网络分区')
                      : s.step.t === 'heal'
                        ? tr('связь восстановлена', 'connection restored', '连接已恢复')
                        : s.step.t === 'down'
                          ? tr(`узел ${s.step.node} падает`, `node ${s.step.node} goes down`, `节点 ${s.step.node} 宕机`)
                          : tr(`узел ${s.step.node} возвращается`, `node ${s.step.node} comes back`, `节点 ${s.step.node} 恢复`)}
                {'note' in s.step && s.step.note && <span className="muted"> — {s.step.note}</span>}
                {i < pos && s.outcome === 'rejected' && <b className="warn-text"> · {tr('отказ', 'rejected', '被拒绝')}</b>}
                {i < pos && s.outcome === 'stale' && <b className="bad-text"> · {tr('устарело', 'stale', '过期')}</b>}
              </li>
            ))}
          </ol>
          <table className="cmp small">
            <tbody>
              <tr>
                <td>{tr('отказов записи A / B', 'rejected writes A / B', '被拒绝的写入 A / B')}</td>
                <td>
                  {m.rejectedWrites.A} / {m.rejectedWrites.B}
                </td>
              </tr>
              <tr>
                <td>{tr('отказов чтения A / B', 'rejected reads A / B', '被拒绝的读取 A / B')}</td>
                <td>
                  {m.rejectedReads.A} / {m.rejectedReads.B}
                </td>
              </tr>
              <tr className={m.staleReads ? 'bad-text' : ''}>
                <td>{tr('устаревших чтений', 'stale reads', '过期读取')}</td>
                <td>{m.staleReads}</td>
              </tr>
              <tr className={m.lostWrites.length ? 'bad-text' : ''}>
                <td>{tr('потеряно подтверждённых', 'acknowledged writes lost', '丢失的已确认写入')}</td>
                <td>{m.lostWrites.length ? m.lostWrites.join(', ') : 0}</td>
              </tr>
            </tbody>
          </table>
        </aside>
      </div>
    </>
  )
}
