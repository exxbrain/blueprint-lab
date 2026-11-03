import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BuilderCanvas, NODE_H, NODE_W, PALETTE_MIME, fmt, freeSpot } from '../sim/builder/BuilderCanvas'
import {
  KINDS,
  WORKLOADS,
  isStorage,
  pathBetween,
  reaches,
  simulate,
  wouldCycle,
  type BEdge,
  type BNode,
  type NodeKind,
  type Workload,
} from '../sim/builder/model'
import {
  builderChallenges,
  CHALLENGE_GROUP_LABEL,
  estimateOk,
  sandboxStart,
  SERVICE_PROFILES,
  type BuilderChallenge,
} from '../sim/builder/challenges'
import { Rich } from '../components/Rich'
import { ReviewPanel } from '../components/ReviewPanel'
import { reviewBuilder } from '../sim/builder/review'
import { RefModal } from '../components/RefCard'
import { markScenario, recordStars, useProgress } from '../progress'
import { tr } from '../i18n'
import { href } from '../router'
import { TaskGate, TaskLevelTag, TaskMarks } from '../components/Level'
import { NodeLog, TrafficPanel, useLiveTraffic } from '../sim/builder/TrafficPanel'

const KIND_GROUP_LABEL: Record<'Трафик' | 'Вычисления' | 'Хранилища', string> = {
  Трафик: tr('Трафик', 'Traffic'),
  Вычисления: tr('Вычисления', 'Compute'),
  Хранилища: tr('Хранилища', 'Storage'),
}

let uid = 100
const nextId = (p: string) => `${p}${++uid}`

export default function BuilderPage({ id }: { id?: string }) {
  const progress = useProgress()
  const mode = id && builderChallenges.some((c) => c.id === id) ? id : 'sandbox'
  const challenge = builderChallenges.find((c) => c.id === mode)
  return (
    <div className="page">
      <div className="crumbs">
        <a href="#/">{tr('Главная', 'Home')}</a> / <a href={href('builder')}>{tr('Конструктор', 'Builder')}</a>
        {challenge && <> / {challenge.title}</>}
      </div>
      <h1>
        🏗️ {challenge ? challenge.title : tr('Конструктор архитектуры', 'Architecture Builder')}{' '}
        {challenge && <TaskLevelTag taskKey={`builder/${challenge.id}`} full />}
      </h1>
      <div className="row tabs">
        <a className={'btn' + (mode === 'sandbox' ? ' primary' : '')} href={href('builder')}>
          {tr('Свободный режим', 'Sandbox')}
        </a>
      </div>
      {(['Классика', 'Инструменты', 'System Design'] as const).map((group) => (
        <div key={group} className="row tabs">
          <span className="muted small tab-group">{CHALLENGE_GROUP_LABEL[group]}:</span>
          {builderChallenges
            .filter((c) => c.group === group)
            .map((c) => (
              <a key={c.id} className={'btn' + (mode === c.id ? ' primary' : '')} href={href('builder', c.id)}>
                {progress.scenarios[`builder/${c.id}`] ? '✓ ' : ''}
                {c.title} <TaskMarks taskKey={`builder/${c.id}`} />
              </a>
            ))}
        </div>
      ))}
      {challenge ? (
        <TaskGate taskKey={`builder/${challenge.id}`}>
          <Builder key={mode} challenge={challenge} />
        </TaskGate>
      ) : (
        <Builder key={mode} />
      )}
    </div>
  )
}

