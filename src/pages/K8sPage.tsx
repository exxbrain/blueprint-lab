import { useEffect, useMemo, useState } from 'react'
import { tr } from '../i18n'
import { Rich } from '../components/Rich'
import { TaskGate, TaskMarks } from '../components/Level'
import { hintStars, markScenario, recordStars, useProgress } from '../progress'
import { href } from '../router'
import { K8S_TASKS, runTask, type K8sConfig, type K8sTask } from '../sim/k8s/tasks'
import type { Frame, KEvent, Phase, PodView } from '../sim/k8s/engine'

export const k8sKey = (id: string) => `kubernetes/lab/${id}`

export default function K8sPage({ id }: { id?: string }) {
  const progress = useProgress()
  const task = K8S_TASKS.find((t) => t.id === id) ?? K8S_TASKS.find((t) => !progress.scenarios[k8sKey(t.id)]) ?? K8S_TASKS[0]
  return (
    <div className="page">
      <div className="crumbs">
        <a href="#/">{tr('Главная', 'Home')}</a> / <a href={href('kubernetes')}>Kubernetes</a> / {tr('Лаборатория', 'Lab')}
      </div>
      <h1>☸️ {tr('Kubernetes: инциденты', 'Kubernetes: incidents')}</h1>
      <div className="row tabs">
        {K8S_TASKS.map((t, i) => (
          <a key={t.id} className={'btn' + (t.id === task.id ? ' primary' : '')} href={href('kubernetes', 'lab', t.id)}>
            {progress.scenarios[k8sKey(t.id)] ? '✓ ' : ''}
            {i + 1}. {t.title} <TaskMarks taskKey={k8sKey(t.id)} />
          </a>
        ))}
      </div>
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
  const [cfg, setCfg] = useState<K8sConfig>(task.start)
  const [mine, setMine] = useState<K8sConfig | null>(null)
  const [hints, setHints] = useState(0)
  const [pos, setPos] = useState(0)
  const [playing, setPlaying] = useState(true)
  const run = useMemo(() => runTask(task, cfg), [task, cfg])
  const goals = task.goals.map((g) => ({ text: g.text, ok: g.check(run.totals, cfg) }))
  const solved = goals.every((g) => g.ok)
  const stars = hintStars(hints)

  useEffect(() => {
    if (solved && !mine) {
      markScenario(k8sKey(task.id))
      recordStars(k8sKey(task.id), stars)
    }
  }, [solved, mine, task.id, stars])

  // проигрывание: 8 секунд кластера в секунду
  useEffect(() => {
    if (!playing) return
    if (pos >= run.frames.length - 1) {
      setPlaying(false)
      return
    }
    const h = setTimeout(() => setPos(pos + 1), 125)
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
                  setPos(0)
                  setPlaying(true)
                }}
              >
                {tr('↩ Вернуть мой манифест', '↩ Restore my manifest')}
              </button>
            ) : (
              <button
                onClick={() => {
                  setMine(cfg)
                  setCfg(task.solution)
                  setPos(0)
                  setPlaying(true)
                }}
              >
                {tr('👁 Показать эталон', '👁 Show reference')}
              </button>
            )}
          </div>
        </div>
        <div className={'panel goal' + (solved ? ' success' : '')}>
          <h4>{solved ? (mine ? tr('👁 Эталон', '👁 Reference') : tr('✅ Инцидент закрыт!', '✅ Incident closed!')) : tr('🎯 Цели', '🎯 Goals')}
            {solved && !mine && <span className="goal-stars">{[1, 2, 3].map((i) => <span key={i} className={i <= stars ? 'on' : ''}>★</span>)}</span>}
          </h4>
          <ul className="goal-list">
            {goals.map((g) => (
              <li key={g.text} className={g.ok ? 'ok-text' : ''}>
                {g.ok ? '✓' : '○'} {g.text}
              </li>
            ))}
          </ul>
          <div className="k8s-totals small">
            <span className={t.errorRate < 0.01 ? 'ok-text' : 'bad-text'}>
              {tr('ошибок', 'errors')} {(t.errorRate * 100).toFixed(2)}%
            </span>
            <span>p95 {Math.round(t.p95)} {tr('мс', 'ms')}</span>
            <span>{tr('подов в среднем', 'avg pods')} {t.avgPods.toFixed(1)}</span>
            <span>{tr('рестартов', 'restarts')} {t.restarts}</span>
          </div>
        </div>
      </div>

      {solved && !mine && (
        <div className="panel success lesson" style={{ marginBottom: 12 }}>
          <h3>{tr('Разбор', 'Debrief')}</h3>
          <Rich paras={task.debrief} />
        </div>
      )}

      <div className="k8s-grid">
        <div className="panel k8s-manifest">
          <h4>{tr('Манифест', 'Manifest')}</h4>
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
          <p className="small muted">{tr('Меняйте значения — сценарий сразу прогоняется заново.', 'Change values and the scenario reruns immediately.')}</p>
        </div>

        <div className="panel k8s-cluster">
          <div className="row k8s-player">
            <button onClick={() => (pos >= run.frames.length - 1 ? (setPos(0), setPlaying(true)) : setPlaying(!playing))}>
              {playing ? '⏸' : pos >= run.frames.length - 1 ? '↺' : '▶'}
            </button>
            <input type="range" min={0} max={run.frames.length - 1} value={pos} onChange={(e) => (setPos(+e.target.value), setPlaying(false))} aria-label={tr('Время', 'Time')} />
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
          {tr('ошибок', 'errors')} {(errShare * 100).toFixed(1)}%
        </span>
        <span>
          {tr('задержка', 'latency')} {Math.round(f.latency)} {tr('мс', 'ms')}
        </span>
        <span>
          {tr('реплик', 'replicas')} {f.pods.filter((p) => p.healthy).length}/{f.desired}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="k8s-chart" preserveAspectRatio="none">
        <path d={line((fr) => fr.rps)} className="chart-rps" />
        <path d={line((fr) => fr.failed)} className="chart-err" />
        <line x1={x(pos)} x2={x(pos)} y1={0} y2={H} className="chart-now" />
      </svg>
      <div className="small muted">
        <span className="legend rps">— {tr('запросы', 'requests')}</span> <span className="legend err">— {tr('ошибки', 'errors')}</span>
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
                {tr('зона', 'zone')} {n.zone}
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
            <span className="small muted">{tr('нет места ни на одной ноде', 'no room on any node')}</span>
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
    : p.phase === 'Ready' && p.hung ? tr('завис', 'hung')
    : p.phase === 'Ready' ? 'Running 1/1'
    : p.phase === 'Running' ? 'Running 0/1'
    : p.phase
  return (
    <div className={`k8s-pod ${PHASE_CLASS[p.phase]}` + (p.hung ? ' hung' : '') + (p.inService ? ' in-service' : '')} title={`${p.name}\n${label}${p.restarts ? `\nrestarts: ${p.restarts}` : ''}`}>
      <span className="pod-ver">{p.version}</span>
      <span className="pod-name">{p.name.slice(4)}</span>
      <span className="pod-phase">{label}</span>
      {p.restarts > 0 && <span className="pod-restarts">↻{p.restarts}</span>}
      {p.inService && <span className="pod-svc" title={tr('получает трафик', 'receives traffic')}>●</span>}
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
