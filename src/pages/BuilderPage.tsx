import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BuilderCanvas, MOOD_FACE, NODE_H, NODE_W, PALETTE_MIME, clientMood, fmt, freeSpot } from '../sim/builder/BuilderCanvas'
import {
  KINDS,
  SIZES,
  WORKLOADS,
  baseCapacity,
  nodeCost,
  scaleText,
  writeCapacity,
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
import { RefModal } from '../components/RefCard'
import { ResultButton, ResultModal, useResultModal } from '../components/ResultModal'
import { sideColumn, useBottomSheet, useCloseOnOutside, usePopoverReflow } from '../components/popover'
import { HintDock } from '../components/HintDock'
import { diagnose } from '../sim/builder/diagnose'
import { markScenario, recordStars, cappedStars, useHints, referenceNote } from '../progress'
import { tr } from '../i18n'
import { TaskGate, TaskLevelTag } from '../components/Level'
import { NodeLog, TrafficPanel, useLiveTraffic } from '../sim/builder/TrafficPanel'

const KIND_GROUP_LABEL: Record<'Трафик' | 'Вычисления' | 'Хранилища', string> = {
  Трафик: tr('Трафик', 'Traffic'),
  Вычисления: tr('Вычисления', 'Compute'),
  Хранилища: tr('Хранилища', 'Storage'),
}

let uid = 100
const nextId = (p: string) => `${p}${++uid}`

export default function BuilderPage({ id }: { id?: string }) {
  const mode = id && builderChallenges.some((c) => c.id === id) ? id : 'sandbox'
  const challenge = builderChallenges.find((c) => c.id === mode)
  return (
    <div className="page">
      <div className="crumbs">
        <a href="#/">{tr('Карта', 'Map')}</a> / {challenge ? tr('Конструктор', 'Builder') : tr('Конструктор: свободный режим', 'Builder: sandbox')}
      </div>
      <h1>
        🏗️ {challenge ? challenge.title : tr('Конструктор архитектуры', 'Architecture Builder')}{' '}
        {challenge && <TaskLevelTag taskKey={`builder/${challenge.id}`} full />}
      </h1>
      {!challenge && (
        <p className="muted">
          {tr('Свободный режим: собирайте что угодно. Задачи — на ', 'Sandbox: build anything. Challenges are on the ')}
          <a href="#/">{tr('карте уровней', 'level map')}</a>.
        </p>
      )}
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
  const hintState = useHints(`builder/${challenge?.id ?? 'sandbox'}`)
  const hints = hintState.used
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
  // динамические подсказки: что сейчас мешает на поле
  const live = useMemo(
    () => diagnose({ nodes, edges, result, goals: challenge ? goals : undefined, budget: challenge?.budget }),
    // goals пересчитываются из тех же nodes/edges/result и отметки о прикидке
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes, edges, result, challenge, estimated],
  )
  useEffect(() => {
    if (solved && challenge && !viewingRef) markScenario(`builder/${challenge.id}`)
  }, [solved, challenge, viewingRef])

  const review = challenge && (showReview || solved) ? reviewBuilder(challenge, nodes, edges, result, estimated) : null
  // звёзды — оценка решения, но не выше потолка по подсказкам и просмотру эталона
  const stars = solved && !viewingRef && review ? cappedStars(review.stars, hints) : undefined
  const result$ = useResultModal(solved, !viewingRef)
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
      hintState.reveal()
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
    // перетащили — ставим туда, куда бросили; по клику — на свободное место внизу холста, а не рядом с выделенным:
    // где блоку место в схеме и с чем его связать, решает игрок
    const want = at ? { x: at.x - NODE_W / 2, y: at.y - NODE_H / 2 } : { x: 40, y: 540 - NODE_H - 20 }
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
    setNodes([...nodes, n])
    setSelected(null)
    setRevealId(n.id)
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
      if (e.key === 'Escape') {
        setSelected(null)
        setAddOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const wrapRef = useRef<HTMLDivElement>(null)
  const [addOpen, setAddOpen] = useState(false)
  /** Только что добавленный блок: холст покажет и подсветит его */
  const [revealId, setRevealId] = useState<string | null>(null)
  useEffect(() => {
    if (!revealId) return
    const t = setTimeout(() => setRevealId(null), 2500)
    return () => clearTimeout(t)
  }, [revealId])
  const [dragging, setDragging] = useState(false)
  const closePopover = useCallback(() => setSelected(null), [])
  const addRef = useRef<HTMLDivElement>(null)
  // меню «Добавить компонент» закрывается от любого клика мимо него — как обычное выпадающее меню
  useEffect(() => {
    if (!addOpen) return
    const onDown = (e: PointerEvent) => {
      if (!addRef.current?.contains(e.target as Node)) setAddOpen(false)
    }
    // в фазе погружения: блоки на холсте останавливают всплытие, а меню должно закрыться и от щелчка по ним
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [addOpen])
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
            {hints < challenge.hints.length && (
              <button onClick={hintState.take}>
                💡 {tr('Подсказка', 'Hint')} ({Math.min(hints, challenge.hints.length)}/{challenge.hints.length})
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
      {challenge && (
        <div className="row review-actions">
          {solved && !viewingRef ? (
            <ResultButton solved onClick={() => result$.setOpen(true)} />
          ) : (
            <button onClick={() => setShowReview(!showReview)}>
              📋 {showReview ? tr('Скрыть оценку', 'Hide assessment') : tr('Оценить решение', 'Assess solution')}
            </button>
          )}
          {!viewingRef && <button onClick={toggleReference} title={referenceNote()}>👁 {tr('Показать эталон на схеме', 'Show reference on canvas')}</button>}
        </div>
      )}
      {review && showReview && !(solved && !viewingRef) && (
        <ReviewPanel review={review} title={viewingRef ? tr('Оценка эталона', 'Reference assessment') : tr('Оценка вашего решения', 'Your solution assessment')} />
      )}
      {challenge && (
        <ResultModal open={result$.open} onClose={() => result$.setOpen(false)} progressKey={`builder/${challenge.id}`} stars={stars ?? 1}>
          {review && <ReviewPanel review={review} title={tr('Оценка вашего решения', 'Your solution assessment')} />}
          <div className="lesson">
            <h3>{tr('Разбор задачи', 'Debrief')}</h3>
            <Rich paras={challenge.debrief} />
          </div>
        </ResultModal>
      )}

      {refId && <RefModal id={refId} onClose={() => setRefId(null)} />}
      <div className="builder-grid">

        <div className="panel canvas-wrap builder-wrap" ref={wrapRef}>
          <div ref={addRef}>
          <div className="add-bar">
            {/* на телефоне — плавающая кнопка в углу экрана: до неё не нужно прокручивать */}
            <button
              className={'add-btn' + (addOpen ? ' primary' : '') + (selNode || selEdge || addOpen ? ' fab-hidden' : '')}
              onClick={() => setAddOpen(!addOpen)}
              aria-expanded={addOpen}
              aria-label={tr('Добавить компонент', 'Add a component')}
            >
              ＋<span className="add-label"> {tr('Добавить компонент', 'Add a component')}</span>
            </button>
            <span className="small muted">{tr('кэш, очередь, база, CDN…', 'cache, queue, database, CDN…')}</span>
            <HintDock
              hints={challenge?.hints ?? []}
              used={hints}
              take={hintState.take}
              live={live}
              liveLocked={estimated ? undefined : tr('Сначала сделайте прикидку нагрузки — до неё модель не покажет цифры.', 'Do the load estimate first; until then the model shows no numbers.')}
              onPick={(id) => {
                setSelected(id)
                setAddOpen(false)
              }}
            />
          </div>
          {addOpen && (
            <div className="panel palette add-menu" role="menu">
          {(['Трафик', 'Вычисления', 'Хранилища'] as const).map((group) => (
            <div key={group}>
              <div className="pattern-group-title">{KIND_GROUP_LABEL[group]}</div>
              {(Object.keys(KINDS) as NodeKind[])
                .filter((k) => KINDS[k].group === group && !(challenge && k === 'client'))
                .map((k) => (
                  <div key={k} className="palette-row">
                  <button
                    className="palette-item"
                    onClick={() => {
                      add(k)
                      setAddOpen(false)
                    }}
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
              'Кликните — компонент появится внизу холста, или перетащите его на нужное место. Связь — тяните за кружок справа от блока. Del — удалить выделенное.',
              'Click to place a component at the bottom of the canvas, or drag it where you want. To connect, drag from the circle on the right of a block. Del deletes the selection.',
            )}
          </p>
          <p className="small muted">
            {tr(
              'Числа условные: настоящий PostgreSQL на простых запросах держит в разы больше. Важны пропорции и то, что во что упирается.',
              'The numbers are stylized: a real PostgreSQL handles several times more on simple queries. What matters is the proportions and what limits what.',
            )}
          </p>
            </div>
          )}
          </div>
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
            onSelect={(id) => {
              setSelected(id)
              setAddOpen(false)
            }}
            onMove={(id, x, y) => patch(id, { x, y })}
            onConnect={connect}
            hideLoad={!estimated}
            onDropKind={(kind, x, y) => {
              if (kind in KINDS) add(kind as NodeKind, { x, y })
              setAddOpen(false)
            }}
            traces={traffic.inFlight}
            onDragging={setDragging}
            reveal={revealId}
          />
          {(selNode || selEdge) && !dragging && (
            <ElementPopover
              anchor={anchorOf(selNode, selEdge)}
              wrap={wrapRef.current}
              onClose={closePopover}
              tone={selNode ? nodeStatus(selNode, result.nodes[selNode.id], !estimated).tone : edgeStatus(selEdge!, result, nodes, !estimated).tone}
            >
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
                  <StatusBadge {...edgeStatus(selEdge, result, nodes, !estimated)} />
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
                  <StatusBadge {...nodeStatus(selNode, result.nodes[selNode.id], !estimated)} />
                  {(['settings', 'load'] as const).map((tab) => (
                    <NodeProps
                      key={tab}
                      tab={tab}
                      node={selNode}
                      hideLoad={!estimated}
                      fixedHit={challenge ? challenge.hitRatio : null}
                      stats={result.nodes[selNode.id]}
                      locked={locked(selNode.id)}
                      patch={(p) => patch(selNode.id, p)}
                      remove={remove}
                    />
                  ))}
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
    .map((n) => ({ text: `${KINDS[n.kind].icon} ${n.label} ${scaleText(n)}`, cost: nodeCost(n) }))
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
  tab,
}: {
  hideLoad: boolean
  fixedHit: BuilderChallenge['hitRatio'] | null
  tab: 'settings' | 'load'
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
      {tab === 'settings' && (
      <>
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
        <Scaling node={node} patch={patch} external={profile?.id === 'external'} />
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
      {!locked && <button onClick={remove}>{tr('Удалить блок', 'Delete block')}</button>}
      </>
      )}
      {tab === 'load' && KINDS[node.kind].fit && (
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
      {tab === 'load' && stats && node.kind !== 'client' && (
        <table className="cmp small">
          <tbody>
            <tr>
              <td>{tr('вход', 'input')}</td>
              <td>{hideLoad ? '?' : `${fmt(stats.in)} rps`}</td>
            </tr>
            {!hideLoad && stats.writes > 0 && (
              <tr>
                <td>{tr('из них запись', 'of which writes')}</td>
                <td>{fmt(stats.writes)} rps</td>
              </tr>
            )}
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
              <td>${nodeCost(node)}</td>
            </tr>
          </tbody>
        </table>
      )}
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

/**
 * Окно параметров — колонка сбоку от элемента на всю видимую высоту: справа от него, а если не помещается — слева.
 * Так окно не упирается в низ экрана, и прокручивать почти ничего не нужно.
 */
function ElementPopover({
  anchor,
  wrap,
  tone,
  onClose,
  children,
}: {
  anchor: { x: number; y: number; w: number; h: number }
  wrap: HTMLDivElement | null
  tone: Tone
  onClose: () => void
  children: ReactNode
}) {
  usePopoverReflow()
  const ref = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  useCloseOnOutside(ref, onClose, '.bnode, .bedge, .access-row, .wf-name, .canvas-zoom')
  const sheet = useBottomSheet(ref, body, onClose)
  const svg = wrap?.querySelector('svg.builder-canvas') as SVGSVGElement | null
  let style: React.CSSProperties = { left: 8, top: 72, bottom: 8 }
  if (svg) {
    const sr = svg.getBoundingClientRect()
    const vb = svg.viewBox.baseVal
    const k = sr.width / (vb.width || 1000)
    style = sideColumn(sr.left + (anchor.x - vb.x) * k, sr.left + (anchor.x + anchor.w - vb.x) * k, POPOVER_W)
  }
  // через портал в body: у панелей есть backdrop-filter, и position: fixed внутри них считался бы от панели
  return createPortal(
    <div ref={ref} className={'node-popover tone-' + tone + (sheet.full ? ' sheet-full' : '')} style={style} onPointerDown={(e) => e.stopPropagation()} role="dialog">
      <div className="sheet-handle" {...sheet.handle} aria-hidden />
      <div className="popover-body" ref={body}>
        {children}
      </div>
    </div>,
    document.body,
  )
}

type Tone = 'ok' | 'warn' | 'bad' | 'idle'
interface Status {
  tone: Tone
  label: string
  detail: string
  /** Лицо пользователя — для клиентов */
  face?: string
}

const pctOf = (x: number) => `${Math.round(x * 100)}%`

/** Состояние блока — по тем же правилам, что и цвет его рамки на холсте */
function nodeStatus(n: BNode, st: ReturnType<typeof simulate>['nodes'][string] | undefined, hidden: boolean): Status {
  if (hidden) return { tone: 'idle', label: tr('Нагрузка скрыта', 'Load hidden'), detail: tr('Сначала сделайте прикидку нагрузки', 'Make the load estimate first') }
  if (!st) return { tone: 'idle', label: tr('Нет данных', 'No data'), detail: '' }
  if (n.kind === 'client') {
    const mood = clientMood(st.success, st.latency)
    const tone: Tone = mood === 'happy' ? 'ok' : mood === 'meh' ? 'warn' : 'bad'
    const label =
      mood === 'happy'
        ? tr('Пользователи довольны', 'Users are happy')
        : mood === 'meh'
          ? tr('Пользователи недовольны', 'Users are unhappy')
          : tr('Пользователи злятся', 'Users are angry')
    const why =
      st.success < 0.95
        ? tr('много ошибок', 'many errors')
        : st.success < 0.995
          ? tr('часть запросов падает', 'some requests fail')
          : st.latency > 300
            ? tr('ответы медленные', 'responses are slow')
            : tr('всё быстро и без ошибок', 'fast and error-free')
    return {
      tone,
      face: MOOD_FACE[mood],
      label,
      detail: tr(`${why}: успешных ${(st.success * 100).toFixed(1)}%, ответ за ${Math.round(st.latency)} мс`, `${why}: ${(st.success * 100).toFixed(1)}% successful, ${Math.round(st.latency)} ms response`),
    }
  }
  if (st.deadEnd) return { tone: 'bad', label: tr('Тупик', 'Dead end'), detail: tr('Запросам некуда идти дальше — подключите следующий блок', 'Requests have nowhere to go next; connect the next block') }
  if (st.unsupported > 0)
    return { tone: 'bad', label: tr('Не подходит для запросов', 'Unsuitable for these requests'), detail: tr(`не умеет обрабатывать ${pctOf(st.unsupported)} запросов`, `cannot handle ${pctOf(st.unsupported)} of requests`) }
  if (st.in <= 0) return { tone: 'idle', label: tr('Простаивает', 'Idle'), detail: tr('Сюда не приходят запросы', 'No requests reach this block') }
  if (st.util >= 1 || st.success < 0.99)
    return {
      tone: 'bad',
      label: tr('Перегружен', 'Overloaded'),
      detail: tr(`загрузка ${pctOf(st.util)}, отказывает ${pctOf(1 - st.success)} запросов`, `${pctOf(st.util)} utilization, rejects ${pctOf(1 - st.success)} of requests`),
    }
  if (st.util >= 0.8) return { tone: 'warn', label: tr('На пределе', 'Near the limit'), detail: tr(`загрузка ${pctOf(st.util)} — задержки растут, запаса почти нет`, `${pctOf(st.util)} utilization: latency grows, little headroom left`) }
  return { tone: 'ok', label: tr('В норме', 'Healthy'), detail: tr(`загрузка ${pctOf(st.util)}, ответ за ${Math.round(st.latency)} мс`, `${pctOf(st.util)} utilization, ${Math.round(st.latency)} ms response`) }
}

/** Связь: асинхронная — жёлтая, в проблемный блок — красная, иначе зелёная */
function edgeStatus(e: BEdge, r: ReturnType<typeof simulate>, nodes: BNode[], hidden: boolean): Status {
  if (hidden) return { tone: 'idle', label: tr('Нагрузка скрыта', 'Load hidden'), detail: '' }
  const st = r.edges[e.id]
  const target = r.nodes[e.to]
  const to = nodes.find((n) => n.id === e.to)
  if (!st || st.rps <= 0) return { tone: 'idle', label: tr('Без трафика', 'No traffic'), detail: tr('По этой связи сейчас ничего не идёт', 'Nothing flows along this connection now') }
  if (target && (target.success < 0.99 || target.deadEnd))
    return { tone: 'bad', label: tr('Ведёт в проблемный блок', 'Leads to a failing block'), detail: tr(`«${to?.label}» отвечает успешно только на ${(target.success * 100).toFixed(1)}%`, `“${to?.label}” succeeds only ${(target.success * 100).toFixed(1)}% of the time`) }
  if (st.async) return { tone: 'warn', label: tr('Асинхронно', 'Asynchronous'), detail: tr('Сообщения ждут в очереди, ответ клиенту не задерживается', 'Messages wait in the queue; the client response is not delayed') }
  return { tone: 'ok', label: tr('В норме', 'Healthy'), detail: `${fmt(st.rps)} rps` }
}

function StatusBadge({ tone, label, detail, face }: Status) {
  return (
    <div className={'status-badge ' + tone}>
      {face ? <span className="status-face">{face}</span> : <span className="status-dot" />}
      <b>{label}</b>
      {/* место под пояснение есть всегда: иначе плашка меняет высоту и ползунки под ней прыгают */}
      <span className="small">{detail}</span>
    </div>
  )
}

/** Масштабирование: у разных блоков — разные способы, и они дают разное */
function Scaling({ node, patch, external }: { node: BNode; patch: (p: Partial<BNode>) => void; external: boolean }) {
  const spec = KINDS[node.kind]
  const unitLabel: Record<typeof spec.unit, string> = {
    instances: external
      ? tr('подключений к провайдеру', 'connections to the provider')
      : tr('экземпляров (горизонтально)', 'instances (horizontal)'),
    replicas: tr('узлов в шарде: primary + реплики для чтения', 'nodes per shard: primary + read replicas'),
    nodes: tr('узлов (данные и запись делятся между ними)', 'nodes (data and writes are split across them)'),
    brokers: tr('брокеров', 'brokers'),
    partitions: tr('партиций (префиксов ключей)', 'partitions (key prefixes)'),
  }
  const unitHint: Record<typeof spec.unit, string> = {
    instances: external
      ? tr('Внешний API ограничен лимитом провайдера и числом подключений, а не процессором', 'An external API is limited by the provider’s rate limit and connections, not by CPU')
      : tr('Без состояния — просто добавляйте одинаковые экземпляры', 'Stateless: just add identical instances'),
    replicas: tr('Реплики масштабируют только чтение: вся запись идёт в primary', 'Replicas scale reads only: all writes go to the primary'),
    nodes: tr('Масштабируется и чтение, и запись', 'Scales both reads and writes'),
    brokers: tr('Больше брокеров — больше пропускная способность и партиций', 'More brokers means more throughput and partitions'),
    partitions: tr('Объектное хранилище масштабируется по префиксам ключей', 'Object storage scales by key prefix'),
  }
  const size = node.size ?? 1
  const shards = node.shards ?? 1
  return (
    <div className="scaling">
      <label>
        {unitLabel[spec.unit]}:{' '}
        <span className={'range-num' + (spec.unit === 'replicas' ? ' wide' : '')}>
          {node.instances}
          {spec.unit === 'replicas' && node.instances > 1 && <span className="muted"> (1 + {node.instances - 1})</span>}
        </span>
        <input type="range" min={1} max={spec.maxInstances} value={node.instances} onChange={(e) => patch({ instances: +e.target.value })} />
      </label>
      <div className="small muted">{unitHint[spec.unit]}</div>
      {spec.vertical && (
        <label>
          {tr('размер машины (вертикально)', 'machine size (vertical)')}
          <select value={size} onChange={(e) => patch({ size: +e.target.value })}>
            {SIZES.map((x) => (
              <option key={x} value={x}>
                {x === 1 ? tr('обычная', 'standard') : x === SIZES[SIZES.length - 1] ? tr(`×${x} — самая большая`, `×${x}: the largest`) : `×${x}`}
              </option>
            ))}
          </select>
        </label>
      )}
      {spec.maxShards && (
        <>
          <label>
            {tr('шардов', 'shards')}: <span className="range-num">{shards}</span>
            <input type="range" min={1} max={spec.maxShards} value={shards} onChange={(e) => patch({ shards: +e.target.value })} />
          </label>
          <div className="small muted">
            {tr(
              'Шарды делят данные и запись. Цена — транзакции и JOIN между шардами: OLTP медленнее, аналитика заметно медленнее.',
              'Shards split data and writes. The price is transactions and JOINs across shards: OLTP gets slower, analytics much slower.',
            )}
          </div>
        </>
      )}
      {isStorage(node.kind) && (
        <div className="small scaling-cap">
          {tr('ёмкость', 'capacity')}: {tr('чтение', 'reads')} {fmt(baseCapacity(node))} rps · {tr('запись', 'writes')} {fmt(writeCapacity(node))} rps
        </div>
      )}
    </div>
  )
}