function Builder({ challenge }: { challenge?: BuilderChallenge }) {
  const [refId, setRefId] = useState<string | null>(null)
  const start = challenge ?? sandboxStart
  const [nodes, setNodes] = useState<BNode[]>(start.nodes)
  const [edges, setEdges] = useState<BEdge[]>(start.edges)
  const [selected, setSelected] = useState<string | null>(null)
  const [hints, setHints] = useState(0)
  const [flash, setFlash] = useState<string | null>(null)
  const [estimated, setEstimated] = useState(!challenge?.estimate)
  const [showReview, setShowReview] = useState(false)
  /** Пока смотрим эталон, своё решение лежит здесь */
  const [mine, setMine] = useState<{ nodes: BNode[]; edges: BEdge[] } | null>(null)
  const viewingRef = mine !== null
  const result = useMemo(() => simulate(nodes, edges), [nodes, edges])
  const traffic = useLiveTraffic(nodes, edges, result, estimated)

  const goals = challenge
    ? [
        ...challenge.paths.map((p) => ({ text: p.text, ok: reaches(edges, p.from, p.to) })),
        ...challenge.goals.map((g) => ({ text: g.text, ok: g.check(result) })),
        { text: tr(`Стоимость ≤ $${challenge.budget}`, `Cost ≤ $${challenge.budget}`), ok: result.cost <= challenge.budget },
        ...(challenge.estimate ? [{ text: tr('Прикидка нагрузки сделана', 'Back-of-the-envelope estimate done'), ok: estimated }] : []),
      ]
    : []
  const solved = goals.length > 0 && goals.every((g) => g.ok)
  useEffect(() => {
    if (solved && challenge && !viewingRef) markScenario(`builder/${challenge.id}`)
  }, [solved, challenge, viewingRef])

  const review = challenge && (showReview || solved) ? reviewBuilder(challenge, nodes, edges, result, estimated) : null
  const stars = solved && !viewingRef ? review?.stars : undefined
  useEffect(() => {
    if (stars && challenge) recordStars(`builder/${challenge.id}`, stars)
  }, [stars, challenge])

  const toggleReference = () => {
    if (!challenge) return
    if (mine) {
      setNodes(mine.nodes)
      setEdges(mine.edges)
      setMine(null)
    } else {
      setMine({ nodes, edges })
      setNodes(challenge.solution.nodes)
      setEdges(challenge.solution.edges)
      setEstimated(true)
    }
    setSelected(null)
  }

  const selNode = nodes.find((n) => n.id === selected)
  const selEdge = edges.find((e) => e.id === selected)
  const locked = (id: string) => challenge?.locked.includes(id) ?? false

  const [cycleNote, setCycleNote] = useState<string | null>(null)
  const say = (msg: string) => {
    setFlash(msg)
    setTimeout(() => setFlash(null), 2500)
  }

  /**
   * Добавить компонент. С координатами — туда, куда его бросили.
   * Без координат — справа от выделенного блока с автоматической связью, иначе в свободное место у центра.
   */
  const add = (kind: NodeKind, at?: { x: number; y: number }) => {
    const sel = nodes.find((x) => x.id === selected)
    const want = at
      ? { x: at.x - NODE_W / 2, y: at.y - NODE_H / 2 }
      : sel
        ? { x: sel.x + NODE_W + 50, y: sel.y }
        : { x: 500 - NODE_W / 2, y: 270 - NODE_H / 2 }
    const pos = freeSpot(nodes, want.x, want.y)
    const n: BNode = {
      id: nextId('n'),
      kind,
      label: KINDS[kind].title,
      ...pos,
      instances: 1,
      ...(kind === 'client' ? { rps: 500, workload: 'oltp' as Workload } : {}),
      ...(kind === 'cache' ? { hitRatio: challenge?.hitRatio.cache ?? 0.8 } : {}),
      ...(kind === 'cdn' ? { hitRatio: challenge?.hitRatio.cdn ?? 0.9 } : {}),
      ...(kind === 'service' ? { capacity: 300, latency: 20 } : {}),
    }
    const nextNodes = [...nodes, n]
    setNodes(nextNodes)
    // клик по палитре при выделенном блоке — сразу провести связь от него
    if (!at && sel && !isStorage(sel.kind) && kind !== 'client') {
      setEdges([...edges, { id: nextId('e'), from: sel.id, to: n.id }])
    }
    setSelected(n.id)
  }

  const connect = (from: string, to: string) => {
    const a = nodes.find((n) => n.id === from)!
    const b = nodes.find((n) => n.id === to)!
    if (b.kind === 'client') return say(tr('Клиенты — только источник нагрузки', 'Clients are only a source of load'))
    if (edges.some((e) => e.from === from && e.to === to)) return say(tr('Такая связь уже есть', 'This connection already exists'))
    if (wouldCycle(nodes, edges, from, to)) {
      const label = (id: string) => nodes.find((x) => x.id === id)?.label ?? id
      const back = pathBetween(edges, to, from) ?? [to, from]
      return setCycleNote(
        tr(
          `Связь «${a.label} → ${b.label}» замкнула бы круг: ${[...back, to].map(label).join(' → ')}. ` +
            'Запрос бегал бы по нему бесконечно.',
          `The connection “${a.label} → ${b.label}” would close a loop: ${[...back, to].map(label).join(' → ')}. ` +
            'A request would circle it forever.',
        ),
      )
    }
    setCycleNote(null)
    if (isStorage(a.kind)) return say(tr('Хранилище никого не вызывает', 'Storage does not call anything'))
    setEdges([...edges, { id: nextId('e'), from, to }])
  }

  const remove = () => {
    if (selNode) {
      if (locked(selNode.id)) return say(tr('Этот компонент — часть исходной системы', 'This component is part of the original system'))
      setNodes(nodes.filter((n) => n.id !== selNode.id))
      setEdges(edges.filter((e) => e.from !== selNode.id && e.to !== selNode.id))
    } else if (selEdge) {
      setEdges(edges.filter((e) => e.id !== selEdge.id))
    }
    setSelected(null)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && !(e.target instanceof HTMLInputElement)) remove()
      if (e.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const wrapRef = useRef<HTMLDivElement>(null)
  /** Где на холсте выбранный элемент (в координатах схемы 1000×540) */
  const anchorOf = (n?: BNode, e?: BEdge) => {
    if (n) return { x: n.x, y: n.y, w: NODE_W, h: NODE_H }
    if (e) {
      const a = nodes.find((x) => x.id === e.from)
      const b = nodes.find((x) => x.id === e.to)
      if (a && b) {
        const x = (a.x + NODE_W + b.x) / 2
        const y = (a.y + b.y + NODE_H) / 2
        return { x: x - 10, y: y - 10, w: 20, h: 20 }
      }
    }
    return { x: 0, y: 0, w: 0, h: 0 }
  }
  const patch = (id: string, p: Partial<BNode>) => setNodes(nodes.map((n) => (n.id === id ? { ...n, ...p } : n)))

  return (
    <div className="builder">
      {challenge && (
        <div className="scenario-head">
          <div className="panel lesson">
            <Rich paras={challenge.brief} />
            {challenge.estimate && (
              <EstimatePanel estimate={challenge.estimate} done={estimated} onDone={() => setEstimated(true)} />
            )}
            {hints > 0 && (
              <ol className="small">
                {challenge.hints.slice(0, hints).map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ol>
            )}
            {hints < challenge.hints.length && !solved && (
              <button onClick={() => setHints(hints + 1)}>
                💡 {tr('Подсказка', 'Hint')} ({hints}/{challenge.hints.length})
              </button>
            )}
          </div>
          <div className={'panel goal' + (solved ? ' success' : '')}>
            <h4>{solved ? tr('✅ Решено!', '✅ Solved!') : tr('🎯 Цели', '🎯 Goals')}</h4>
            <ul className="goal-list">
              {goals.map((g) => (
                <li key={g.text} className={g.ok ? 'ok-text' : ''}>
                  {g.ok ? '✓' : '○'} {g.text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {viewingRef && (
        <div className="ref-banner">
          {tr(
            <>
              👁 Вы смотрите <b>эталонное решение</b> — в зачёт оно не идёт.
            </>,
            <>
              👁 You are viewing the <b>reference solution</b>; it does not count toward completion.
            </>,
          )}
          <button className="primary" onClick={toggleReference}>
            ↩ {tr('Вернуть моё решение', 'Back to my solution')}
          </button>
        </div>
      )}
      {solved && challenge && !viewingRef && (
        <div className="panel success lesson" style={{ marginBottom: 12 }}>
          <h3>{tr('Разбор задачи', 'Debrief')}</h3>
          <Rich paras={challenge.debrief} />
        </div>
      )}
      {challenge && (
        <div className="row review-actions">
          {!solved && (
            <button onClick={() => setShowReview(!showReview)}>
              📋 {showReview ? tr('Скрыть оценку', 'Hide assessment') : tr('Оценить решение', 'Assess solution')}
            </button>
          )}
          {!viewingRef && <button onClick={toggleReference}>👁 {tr('Показать эталон на схеме', 'Show reference on canvas')}</button>}
        </div>
      )}
      {review && <ReviewPanel review={review} title={viewingRef ? tr('Оценка эталона', 'Reference assessment') : tr('Оценка вашего решения', 'Your solution assessment')} />}

      {refId && <RefModal id={refId} onClose={() => setRefId(null)} />}
      <div className="builder-grid">
        <aside className="panel palette">
          <h4>{tr('Компоненты', 'Components')}</h4>
          {(['Трафик', 'Вычисления', 'Хранилища'] as const).map((group) => (
            <div key={group}>
              <div className="pattern-group-title">{KIND_GROUP_LABEL[group]}</div>
              {(Object.keys(KINDS) as NodeKind[])
                .filter((k) => KINDS[k].group === group && !(challenge && k === 'client'))
                .map((k) => (
                  <div key={k} className="palette-row">
                  <button
                    className="palette-item"
                    onClick={() => add(k)}
                    title={KINDS[k].desc}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(PALETTE_MIME, k)
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                  >
                    <span>{KINDS[k].icon}</span> {KINDS[k].title}
                    <span className="small muted">{KINDS[k].cost ? `$${KINDS[k].cost}` : ''}</span>
                  </button>
                  <button
                    className="icon info-btn"
                    title={tr('Что это и когда применять', 'What it is and when to use it')}
                    onClick={() => setRefId(k)}
                  >
                    ⓘ
                  </button>
                  </div>
                ))}
            </div>
          ))}
          <p className="small muted">
            {tr(
              'Перетащите компонент на холст или кликните: если выделен блок, новый встанет справа и сразу соединится с ним. Связь вручную — тяните за кружок справа от блока. Del — удалить выделенное.',
              'Drag a component onto the canvas or click it: if a block is selected, the new one is placed to its right and connected to it. To connect manually, drag from the circle on the right of a block. Del deletes the selection.',
            )}
          </p>
        </aside>

        <div className="panel canvas-wrap builder-wrap" ref={wrapRef}>
          <div className="builder-stats">
            <Stat label={tr('нагрузка', 'load')} value={estimated ? `${fmt(result.totalRps)} rps` : '? rps'} />
            <Stat
              label={tr('успешных', 'success')}
              value={`${(result.clientSuccess * 100).toFixed(2)}%`}
              tone={result.clientSuccess >= 0.995 ? 'ok' : result.clientSuccess >= 0.95 ? 'warn' : 'bad'}
            />
            <Stat
              label={tr('латентность', 'latency')}
              value={tr(`${Math.round(result.clientLatency)} мс`, `${Math.round(result.clientLatency)} ms`)}
              tone={result.clientLatency <= 150 ? 'ok' : result.clientLatency <= 500 ? 'warn' : 'bad'}
            />
            <Stat
              label={tr('рост очереди', 'queue growth')}
              value={tr(`${fmt(result.backlogGrowth)}/с`, `${fmt(result.backlogGrowth)}/s`)}
              tone={result.backlogGrowth < 1 ? 'ok' : 'bad'}
            />
            <CostStat nodes={nodes} total={result.cost} budget={challenge?.budget} />
            {flash && <span className="flash">{flash}</span>}
          </div>
          {(cycleNote || result.cycle) && (
            <div className="cycle-note">
              <button className="icon" onClick={() => setCycleNote(null)} title={tr('Понятно', 'Got it')}>
                ✕
              </button>
              <b>{tr('🔁 Цикл: связь не добавлена.', '🔁 Loop: connection not added.')}</b>{' '}
              {cycleNote ?? tr('На схеме есть замкнутый круг связей.', 'The diagram contains a closed loop of connections.')}
              <div className="small">
                {tr(
                  <>
                    Стрелка — это направление <b>запроса</b>: кто кого вызывает. Ответ возвращается по той же стрелке
                    сам, обратную рисовать не нужно. Если вы хотели <b>cache-aside</b> (сервис сначала смотрит в Redis, а
                    при промахе идёт в БД и кладёт результат в кэш) — соедините <b>сервис → Redis</b> и{' '}
                    <b>сервис → БД</b>: в БД пойдут только промахи. Вариант <b>read-through</b> — цепочка сервис → Redis →
                    БД.
                  </>,
                  <>
                    An arrow is the direction of a <b>request</b>: who calls whom. The response travels back along the
                    same arrow, so there is no need to draw a reverse one. If you meant <b>cache-aside</b> (the service
                    checks Redis first and, on a miss, goes to the DB and puts the result into the cache), connect{' '}
                    <b>service → Redis</b> and <b>service → DB</b>: only misses will reach the DB. The{' '}
                    <b>read-through</b> option is the chain service → Redis → DB.
                  </>,
                )}
              </div>
            </div>
          )}
          <BuilderCanvas
            nodes={nodes}
            edges={edges}
            result={result}
            selected={selected}
            onSelect={setSelected}
            onMove={(id, x, y) => patch(id, { x, y })}
            onConnect={connect}
            hideLoad={!estimated}
            onDropKind={(kind, x, y) => kind in KINDS && add(kind as NodeKind, { x, y })}
            traces={traffic.inFlight}
          />
          {(selNode || selEdge) && (
            <ElementPopover anchor={anchorOf(selNode, selEdge)} wrap={wrapRef.current}>
              {selEdge && (
                <>
                  <div className="card-head">
                    <b>
                      {tr('Связь', 'Connection')}: {nodes.find((n) => n.id === selEdge.from)?.label} → {nodes.find((n) => n.id === selEdge.to)?.label}
                    </b>
                    <button className="icon" onClick={() => setSelected(null)} title={tr('Закрыть (Esc)', 'Close (Esc)')}>
                      ✕
                    </button>
                  </div>
                  <p className="small muted">{estimated ? `${fmt(result.edges[selEdge.id]?.rps ?? 0)} rps` : '? rps'}{result.edges[selEdge.id]?.async ? ' · async' : ''}</p>
                  <button onClick={remove}>{tr('Удалить связь', 'Delete connection')}</button>
                </>
              )}
              {selNode && (
                <>
                  <div className="card-head">
                    <b>
                      {KINDS[selNode.kind].icon} {selNode.label}
                    </b>
                    <button className="icon" onClick={() => setSelected(null)} title={tr('Закрыть (Esc)', 'Close (Esc)')}>
                      ✕
                    </button>
                  </div>
                  <NodeProps
                    node={selNode}
                    hideLoad={!estimated}
                    fixedHit={challenge ? challenge.hitRatio : null}
                    stats={result.nodes[selNode.id]}
                    locked={locked(selNode.id)}
                    patch={(p) => patch(selNode.id, p)}
                    remove={remove}
                  />
                  {estimated && selNode.kind !== 'client' && <NodeLog nodeId={selNode.id} log={traffic.log} />}
                </>
              )}
            </ElementPopover>
          )}
          {estimated ? (
            <TrafficPanel log={traffic.log} nodes={nodes} running={traffic.running} setRunning={traffic.setRunning} onPickNode={setSelected} />
          ) : (
            <p className="small muted traffic-locked">
              📡 {tr('Живой трафик включится после прикидки нагрузки.', 'Live traffic starts once the load estimate is done.')}
            </p>
          )}
        </div>

      </div>
    </div>
  )
}

/** Общая стоимость, а в задаче — потрачено из бюджета; при наведении разбивка по компонентам */
function CostStat({ nodes, total, budget }: { nodes: BNode[]; total: number; budget?: number }) {
  const lines = nodes
    .filter((n) => KINDS[n.kind].cost > 0)
    .map((n) => ({ text: `${KINDS[n.kind].icon} ${n.label} ×${n.instances}`, cost: KINDS[n.kind].cost * n.instances }))
    .sort((a, b) => b.cost - a.cost)
  const breakdown = lines.length ? lines.map((l) => `${l.text}: $${l.cost}`).join('\n') : tr('Пока ничего не стоит', 'Nothing costs anything yet')
  const tone = budget === undefined ? undefined : total > budget ? 'bad' : total > budget * 0.85 ? 'warn' : 'ok'
  return (
    <div className={'metric budget ' + (tone ?? '')} title={breakdown}>
      <div className="metric-value">
        ${total}
        {budget !== undefined && <span className="muted"> / ${budget}</span>}
      </div>
      <div className="metric-label">
        {budget !== undefined
          ? total > budget
            ? tr(`перерасход $${total - budget} в месяц`, `over budget by $${total - budget}/month`)
            : tr(`стоимость / бюджет · запас $${budget - total}`, `cost / budget · $${budget - total} left`)
          : tr('стоимость в месяц', 'cost per month')}
      </div>
      {budget !== undefined && (
        <div className="progressbar">
          <div style={{ width: `${Math.min(100, (total / budget) * 100)}%` }} />
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className={'metric ' + (tone ?? '')}>
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  )
}

function NodeProps({
  node,
  stats,
  locked,
  patch,
  remove,
  hideLoad,
  fixedHit,
}: {
  hideLoad: boolean
  fixedHit: BuilderChallenge['hitRatio'] | null
  node: BNode
  stats?: ReturnType<typeof simulate>['nodes'][string]
  locked: boolean
  patch: (p: Partial<BNode>) => void
  remove: () => void
}) {
  const spec = KINDS[node.kind]
  const profile = SERVICE_PROFILES.find((p) => p.capacity === node.capacity && p.latency === node.latency)
  return (
    <div>
      <div className="small muted">
        {spec.icon} {spec.title}
      </div>
      <label>
        {tr('название', 'name')}
        <input type="text" value={node.label} onChange={(e) => patch({ label: e.target.value })} />
      </label>
      <p className="small muted">{spec.desc}</p>
      {node.kind === 'client' ? (
        locked ? (
          <>
            <p>
              {tr('Нагрузка', 'Load')}: {hideLoad ? tr('сначала сделайте прикидку', 'make the estimate first') : `${node.rps} rps`}
            </p>
            <p className="small">{tr('Профиль', 'Workload')}: {WORKLOADS[node.workload ?? 'oltp'].title}</p>
          </>
        ) : (
          <>
            <label>
              {tr('профиль нагрузки', 'workload')}
              <select
                value={node.workload ?? 'oltp'}
                onChange={(e) => patch({ workload: e.target.value as Workload })}
              >
                {(Object.keys(WORKLOADS) as Workload[]).map((w) => (
                  <option key={w} value={w}>
                    {WORKLOADS[w].title}
                  </option>
                ))}
              </select>
            </label>
          <label>
            {tr('нагрузка', 'load')}: {node.rps} rps
            <input
              type="range"
              min={50}
              max={40000}
              step={50}
              value={node.rps}
              onChange={(e) => patch({ rps: +e.target.value })}
            />
          </label>
          </>
        )
      ) : (
        <label>
          {tr('экземпляров', 'instances')}: {node.instances}
          <input
            type="range"
            min={1}
            max={spec.maxInstances}
            value={node.instances}
            onChange={(e) => patch({ instances: +e.target.value })}
          />
        </label>
      )}
      {node.kind === 'service' && !locked && (
        <label>
          {tr('профиль', 'profile')}
          <select
            value={profile?.id ?? ''}
            onChange={(e) => {
              const p = SERVICE_PROFILES.find((x) => x.id === e.target.value)!
              patch({ capacity: p.capacity, latency: p.latency })
            }}
          >
            {SERVICE_PROFILES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {node.kind === 'service' && locked && (
        <p className="small">
          {tr(`${node.capacity} rps на экземпляр, ${node.latency} мс`, `${node.capacity} rps per instance, ${node.latency} ms`)}
        </p>
      )}
      {(node.kind === 'cache' || node.kind === 'cdn') &&
        (fixedHit ? (
          <p className="small">
            {tr(
              `Доля попаданий ${Math.round((node.hitRatio ?? 0) * 100)}% — определяется данными задачи`,
              `Hit ratio ${Math.round((node.hitRatio ?? 0) * 100)}%, set by the task`,
            )}
          </p>
        ) : (
          <label>
            {tr('доля попаданий', 'hit ratio')}: {Math.round((node.hitRatio ?? 0.8) * 100)}%
            <input
              type="range"
              min={0}
              max={0.99}
              step={0.01}
              value={node.hitRatio ?? 0.8}
              onChange={(e) => patch({ hitRatio: +e.target.value })}
            />
          </label>
        ))}
      {KINDS[node.kind].fit && (
        <table className="cmp small fit-table">
          <tbody>
            {(Object.keys(WORKLOADS) as Workload[]).map((w) => {
              const f = KINDS[node.kind].fit?.[w] ?? 0
              return (
                <tr key={w} className={f === 0 ? 'muted' : ''}>
                  <td>{WORKLOADS[w].short}</td>
                  <td>
                    <div className="fit-bar">
                      <div style={{ width: `${f * 100}%` }} />
                    </div>
                  </td>
                  <td>{f === 0 ? tr('не умеет', 'unsupported') : f >= 1 ? tr('родной', 'native') : `×${f}`}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {stats && node.kind !== 'client' && (
        <table className="cmp small">
          <tbody>
            <tr>
              <td>{tr('вход', 'input')}</td>
              <td>{hideLoad ? '?' : `${fmt(stats.in)} rps`}</td>
            </tr>
            {stats.unsupported > 0 && (
              <tr className="bad-text">
                <td>{tr('не умеет', 'unsupported')}</td>
                <td>{tr(`${Math.round(stats.unsupported * 100)}% запросов`, `${Math.round(stats.unsupported * 100)}% of requests`)}</td>
              </tr>
            )}
            <tr>
              <td>{tr('ёмкость', 'capacity')}</td>
              <td>{fmt(stats.capacity)} rps</td>
            </tr>
            <tr>
              <td>{tr('загрузка', 'utilization')}</td>
              <td>{Math.round(stats.util * 100)}%</td>
            </tr>
            <tr>
              <td>{tr('успешно', 'success')}</td>
              <td>{(stats.success * 100).toFixed(1)}%</td>
            </tr>
            <tr>
              <td>{tr('латентность', 'latency')}</td>
              <td>{tr(`${Math.round(stats.latency)} мс`, `${Math.round(stats.latency)} ms`)}</td>
            </tr>
            <tr>
              <td>{tr('стоимость', 'cost')}</td>
              <td>${spec.cost * node.instances}</td>
            </tr>
          </tbody>
        </table>
      )}
      {!locked && <button onClick={remove}>{tr('Удалить блок', 'Delete block')}</button>}
    </div>
  )
}

function EstimatePanel({
  estimate,
  done,
  onDone,
}: {
  estimate: NonNullable<BuilderChallenge['estimate']>
  done: boolean
  onDone: () => void
}) {
  const [value, setValue] = useState('')
  const [tries, setTries] = useState(0)
  const [wrong, setWrong] = useState(false)
  if (done)
    return (
      <div className="estimate done">
        <b>{tr('📐 Прикидка:', '📐 Estimate:')}</b> {estimate.formula}
      </div>
    )
  const check = () => {
    const v = Number(value.replace(/\s/g, '').replace(',', '.'))
    if (estimateOk(estimate, v)) onDone()
    else {
      setTries(tries + 1)
      setWrong(true)
    }
  }
  return (
    <div className="estimate">
      <b>{tr('📐 Сначала прикидка (back-of-the-envelope):', '📐 First, a back-of-the-envelope estimate:')}</b> {estimate.question}
      <div className="row" style={{ marginTop: 6 }}>
        <input
          type="text"
          inputMode="numeric"
          placeholder={tr('ваша оценка', 'your estimate')}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setWrong(false)
          }}
          onKeyDown={(e) => e.key === 'Enter' && check()}
        />
        <span className="small muted">{estimate.unit}</span>
        <button className="primary" onClick={check}>
          {tr('Проверить', 'Check')}
        </button>
        {tries >= 2 && <button onClick={onDone}>{tr('Показать расчёт', 'Show calculation')}</button>}
      </div>
      {wrong && (
        <div className="small warn-text">
          {tr(
            'Не попали в ±25%. В сутках 86 400 секунд, а пик выше среднего — проверьте множители.',
            'Not within ±25%. A day has 86,400 seconds, and the peak is above average: check your multipliers.',
          )}
        </div>
      )}
    </div>
  )
}

const POPOVER_W = 320

/** Окно параметров рядом с элементом: справа от него, а если не помещается — слева */
function ElementPopover({
  anchor,
  wrap,
  children,
}: {
  anchor: { x: number; y: number; w: number; h: number }
  wrap: HTMLDivElement | null
  children: ReactNode
}) {
  // перерисовываемся при изменении размеров окна, чтобы окно держалось у элемента
  const [, setTick] = useState(0)
  useEffect(() => {
    const h = () => setTick((t) => t + 1)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])
  const svg = wrap?.querySelector('svg.builder-canvas') as SVGSVGElement | null
  let style: React.CSSProperties = { left: 8, top: 8 }
  if (wrap && svg) {
    const wr = wrap.getBoundingClientRect()
    const sr = svg.getBoundingClientRect()
    const vb = svg.viewBox.baseVal
    const k = sr.width / (vb.width || 1000)
    const ox = sr.left - wr.left + wrap.scrollLeft
    const oy = sr.top - wr.top + wrap.scrollTop
    const left = ox + (anchor.x - vb.x) * k
    const top = oy + (anchor.y - vb.y) * k
    const right = left + anchor.w * k
    const fitsRight = right + 12 + POPOVER_W <= wrap.scrollWidth
    const x = fitsRight ? right + 12 : Math.max(8, left - 12 - POPOVER_W)
    style = { left: x, top: Math.max(8, top - 8) }
  }
  return (
    <div className="node-popover" style={style} onPointerDown={(e) => e.stopPropagation()} role="dialog">
      {children}
    </div>
  )
}
