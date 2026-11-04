import { useEffect, useMemo, useState } from 'react'
import { loadDraft, signature, useSaveDraft } from '../drafts'
import { tr } from '../i18n'
import { Rich } from '../components/Rich'
import { ResultButton, ResultModal, useResultModal } from '../components/ResultModal'
import { TaskGate, TaskLevelTag } from '../components/Level'
import { hintStars, markScenario, recordStars, useProgress, useHints, referenceNote } from '../progress'
import { href } from '../router'
import { K8S_TASKS, runTask, type K8sConfig, type K8sTask } from '../sim/k8s/tasks'
import type { Frame, KEvent, Phase, PodView } from '../sim/k8s/engine'

export const k8sKey = (id: string) => `kubernetes/lab/${id}`

export default function K8sPage({ id }: { id?: string }) {
  const progress = useProgress()
  // без номера в адресе — первая нерешённая, но выбранная один раз: иначе после решения страница перескакивала бы дальше
  const [entry] = useState(() => K8S_TASKS.find((t) => !progress.scenarios[k8sKey(t.id)]) ?? K8S_TASKS[0])
  const task = K8S_TASKS.find((t) => t.id === id) ?? entry
  return (
    <div className="page">
      <div className="crumbs">
        <a href="#/">{tr('Карта', 'Map', '地图')}</a> / <a href={href('kubernetes')}>Kubernetes</a>
      </div>
      <h1>
        ☸️ {task.title} <TaskLevelTag taskKey={k8sKey(task.id)} full />
      </h1>
      <TaskGate taskKey={k8sKey(task.id)}>
        <Lab key={task.id} task={task} />
      </TaskGate>
    </div>
  )
}

const PHASE_CLASS: Record<Phase, string> = {
  Pending: 'pending',
  ContainerCreating: 'creating',
  Running: 'running',
  Ready: 'ready',
  CrashLoopBackOff: 'crash',
  Terminating: 'terminating',
  Unknown: 'unknown',
}

