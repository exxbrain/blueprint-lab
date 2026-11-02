import { useEffect, useMemo, useState } from 'react'
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
  estimateOk,
  sandboxStart,
  SERVICE_PROFILES,
  type BuilderChallenge,
} from '../sim/builder/challenges'
import { Rich } from '../components/Rich'
import { ReviewPanel } from '../components/ReviewPanel'
import { reviewBuilder } from '../sim/builder/review'
import { markScenario, useProgress } from '../progress'

let uid = 100
const nextId = (p: string) => `${p}${++uid}`

export default function BuilderPage() {
  const progress = useProgress()
  const [mode, setMode] = useState<string>('sandbox')
  const challenge = builderChallenges.find((c) => c.id === mode)
  return (
    <div className="page">
      <div className="crumbs">
        <a href="#/">Главная</a> / <a href="#/microservices">Микросервисы</a> / Конструктор
      </div>
      <h1>🏗️ Конструктор архитектуры</h1>
      <div className="row tabs">
        <button className={mode === 'sandbox' ? 'primary' : ''} onClick={() => setMode('sandbox')}>
          Свободный режим
        </button>
      </div>
      {(['Классика', 'System Design'] as const).map((group) => (
        <div key={group} className="row tabs">
          <span className="muted small tab-group">{group}:</span>
          {builderChallenges
            .filter((c) => c.group === group)
            .map((c) => (
              <button key={c.id} className={mode === c.id ? 'primary' : ''} onClick={() => setMode(c.id)}>
                {progress.scenarios[`builder/${c.id}`] ? '✓ ' : ''}
                {c.title}
              </button>
            ))}
        </div>
      ))}
      <Builder key={mode} challenge={challenge} />
    </div>
  )
}