function Lab({ task }: { task: K8sTask }) {
  // черновик: выбранные настройки переживают перезагрузку страницы
  const draftKey = k8sKey(task.id)
  const draftSig = signature(Object.keys(task.start).sort())
  const [cfg, setCfg] = useState<K8sConfig>(() => loadDraft<K8sConfig>(draftKey, draftSig, (w) => typeof w === 'object') ?? task.start)
  const [mine, setMine] = useState<K8sConfig | null>(null)
  // пока смотрим эталон, в черновике — свои настройки
  useSaveDraft(draftKey, draftSig, mine ?? cfg)
  const hintState = useHints(k8sKey(task.id))
  const hints = hintState.used
  const [pos, setPos] = useState(0)
  const [playing, setPlaying] = useState(true)
  const run = useMemo(() => runTask(task, cfg), [task, cfg])
  const goals = task.goals.map((g) => ({ text: g.text, ok: g.check(run.totals, cfg) }))
  const solved = goals.every((g) => g.ok)
  const result$ = useResultModal(solved, !mine)
  const stars = hintStars(hints)

  useEffect(() => {
    if (solved && !mine) {
      markScenario(k8sKey(task.id))
      recordStars(k8sKey(task.id), stars)
    }
  }, [solved, mine, task.id, stars])

  useEffect(() => {
    if (!playing) return
    if (pos >= run.frames.length - 1) {
      setPlaying(false)
      return
    }
    // короткий сценарий — 8 секунд кластера в секунду, длинный (отказ ноды) — быстрее, чтобы уложиться в ~20 с
    const h = setTimeout(() => setPos(pos + 1), Math.max(40, Math.min(125, 20000 / run.frames.length)))
    return () => clearTimeout(h)
  }, [playing, pos, run.frames.length])

  const set = (key: string, value: string) => {
    setCfg({ ...cfg, [key]: value })
    setPos(0)
    setPlaying(true)
  }
  const frame = run.frames[Math.min(pos, run.frames.length - 1)]
  const t = run.totals

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
                  setPlaying(true)
                }}
              >
                {tr('↩ Вернуть мой манифест', '↩ Restore my manifest', '↩ 恢复我的清单')}
              </button>
            ) : (
              <button
                title={referenceNote()}
                onClick={() => {
                  setMine(cfg)
                  hintState.reveal()
                  setCfg(task.solution)
                  setPos(0)
                  setPlaying(true)
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
          <h4>{solved ? (mine ? tr('👁 Эталон', '👁 Reference', '👁 参考答案') : tr('✅ Инцидент закрыт!', '✅ Incident closed!', '✅ 事故已解决！')) : tr('🎯 Цели', '🎯 Goals', '🎯 目标')}
            {solved && !mine && <span className="goal-stars">{[1, 2, 3].map((i) => <span key={i} className={i <= stars ? 'on' : ''}>★</span>)}</span>}
          </h4>
          <ul className="goal-list">
            {goals.map((g) => (
              <li key={g.text} className={g.ok ? 'ok-text' : ''}>
                {g.ok ? '✓' : '○'} {g.text}
              </li>
            ))}
          </ul>
          <ResultButton solved={solved && !mine} onClick={() => result$.setOpen(true)} />
          <div className="k8s-totals small">
            <span className={t.errorRate < 0.01 ? 'ok-text' : 'bad-text'}>
              {tr('ошибок', 'errors', '错误率')} {(t.errorRate * 100).toFixed(2)}%
            </span>
            <span>p95 {Math.round(t.p95)} {tr('мс', 'ms', 'ms')}</span>
            <span>{tr('подов в среднем', 'avg pods', '平均 Pod 数')} {t.avgPods.toFixed(1)}</span>
            <span>{tr('рестартов', 'restarts', '重启次数')} {t.restarts}</span>
          </div>
        </div>
      </div>

      <ResultModal open={result$.open} onClose={() => result$.setOpen(false)} progressKey={k8sKey(task.id)} stars={stars}
        title={tr('Инцидент закрыт!', 'Incident closed!', '事故已解决！')}>
        <div className="lesson">
          <h3>{tr('Разбор', 'Debrief', '解析')}</h3>
          <Rich paras={task.debrief} />
        </div>
      </ResultModal>

      <div className="k8s-grid">
        <div className="panel k8s-manifest">
          <h4>{tr('Манифест', 'Manifest', '清单（Manifest）')}</h4>
          <pre className="yaml">
            <span className="muted"># deployment/api</span>
            {'\n'}
            {task.options.map((o) => (
              <span key={o.key} className="yaml-line">
                <span className="yaml-key">{o.yaml}:</span>{' '}
                <select value={cfg[o.key]} onChange={(e) => set(o.key, e.target.value)} disabled={!!mine} aria-label={o.label}>
                  {o.choices.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
                {'\n'}
              </span>
            ))}
          </pre>
          <p className="small muted">{tr('Меняйте значения — сценарий сразу прогоняется заново.', 'Change values and the scenario reruns immediately.', '修改取值后，场景会立即重新运行。')}</p>
        </div>

        <div className="panel k8s-cluster">
          <div className="row k8s-player">
            <button onClick={() => (pos >= run.frames.length - 1 ? (setPos(0), setPlaying(true)) : setPlaying(!playing))}>
              {playing ? '⏸' : pos >= run.frames.length - 1 ? '↺' : '▶'}
            </button>
            <input type="range" min={0} max={run.frames.length - 1} value={pos} onChange={(e) => (setPos(+e.target.value), setPlaying(false))} aria-label={tr('Время', 'Time', '时间')} />
            <span className="mono small">
              t={frame.t}s / {run.frames.length - 1}s
            </span>
          </div>
          <Traffic frames={run.frames} pos={pos} />
          <Cluster frame={frame} />
        </div>
      </div>

      <Events events={run.events} now={frame.t} />
    </>
  )
}

function Traffic({ frames, pos }: { frames: Frame[]; pos: number }) {
  const f = frames[Math.min(pos, frames.length - 1)]
  const W = 600
  const H = 60
  const maxRps = Math.max(1, ...frames.map((x) => x.rps))
  const x = (i: number) => (i / Math.max(1, frames.length - 1)) * W
  const line = (get: (x: Frame) => number) => frames.map((fr, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${(H - (get(fr) / maxRps) * (H - 4)).toFixed(1)}`).join(' ')
  const errShare = f.rps ? f.failed / f.rps : 0
  return (
    <div className="k8s-traffic">
      <div className="k8s-stats">
        <span>
          {Math.round(f.rps)} rps
        </span>
        <span className={errShare > 0.01 ? 'bad-text' : 'ok-text'}>
          {tr('ошибок', 'errors', '错误率')} {(errShare * 100).toFixed(1)}%
        </span>
        <span>
          {tr('задержка', 'latency', '延迟')} {Math.round(f.latency)} {tr('мс', 'ms', 'ms')}
        </span>
        <span>
          {tr('реплик', 'replicas', '副本')} {f.pods.filter((p) => p.healthy).length}/{f.desired}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="k8s-chart" preserveAspectRatio="none">
        <path d={line((fr) => fr.rps)} className="chart-rps" />
        <path d={line((fr) => fr.failed)} className="chart-err" />
        <line x1={x(pos)} x2={x(pos)} y1={0} y2={H} className="chart-now" />
      </svg>
      <div className="small muted">
        <span className="legend rps">— {tr('запросы', 'requests', '请求')}</span> <span className="legend err">— {tr('ошибки', 'errors', '错误')}</span>
      </div>
    </div>
  )
}

function Cluster({ frame }: { frame: Frame }) {
  const pending = frame.pods.filter((p) => !p.node)
  return (
    <div className="k8s-nodes">
      {frame.nodes.map((n) => {
        const pods = frame.pods.filter((p) => p.node === n.id)
        return (
          <div key={n.id} className={'k8s-node' + (n.up ? '' : ' down') + (n.cordoned ? ' cordoned' : '')}>
            <div className="k8s-node-head">
              <b>{n.id}</b>
              <span className="small muted">
                {tr('зона', 'zone', '可用区')} {n.zone}
              </span>
              {!n.up && <span className="bad-text small">NotReady</span>}
              {n.cordoned && n.up && <span className="warn-text small">SchedulingDisabled</span>}
            </div>
            <div className="k8s-bar" title={`CPU requests ${n.cpuReq}m / ${n.cpu}m`}>
              <div style={{ width: `${Math.min(100, (n.cpuReq / n.cpu) * 100)}%` }} />
            </div>
            <div className="small muted">
              CPU {n.cpuReq}/{n.cpu}m
            </div>
            <div className="k8s-pods">
              {pods.map((p) => (
                <PodChip key={p.name} p={p} />
              ))}
            </div>
          </div>
        )
      })}
      {pending.length > 0 && (
        <div className="k8s-node pending-lane">
          <div className="k8s-node-head">
            <b>Pending</b>
            <span className="small muted">{tr('нет места ни на одной ноде', 'no room on any node', '所有 Node 都没有空间')}</span>
          </div>
          <div className="k8s-pods">
            {pending.map((p) => (
              <PodChip key={p.name} p={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function PodChip({ p }: { p: PodView }) {
  const label =
    p.phase === 'CrashLoopBackOff' ? (p.reason === 'OOMKilled' ? 'OOMKilled' : 'CrashLoopBackOff')
    : p.phase === 'Ready' && p.hung ? tr('завис', 'hung', '卡死')
    : p.phase === 'Ready' ? 'Running 1/1'
    : p.phase === 'Running' ? 'Running 0/1'
    : p.phase
  return (
    <div className={`k8s-pod ${PHASE_CLASS[p.phase]}` + (p.hung ? ' hung' : '') + (p.inService ? ' in-service' : '')} title={`${p.name}\n${label}${p.restarts ? `\nrestarts: ${p.restarts}` : ''}`}>
      <span className="pod-ver">{p.version}</span>
      <span className="pod-name">{p.name.slice(4)}</span>
      <span className="pod-phase">{label}</span>
      {p.restarts > 0 && <span className="pod-restarts">↻{p.restarts}</span>}
      {p.inService && <span className="pod-svc" title={tr('получает трафик', 'receives traffic', '正在接收流量')}>●</span>}
    </div>
  )
}

function Events({ events, now }: { events: KEvent[]; now: number }) {
  const shown = events.filter((e) => e.t <= now).slice(-14).reverse()
  return (
    <div className="panel k8s-events">
      <h4>
        $ kubectl get events --sort-by=.lastTimestamp <span className="small muted">({events.filter((e) => e.t <= now).length})</span>
      </h4>
      <div className="k8s-events-table mono small">
        <div className="ev-row ev-head">
          <span>LAST SEEN</span>
          <span>TYPE</span>
          <span>REASON</span>
          <span>OBJECT</span>
          <span>MESSAGE</span>
        </div>
        {shown.map((e, i) => (
          <div key={`${e.t}-${i}-${e.reason}`} className={'ev-row ' + (e.type === 'Warning' ? 'warn' : '')}>
            <span>{now - e.t}s</span>
            <span>{e.type}</span>
            <span>{e.reason}</span>
            <span>{e.object}</span>
            <span>{e.message}</span>
          </div>
        ))}
        {!shown.length && <div className="muted">No events found in default namespace.</div>}
      </div>
    </div>
  )
}