function Builder({ challenge }: { challenge?: BuilderChallenge }) {
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

  const goals = challenge
    ? [
        ...challenge.paths.map((p) => ({ text: p.text, ok: reaches(edges, p.from, p.to) })),
        ...challenge.goals.map((g) => ({ text: g.text, ok: g.check(result) })),
        { text: `Стоимость ≤ $${challenge.budget}`, ok: result.cost <= challenge.budget },
        ...(challenge.estimate ? [{ text: 'Прикидка нагрузки сделана', ok: estimated }] : []),
      ]
    : []
  const solved = goals.length > 0 && goals.every((g) => g.ok)
  useEffect(() => {
    if (solved && challenge && !viewingRef) markScenario(`builder/${challenge.id}`)
  }, [solved, challenge, viewingRef])

  const review = challenge && (showReview || solved) ? reviewBuilder(challenge, nodes, edges, result, estimated) : null

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
    if (b.kind === 'client') return say('Клиенты — только источник нагрузки')
    if (edges.some((e) => e.from === from && e.to === to)) return say('Такая связь уже есть')
    if (wouldCycle(nodes, edges, from, to)) {
      const label = (id: string) => nodes.find((x) => x.id === id)?.label ?? id
      const back = pathBetween(edges, to, from) ?? [to, from]
      return setCycleNote(
        `Связь «${a.label} → ${b.label}» замкнула бы круг: ${[...back, to].map(label).join(' → ')}. ` +
          'Запрос бегал бы по нему бесконечно.',
      )
    }
    setCycleNote(null)
    if (isStorage(a.kind)) return say('Хранилище никого не вызывает')
    setEdges([...edges, { id: nextId('e'), from, to }])
  }

  const remove = () => {
    if (selNode) {
      if (locked(selNode.id)) return say('Этот компонент — часть исходной системы')
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
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

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
                💡 Подсказка ({hints}/{challenge.hints.length})
              </button>
            )}
          </div>
          <div className={'panel goal' + (solved ? ' success' : '')}>
            <h4>{solved ? '✅ Решено!' : '🎯 Цели'}</h4>
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
          👁 Вы смотрите <b>эталонное решение</b> — в зачёт оно не идёт.
          <button className="primary" onClick={toggleReference}>
            ↩ Вернуть моё решение
          </button>
        </div>
      )}
      {solved && challenge && !viewingRef && (
        <div className="panel success lesson" style={{ marginBottom: 12 }}>
          <h3>Разбор задачи</h3>
          <Rich paras={challenge.debrief} />
        </div>
      )}
      {challenge && (
        <div className="row review-actions">
          {!solved && (
            <button onClick={() => setShowReview(!showReview)}>
              📋 {showReview ? 'Скрыть оценку' : 'Оценить решение'}
            </button>
          )}
          {!viewingRef && <button onClick={toggleReference}>👁 Показать эталон на схеме</button>}
        </div>
      )}
      {review && <ReviewPanel review={review} title={viewingRef ? 'Оценка эталона' : 'Оценка вашего решения'} />}

      <div className="builder-grid">
        <aside className="panel palette">
          <h4>Компоненты</h4>
          {(['Трафик', 'Вычисления', 'Хранилища'] as const).map((group) => (
            <div key={group}>
              <div className="pattern-group-title">{group}</div>
              {(Object.keys(KINDS) as NodeKind[])
                .filter((k) => KINDS[k].group === group && !(challenge && k === 'client'))
                .map((k) => (
                  <button
                    key={k}
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
                ))}
            </div>
          ))}
          <p className="small muted">
            Перетащите компонент на холст или кликните: если выделен блок, новый встанет справа и сразу соединится
            с ним. Связь вручную — тяните за кружок справа от блока. Del — удалить выделенное.
          </p>
        </aside>

        <div className="panel canvas-wrap">
          <div className="builder-stats">
            <Stat label="нагрузка" value={estimated ? `${fmt(result.totalRps)} rps` : '? rps'} />
            <Stat
              label="успешных"
              value={`${(result.clientSuccess * 100).toFixed(2)}%`}
              tone={result.clientSuccess >= 0.995 ? 'ok' : result.clientSuccess >= 0.95 ? 'warn' : 'bad'}
            />
            <Stat
              label="латентность"
              value={`${Math.round(result.clientLatency)} мс`}
              tone={result.clientLatency <= 150 ? 'ok' : result.clientLatency <= 500 ? 'warn' : 'bad'}
            />
            <Stat
              label="рост очереди"
              value={`${fmt(result.backlogGrowth)}/с`}
              tone={result.backlogGrowth < 1 ? 'ok' : 'bad'}
            />
            <CostStat nodes={nodes} total={result.cost} budget={challenge?.budget} />
            {flash && <span className="flash">{flash}</span>}
          </div>
          {(cycleNote || result.cycle) && (
            <div className="cycle-note">
              <button className="icon" onClick={() => setCycleNote(null)} title="Понятно">
                ✕
              </button>
              <b>🔁 Цикл: связь не добавлена.</b> {cycleNote ?? 'На схеме есть замкнутый круг связей.'}
              <div className="small">
                Стрелка — это направление <b>запроса</b>: кто кого вызывает. Ответ возвращается по той же стрелке
                сам, обратную рисовать не нужно. Если вы хотели <b>cache-aside</b> (сервис сначала смотрит в Redis, а
                при промахе идёт в БД и кладёт результат в кэш) — соедините <b>сервис → Redis</b> и{' '}
                <b>сервис → БД</b>: в БД пойдут только промахи. Вариант <b>read-through</b> — цепочка сервис → Redis →
                БД.
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
          />
        </div>

        <aside className="panel props">
          <h4>Свойства</h4>
          {!selNode && !selEdge && <p className="small muted">Выберите блок или связь</p>}
          {selEdge && (
            <>
              <p>
                Связь: {nodes.find((n) => n.id === selEdge.from)?.label} → {nodes.find((n) => n.id === selEdge.to)?.label}
              </p>
              <p className="small muted">{fmt(result.edges[selEdge.id]?.rps ?? 0)} rps</p>
              <button onClick={remove}>Удалить связь</button>
            </>
          )}
          {selNode && (
            <NodeProps
              node={selNode}
              hideLoad={!estimated}
              fixedHit={challenge ? challenge.hitRatio : null}
              stats={result.nodes[selNode.id]}
              locked={locked(selNode.id)}
              patch={(p) => patch(selNode.id, p)}
              remove={remove}
            />
          )}
        </aside>
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
  const breakdown = lines.length ? lines.map((l) => `${l.text}: $${l.cost}`).join('\n') : 'Пока ничего не стоит'
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
            ? `перерасход $${total - budget} в месяц`
            : `стоимость / бюджет · запас $${budget - total}`
          : 'стоимость в месяц'}
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
        название
        <input type="text" value={node.label} onChange={(e) => patch({ label: e.target.value })} />
      </label>
      <p className="small muted">{spec.desc}</p>
      {node.kind === 'client' ? (
        locked ? (
          <>
            <p>Нагрузка: {hideLoad ? 'сначала сделайте прикидку' : `${node.rps} rps`}</p>
            <p className="small">Профиль: {WORKLOADS[node.workload ?? 'oltp'].title}</p>
          </>
        ) : (
          <>
            <label>
              профиль нагрузки
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
            нагрузка: {node.rps} rps
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
          экземпляров: {node.instances}
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
          профиль
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
          {node.capacity} rps на экземпляр, {node.latency} мс
        </p>
      )}
      {(node.kind === 'cache' || node.kind === 'cdn') &&
        (fixedHit ? (
          <p className="small">
            Доля попаданий {Math.round((node.hitRatio ?? 0) * 100)}% — определяется данными задачи
          </p>
        ) : (
          <label>
            доля попаданий: {Math.round((node.hitRatio ?? 0.8) * 100)}%
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
                  <td>{f === 0 ? 'не умеет' : f >= 1 ? 'родной' : `×${f}`}</td>
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
              <td>вход</td>
              <td>{hideLoad ? '?' : `${fmt(stats.in)} rps`}</td>
            </tr>
            {stats.unsupported > 0 && (
              <tr className="bad-text">
                <td>не умеет</td>
                <td>{Math.round(stats.unsupported * 100)}% запросов</td>
              </tr>
            )}
            <tr>
              <td>ёмкость</td>
              <td>{fmt(stats.capacity)} rps</td>
            </tr>
            <tr>
              <td>загрузка</td>
              <td>{Math.round(stats.util * 100)}%</td>
            </tr>
            <tr>
              <td>успешно</td>
              <td>{(stats.success * 100).toFixed(1)}%</td>
            </tr>
            <tr>
              <td>латентность</td>
              <td>{Math.round(stats.latency)} мс</td>
            </tr>
            <tr>
              <td>стоимость</td>
              <td>${spec.cost * node.instances}</td>
            </tr>
          </tbody>
        </table>
      )}
      {!locked && <button onClick={remove}>Удалить блок</button>}
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
        <b>📐 Прикидка:</b> {estimate.formula}
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
      <b>📐 Сначала прикидка (back-of-the-envelope):</b> {estimate.question}
      <div className="row" style={{ marginTop: 6 }}>
        <input
          type="text"
          inputMode="numeric"
          placeholder="ваша оценка"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setWrong(false)
          }}
          onKeyDown={(e) => e.key === 'Enter' && check()}
        />
        <span className="small muted">{estimate.unit}</span>
        <button className="primary" onClick={check}>
          Проверить
        </button>
        {tries >= 2 && <button onClick={onDone}>Показать расчёт</button>}
      </div>
      {wrong && (
        <div className="small warn-text">
          Не попали в ±25%. В сутках 86 400 секунд, а пик выше среднего — проверьте множители.
        </div>
      )}
    </div>
  )
}
