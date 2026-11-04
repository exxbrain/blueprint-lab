import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BuilderCanvas, MOOD_FACE, PALETTE_MIME, clientMood, fmt, freeSpot, nodesBox } from '../sim/builder/BuilderCanvas'
import {
  KINDS,
  SIZES,
  WORKLOADS,
  baseCapacity,
  nodeCost,
  scaleText,
  writeCapacity,
  isStorage,
  linkProblem,
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
  PRIMER,
  type BuilderChallenge,
} from '../sim/builder/challenges'
import { BOARD_H, BOARD_W, NODE_H, NODE_W } from '../sim/builder/layout'
import { Rich } from '../components/Rich'
import { RefBanner } from '../components/RefBanner'
import { ReviewPanel } from '../components/ReviewPanel'
import { reviewBuilder } from '../sim/builder/review'
import { RefModal } from '../components/RefCard'
import { ResultButton, ResultModal, useResultModal } from '../components/ResultModal'
import { isTyping, menuOpen, usePhone } from '../components/popover'
import { Sheet, Tool, Workspace } from '../components/Workspace'
import { useViewport } from '../components/editor/useViewport'
import { ZoomMenu } from '../components/editor/ZoomMenu'
import { EditorBar, ElementDialog } from '../components/editor/EditorBar'
import { nextId } from '../components/editor/nextId'
import { loadDraft, signature, useSaveDraft } from '../drafts'
import { HintDock } from '../components/HintDock'
import { diagnose } from '../sim/builder/diagnose'
import { markScenario, recordStars, cappedStars, useHints, referenceNote } from '../progress'
import { tr } from '../i18n'
import { TaskGate, TaskLevelTag } from '../components/Level'
import { ClientLog, NodeLog, TrafficPanel, useLiveTraffic } from '../sim/builder/TrafficPanel'
import { KindIcon } from '../sim/builder/KindIcon'

const KIND_GROUP_LABEL: Record<'Трафик' | 'Вычисления' | 'Хранилища', string> = {
  Трафик: tr('Трафик', 'Traffic', '流量'),
  Вычисления: tr('Вычисления', 'Compute', '计算'),
  Хранилища: tr('Хранилища', 'Storage', '存储'),
}

/** Источник сюжета: задача по мотивам System Design Primer — ссылка на разбор, автор, лицензия CC BY 4.0 и пометка об изменениях */
function SourceNote({ dir }: { dir: string }) {
  const link = (href: string, text: string) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {text}
    </a>
  )
  const primer = link(PRIMER.solution(dir), 'System Design Primer')
  const cc = link(PRIMER.license, 'CC BY 4.0')
  return (
    <p className="small muted">
      📖{' '}
      {tr(
        <>По мотивам {primer} (Donne Martin), {cc}, изменено</>,
        <>Based on {primer} (Donne Martin), {cc}, modified</>,
        <>改编自 {primer}（Donne Martin），{cc}，有改动</>,
      )}
    </p>
  )
}

export default function BuilderPage({ id }: { id?: string }) {
  const mode = id && builderChallenges.some((c) => c.id === id) ? id : 'sandbox'
  const challenge = builderChallenges.find((c) => c.id === mode)
  return (
    <div className="page">
      <div className="crumbs">
        <a href="#/">{tr('Карта', 'Map', '地图')}</a> / {challenge ? tr('Конструктор', 'Builder', '构建器') : tr('Конструктор: свободный режим', 'Builder: sandbox', '构建器：自由模式')}
      </div>
      <h1>
        🏗️ {challenge ? challenge.title : tr('Конструктор архитектуры', 'Architecture Builder', '架构构建器')}{' '}
        {challenge && <TaskLevelTag taskKey={`builder/${challenge.id}`} full />}
      </h1>
      {!challenge && (
        <p className="muted">
          {tr('Свободный режим: собирайте что угодно. Задачи — на ', 'Sandbox: build anything. Challenges are on the ', '自由模式：想搭什么就搭什么。任务请见')}
          <a href="#/">{tr('карте уровней', 'level map', '关卡地图')}</a>.
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
  // черновик: собранная схема переживает перезагрузку страницы
  const draftKey = `builder/${challenge?.id ?? 'sandbox'}`
  const draftSig = signature([start.nodes.map((n) => [n.id, n.kind]), start.edges.map((e) => [e.from, e.to])])
  const [saved] = useState(() => loadDraft<{ nodes: BNode[]; edges: BEdge[]; estimated: boolean }>(draftKey, draftSig))
  const [nodes, setNodes] = useState<BNode[]>(saved?.nodes ?? start.nodes)
  const [edges, setEdges] = useState<BEdge[]>(saved?.edges ?? start.edges)
  const [selected, setSelected] = useState<string | null>(null)
  const hintState = useHints(`builder/${challenge?.id ?? 'sandbox'}`)
  const hints = hintState.used
  const [flash, setFlash] = useState<string | null>(null)
  const [estimated, setEstimated] = useState(saved?.estimated ?? !challenge?.estimate)
  const [showReview, setShowReview] = useState(false)
  /** Пока смотрим эталон, своё решение лежит здесь */
  const [mine, setMine] = useState<{ nodes: BNode[]; edges: BEdge[] } | null>(null)
  const viewingRef = mine !== null
  // пока смотрим эталон, в черновике — своё решение
  const work = useMemo(() => ({ nodes: mine?.nodes ?? nodes, edges: mine?.edges ?? edges, estimated }), [mine, nodes, edges, estimated])
  useSaveDraft(draftKey, draftSig, work)
  const result = useMemo(() => simulate(nodes, edges), [nodes, edges])
  const traffic = useLiveTraffic(nodes, edges, result, estimated)

  const goals = challenge
    ? [
        ...challenge.paths.map((p) => ({ text: p.text, ok: reaches(edges, p.from, p.to) })),
        ...challenge.goals.map((g) => ({ text: g.text, ok: g.check(result) })),
        { text: tr(`Стоимость ≤ $${challenge.budget}`, `Cost ≤ $${challenge.budget}`, `成本 ≤ $${challenge.budget}`), ok: result.cost <= challenge.budget },
        ...(challenge.estimate ? [{ text: tr('Прикидка нагрузки сделана', 'Back-of-the-envelope estimate done', '已完成负载估算'), ok: estimated }] : []),
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
  // «понятно» на сообщение о круге на схеме — до следующей правки связей
  const [cycleSeen, setCycleSeen] = useState(false)
  useEffect(() => setCycleSeen(false), [edges])
  // сообщение держится столько, сколько нужно, чтобы его прочитать (длинное объяснение — дольше), новое сменяет старое
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const say = (msg: string) => {
    setFlash(msg)
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), Math.min(9000, Math.max(2500, msg.length * 55)))
  }

  /**
   * Добавить компонент. С координатами — туда, куда его бросили.
   * Без координат — в свободное место посреди видимой части схемы.
   */
  const add = (kind: NodeKind, at?: { x: number; y: number }) => {
    // перетащили — ставим туда, куда бросили; по клику — на свободное место в середине видимой части схемы
    // (с учётом масштаба, сдвига и прокрутки страницы), а не рядом с выделенным: с чем его связать, решает игрок
    const c = at ?? vp.visibleCenter()
    const want = {
      x: Math.max(0, Math.min(BOARD_W - NODE_W, c.x - NODE_W / 2)),
      y: Math.max(0, Math.min(BOARD_H - NODE_H, c.y - NODE_H / 2)),
    }
    // из меню — в пределах видимой части схемы (если там есть место), чтобы схема не уезжала к новому блоку
    const pos = freeSpot(nodes, want.x, want.y, at ? undefined : vp.visibleRect())
    const n: BNode = {
      id: nextId('n', nodes),
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
    // связи, которых не бывает, провести нельзя — с объяснением почему
    const problem = linkProblem(a.kind, b.kind)
    if (problem) return say(problem)
    if (edges.some((e) => e.from === from && e.to === to)) return say(tr('Такая связь уже есть', 'This connection already exists', '这条连接已经存在'))
    if (wouldCycle(nodes, edges, from, to)) {
      const label = (id: string) => nodes.find((x) => x.id === id)?.label ?? id
      const back = pathBetween(edges, to, from) ?? [to, from]
      return setCycleNote(
        tr(
          `Связь «${a.label} → ${b.label}» замкнула бы круг: ${[...back, to].map(label).join(' → ')}. ` +
            'Запрос бегал бы по нему бесконечно.',
          `The connection “${a.label} → ${b.label}” would close a loop: ${[...back, to].map(label).join(' → ')}. ` +
            'A request would circle it forever.',
          `连接“${a.label} → ${b.label}”会形成一个环：${[...back, to].map(label).join(' → ')}。` +
            '请求会在环里无休止地打转。',
        ),
      )
    }
    setCycleNote(null)
    setEdges([...edges, { id: nextId('e', edges), from, to }])
  }

  const remove = () => {
    if (selNode) {
      if (locked(selNode.id)) return say(tr('Этот компонент — часть исходной системы', 'This component is part of the original system', '该组件是原有系统的一部分'))
      setNodes(nodes.filter((n) => n.id !== selNode.id))
      setEdges(edges.filter((e) => e.from !== selNode.id && e.to !== selNode.id))
    } else if (selEdge) {
      setEdges(edges.filter((e) => e.id !== selEdge.id))
    }
    setSelected(null)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // клавиши из открытого меню (язык, масштаб) — не для схемы: стрелки не двигают блок, Delete не удаляет
      if (e.defaultPrevented || menuOpen()) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isTyping(e.target)) remove()
      // стрелки, как в Figma: сдвиг выбранного блока на шаг сетки, с Shift — на пять
      const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
      if (step && selNode && !isTyping(e.target) && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        const d = e.shiftKey ? 50 : 10
        patch(selNode.id, {
          x: Math.max(0, Math.min(BOARD_W - NODE_W, selNode.x + step[0] * d)),
          y: Math.max(0, Math.min(BOARD_H - NODE_H, selNode.y + step[1] * d)),
        })
      }
      if (e.key === 'Escape') {
        setSelected(null)
        setAddOpen(false)
        setPanelOpen(false)
        setTrafficOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const wrapRef = useRef<HTMLDivElement>(null)
  const [addOpen, setAddOpen] = useState(false)
  // телефон: рабочий экран, как в Figma — схема на весь экран, инструменты на плавающих панелях;
  // задача при входе открыта модальным окном
  const ws = usePhone()
  const [panelOpen, setPanelOpen] = useState(() => !!challenge)
  const [trafficOpen, setTrafficOpen] = useState(false)
  // масштаб и сдвиг — общие для всех редакторов схем; на телефоне при входе схема вписывается в экран
  const vp = useViewport({
    width: BOARD_W,
    height: BOARD_H,
    autoFit: ws,
    content: () => nodesBox(nodes, 30),
    selection: () => {
      const n = nodes.find((x) => x.id === selected)
      const e = edges.find((x) => x.id === selected)
      return nodesBox(n ? [n] : e ? nodes.filter((x) => x.id === e.from || x.id === e.to) : [], 60)
    },
  })
  /** Только что добавленный блок: холст покажет и подсветит его */
  const [revealId, setRevealId] = useState<string | null>(null)
  useEffect(() => {
    if (!revealId) return
    const t = setTimeout(() => setRevealId(null), 2500)
    return () => clearTimeout(t)
  }, [revealId])
  const [dragging, setDragging] = useState(false)
  const closePopover = useCallback(() => setSelected(null), [])
  const patch = (id: string, p: Partial<BNode>) => setNodes(nodes.map((n) => (n.id === id ? { ...n, ...p } : n)))

  const statsEl = (
    <div className="builder-stats">
      <Stat label={tr('нагрузка', 'load', '负载')} value={estimated ? `${fmt(result.totalRps)} rps` : '? rps'} />
      <Stat
        label={tr('успешных', 'success', '成功率')}
        value={`${(result.clientSuccess * 100).toFixed(2)}%`}
        tone={result.clientSuccess >= 0.995 ? 'ok' : result.clientSuccess >= 0.95 ? 'warn' : 'bad'}
      />
      <Stat
        label={tr('латентность', 'latency', '延迟')}
        value={tr(`${Math.round(result.clientLatency)} мс`, `${Math.round(result.clientLatency)} ms`, `${Math.round(result.clientLatency)} ms`)}
        tone={result.clientLatency <= 150 ? 'ok' : result.clientLatency <= 500 ? 'warn' : 'bad'}
      />
      <Stat
        label={tr('рост очереди', 'queue growth', '队列增长')}
        value={tr(`${fmt(result.backlogGrowth)}/с`, `${fmt(result.backlogGrowth)}/s`, `${fmt(result.backlogGrowth)}/s`)}
        tone={result.backlogGrowth < 1 ? 'ok' : 'bad'}
      />
      <CostStat nodes={nodes} total={result.cost} budget={challenge?.budget} />
    </div>
  )
  const title = challenge?.title ?? tr('Свободный режим', 'Sandbox', '自由模式')
  const headEl = <>
      {challenge && (
        <div className="scenario-head">
          <div className="panel lesson">
            <Rich paras={challenge.brief} />
            {challenge.source && <SourceNote dir={challenge.source.primer} />}
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
                💡 {tr('Подсказка', 'Hint', '提示')} ({Math.min(hints, challenge.hints.length)}/{challenge.hints.length})
              </button>
            )}
          </div>
          <div className={'panel goal' + (solved ? ' success' : '')}>
            <h4>{solved ? tr('✅ Решено!', '✅ Solved!', '✅ 已解决！') : tr('🎯 Цели', '🎯 Goals', '🎯 目标')}</h4>
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
    </>
  const refEl = viewingRef && <RefBanner compact={ws} onBack={toggleReference} />
  const actionsEl = <>
      <div className="row review-actions">
        {challenge &&
          (solved && !viewingRef ? (
            <ResultButton solved onClick={() => result$.setOpen(true)} />
          ) : (
            <button onClick={() => setShowReview(!showReview)}>
              📋 {showReview ? tr('Скрыть оценку', 'Hide assessment', '隐藏评估') : tr('Оценить решение', 'Assess solution', '评估方案')}
            </button>
          ))}
        {challenge && !viewingRef && <button onClick={toggleReference} title={referenceNote()}>👁 {tr('Показать эталон на схеме', 'Show reference on canvas', '在画布上显示参考答案')}</button>}
        {/* схема сохраняется между перезагрузками — начать с чистого листа можно только здесь */}
        {!viewingRef && (
          <button
            onClick={() => {
              setNodes(start.nodes)
              setEdges(start.edges)
              setSelected(null)
              setShowReview(false)
            }}
          >
            {tr('↺ Заново', '↺ Start over', '↺ 重新开始')}
          </button>
        )}
      </div>
    </>
  const reviewEl = <>
      {review && showReview && !(solved && !viewingRef) && (
        <ReviewPanel review={review} title={viewingRef ? tr('Оценка эталона', 'Reference assessment', '参考答案评估') : tr('Оценка вашего решения', 'Your solution assessment', '你的方案评估')} />
      )}
    </>
  const resultEl = <>
      {challenge && (
        <ResultModal open={result$.open} onClose={() => result$.setOpen(false)} progressKey={`builder/${challenge.id}`} stars={stars ?? 1}>
          {review && <ReviewPanel review={review} title={tr('Оценка вашего решения', 'Your solution assessment', '你的方案评估')} />}
          <div className="lesson">
            <h3>{tr('Разбор задачи', 'Debrief', '解析')}</h3>
            <Rich paras={challenge.debrief} />
          </div>
        </ResultModal>
      )}
    </>
  const addMenuEl = <>
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
                    <KindIcon kind={k} /> {KINDS[k].title}
                    <span className="small muted">{KINDS[k].cost ? `$${KINDS[k].cost}` : ''}</span>
                  </button>
                  <button
                    className="icon info-btn"
                    title={tr('Что это и когда применять', 'What it is and when to use it', '这是什么，何时使用')}
                    onClick={() => setRefId(k)}
                  >
                    ⓘ
                  </button>
                  </div>
                ))}
            </div>
          ))}
          <p className="small muted">
            {ws
              ? tr(
                  'Нажмите — компонент появится на схеме. Связь — тяните за кружок справа от блока.',
                  'Tap to place a component on the diagram. To connect, drag from the circle on the right of a block.',
                  '点一下即可把组件放到图上。要建立连接，从组件右侧的圆点拖出。',
                )
              : tr(
                  'Кликните — компонент появится посреди видимой части схемы, или перетащите его на нужное место. Связь — тяните за кружок справа от блока. Del — удалить выделенное.',
                  'Click to place a component in the middle of the visible part of the diagram, or drag it where you want. To connect, drag from the circle on the right of a block. Del deletes the selection.',
                  '点击即可把组件放到当前可见区域的中间，也可以把它拖到想要的位置。要建立连接，从组件右侧的圆点拖出。按 Del 删除选中的元素。',
                )}
          </p>
          <p className="small muted">
            {tr(
              'Числа условные: настоящий PostgreSQL на простых запросах держит в разы больше. Важны пропорции и то, что во что упирается.',
              'The numbers are stylized: a real PostgreSQL handles several times more on simple queries. What matters is the proportions and what limits what.',
              '数字是示意性的：真实的 PostgreSQL 处理简单查询的能力要高出好几倍。重要的是比例关系，以及谁会成为谁的瓶颈。',
            )}
          </p>
    </>
  const cycleEl = <>
          {(cycleNote || (result.cycle && !cycleSeen)) && (
            <div className="cycle-note">
              <button
                className="icon"
                onClick={() => {
                  setCycleNote(null)
                  setCycleSeen(true)
                }}
                title={tr('Понятно', 'Got it', '知道了')}
              >
                ✕
              </button>
              {cycleNote ? (
                <>
                  <b>{tr('🔁 Цикл: связь не добавлена.', '🔁 Loop: connection not added.', '🔁 出现环路：连接未添加。')}</b> {cycleNote}
                </>
              ) : (
                <>
                  <b>{tr('🔁 На схеме замкнутый круг связей.', '🔁 The diagram contains a closed loop of connections.', '🔁 图中存在一个闭合的连接环路。')}</b>{' '}
                  {tr('Удалите одну из связей круга.', 'Delete one of the connections in the loop.', '请删除环路中的一条连接。')}
                </>
              )}
              <div className="small">
                {tr(
                  <>
                    Стрелка — это направление <b>запроса</b>: кто кого вызывает. Ответ возвращается по той же стрелке
                    сам, обратную рисовать не нужно. Если вы хотели <b>cache-aside</b> (сервис сначала смотрит в Redis, а
                    при промахе идёт в БД и кладёт результат в кэш) — соедините <b>сервис → Redis</b> и{' '}
                    <b>сервис → БД</b>: в БД пойдут только промахи. Сам Redis в базу не ходит, поэтому связи Redis → БД
                    не бывает.
                  </>,
                  <>
                    An arrow is the direction of a <b>request</b>: who calls whom. The response travels back along the
                    same arrow, so there is no need to draw a reverse one. If you meant <b>cache-aside</b> (the service
                    checks Redis first and, on a miss, goes to the DB and puts the result into the cache), connect{' '}
                    <b>service → Redis</b> and <b>service → DB</b>: only misses will reach the DB. Redis itself never
                    calls the database, so there is no Redis → DB link.
                  </>,
                  <>
                    箭头表示<b>请求</b>的方向：谁调用谁。响应会沿着同一条箭头自动返回，不需要再画一条反向的箭头。如果你想要的是
                    <b>cache-aside</b>（服务先查 Redis，未命中时再去数据库，并把结果放入缓存），请连接 <b>服务 → Redis</b> 和
                    <b>服务 → 数据库</b>：只有未命中的请求才会到达数据库。Redis 本身不会访问数据库，所以不存在 Redis → 数据库 这样的连接。
                  </>,
                )}
              </div>
            </div>
          )}
    </>
  const canvasEl = <>
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
            vp={vp}
          />
    </>
  const popoverEl = <>
          {(selNode || selEdge) && !dragging && (
            <ElementDialog
              wrap={wrapRef.current}
              id={(selNode ?? selEdge)!.id}
              label={selNode ? selNode.label : tr('Связь', 'Connection', '连接')}
              keep=".bnode, .bedge, .access-row, .wf-name, .zoom-tool"
              onClose={closePopover}
              tone={selNode ? nodeStatus(selNode, result.nodes[selNode.id], !estimated).tone : edgeStatus(selEdge!, result, nodes, !estimated).tone}
            >
              {selEdge && (
                <>
                  <div className="card-head">
                    <b>
                      {tr('Связь', 'Connection', '连接')}: {nodes.find((n) => n.id === selEdge.from)?.label} → {nodes.find((n) => n.id === selEdge.to)?.label}
                    </b>
                    <button className="icon" onClick={() => setSelected(null)} title={tr('Закрыть (Esc)', 'Close (Esc)', '关闭（Esc）')}>
                      ✕
                    </button>
                  </div>
                  <StatusBadge {...edgeStatus(selEdge, result, nodes, !estimated)} />
                  <p className="small muted">{estimated ? `${fmt(result.edges[selEdge.id]?.rps ?? 0)} rps` : '? rps'}{result.edges[selEdge.id]?.async ? ' · async' : ''}</p>
                  <button onClick={remove}>{tr('Удалить связь', 'Delete connection', '删除连接')}</button>
                </>
              )}
              {selNode && (
                <>
                  <div className="card-head">
                    <b>
                      <KindIcon kind={selNode.kind} /> {selNode.label}
                    </b>
                    <button className="icon" onClick={() => setSelected(null)} title={tr('Закрыть (Esc)', 'Close (Esc)', '关闭（Esc）')}>
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
                      tunable={challenge?.tunable?.includes(selNode.id) ?? false}
                      patch={(p) => patch(selNode.id, p)}
                      remove={remove}
                    />
                  ))}
                  {estimated &&
                    (selNode.kind === 'client' ? (
                      <ClientLog client={selNode} nodes={nodes} edges={edges} log={traffic.log} />
                    ) : (
                      <NodeLog nodeId={selNode.id} log={traffic.log} />
                    ))}
                </>
              )}
            </ElementDialog>
          )}
    </>
  const trafficEl = <>
          {estimated ? (
            <TrafficPanel
              log={traffic.log}
              nodes={nodes}
              running={traffic.running}
              setRunning={traffic.setRunning}
              onPickNode={(id) => {
                setSelected(id)
                setTrafficOpen(false)
              }}
            />
          ) : (
            <p className="small muted traffic-locked">
              📡 {tr('Живой трафик включится после прикидки нагрузки.', 'Live traffic starts once the load estimate is done.', '完成负载估算后，实时流量才会开始。')}
            </p>
          )}
    </>
  const hintsEl = (compact: boolean) => (
    <HintDock
      hints={challenge?.hints ?? []}
      used={hints}
      take={hintState.take}
      live={live}
      liveLocked={estimated ? undefined : tr('Сначала сделайте прикидку нагрузки — до неё модель не покажет цифры.', 'Do the load estimate first; until then the model shows no numbers.', '请先完成负载估算：在此之前，模型不会显示任何数字。')}
      onPick={(id) => {
        setSelected(id)
        setAddOpen(false)
      }}
      compact={compact}
    />
  )
  const stage = (children: ReactNode) => (
    <div className={'canvas-stage' + vp.stage.className} onPointerEnter={vp.stage.onPointerEnter} onPointerLeave={vp.stage.onPointerLeave}>
      {children}
    </div>
  )

  // телефон: общий рабочий экран — схема на весь экран, задача модальным окном, компоненты и трафик шторками
  if (ws)
    return (
      <>
        <Workspace
          title={title}
          panelOpen={panelOpen}
          setPanelOpen={setPanelOpen}
          panel={
            <>
              {!challenge && (
                <p className="muted">{tr('Собирайте что угодно: компоненты — кнопкой внизу, задачи — на карте уровней.', 'Build anything: components are on the bottom button, challenges are on the level map.', '想搭什么就搭什么：组件在底部按钮里，任务在关卡地图上。')}</p>
              )}
              {headEl}
              {actionsEl}
              {reviewEl}
              {statsEl}
            </>
          }
          metrics={
            <>
              <span className={result.clientSuccess >= 0.995 ? 'ok-text' : result.clientSuccess >= 0.95 ? 'warn-text' : 'bad-text'}>
                ✓ {(result.clientSuccess * 100).toFixed(1)}%
              </span>
              <span>{tr(`${Math.round(result.clientLatency)} мс`, `${Math.round(result.clientLatency)} ms`, `${Math.round(result.clientLatency)} ms`)}</span>
              <span className={challenge && result.cost > challenge.budget ? 'bad-text' : ''}>
                ${result.cost}
                {challenge ? `/${challenge.budget}` : ''}
              </span>
              {challenge && (
                <span>
                  {goals.filter((g) => g.ok).length}/{goals.length} 🎯
                </span>
              )}
            </>
          }
          right={
            <>
              <ZoomMenu vp={vp} />
              {hintsEl(true)}
              {challenge && solved && !viewingRef && (
                <button className="primary ws-btn" onClick={() => result$.setOpen(true)} title={tr('Результат', 'Result', '结果')} aria-label={tr('Результат', 'Result', '结果')}>
                  ★
                </button>
              )}
            </>
          }
          bottom={
            <>
              <Tool icon="＋" label={tr('Компонент', 'Component', '组件')} on={addOpen} onClick={() => setAddOpen(!addOpen)} />
              <Tool icon="📡" label={tr('Трафик', 'Traffic', '流量')} on={trafficOpen} onClick={() => setTrafficOpen(!trafficOpen)} />
            </>
          }
        >
          <div ref={wrapRef} className="ws-canvas">
            {stage(canvasEl)}
          </div>
          {refEl}
          {flash && <div className="ws-toast">{flash}</div>}
          {cycleEl}
        </Workspace>
        {addOpen && (
          <Sheet title={tr('Компоненты', 'Components', '组件')} onClose={() => setAddOpen(false)}>
            <div className="palette">{addMenuEl}</div>
          </Sheet>
        )}
        {trafficOpen && (
          <Sheet title={'📡 ' + tr('Живой трафик', 'Live traffic', '实时流量')} onClose={() => setTrafficOpen(false)}>
            {trafficEl}
          </Sheet>
        )}
        {popoverEl}
        {resultEl}
        {refId && <RefModal id={refId} kind="component" onClose={() => setRefId(null)} />}
      </>
    )

  // компьютер: условие и цели сверху, над схемой — цифры; «＋ Добавить компонент», масштаб и подсказки — панелью на самом холсте
  return (
    <div className="builder">
      {headEl}
      {refEl}
      {actionsEl}
      {reviewEl}
      {resultEl}
      {refId && <RefModal id={refId} kind="component" onClose={() => setRefId(null)} />}
      <div className="panel canvas-wrap builder-wrap" ref={wrapRef} style={{ ['--board-ratio' as string]: `${BOARD_W} / ${BOARD_H}` }}>
        {statsEl}
        {cycleEl}
        {stage(
          <>
            <EditorBar
              vp={vp}
              add={{
                label: tr('Добавить компонент', 'Add a component', '添加组件'),
                caption: tr('кэш, очередь, база, CDN…', 'cache, queue, database, CDN…', '缓存、队列、数据库、CDN…'),
                open: addOpen,
                setOpen: setAddOpen,
                menu: addMenuEl,
              }}
              right={hintsEl(false)}
              note={flash}
            />
            {canvasEl}
          </>,
        )}
        {popoverEl}
        {trafficEl}
      </div>
    </div>
  )
}

/** Общая стоимость, а в задаче — потрачено из бюджета; при наведении разбивка по компонентам */
function CostStat({ nodes, total, budget }: { nodes: BNode[]; total: number; budget?: number }) {
  const lines = nodes
    .filter((n) => KINDS[n.kind].cost > 0)
    .map((n) => ({ text: `${n.label} ${scaleText(n)}`, cost: nodeCost(n) }))
    .sort((a, b) => b.cost - a.cost)
  const breakdown = lines.length ? lines.map((l) => `${l.text}: $${l.cost}`).join('\n') : tr('Пока ничего не стоит', 'Nothing costs anything yet', '目前还没有任何花费')
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
            ? tr(`перерасход $${total - budget} в месяц`, `over budget by $${total - budget}/month`, `每月超支 $${total - budget}`)
            : tr(`стоимость / бюджет · запас $${budget - total}`, `cost / budget · $${budget - total} left`, `成本 / 预算 · 剩余 $${budget - total}`)
          : tr('стоимость в месяц', 'cost per month', '每月成本')}
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
  tunable,
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
  /** Заблокированный сервис, у которого профиль менять можно */
  tunable: boolean
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
        {tr('название', 'name', '名称')}
        <input type="text" value={node.label} onChange={(e) => patch({ label: e.target.value })} />
      </label>
      <p className="small muted">{spec.desc}</p>
      {node.kind === 'client' ? (
        locked ? (
          <>
            <p>
              {tr('Нагрузка', 'Load', '负载')}: {hideLoad ? tr('сначала сделайте прикидку', 'make the estimate first', '请先完成估算') : `${node.rps} rps`}
            </p>
            <p className="small">{tr('Профиль', 'Workload', '负载类型')}: {WORKLOADS[node.workload ?? 'oltp'].title}</p>
          </>
        ) : (
          <>
            <label>
              {tr('профиль нагрузки', 'workload', '负载类型')}
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
            {tr('нагрузка', 'load', '负载')}: {node.rps} rps
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
      {node.kind === 'service' && (!locked || tunable) && (
        <label>
          {tr('профиль', 'profile', '服务类型')}
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
      {node.kind === 'service' && locked && !tunable && (
        <p className="small">
          {tr(`${node.capacity} rps на экземпляр, ${node.latency} мс`, `${node.capacity} rps per instance, ${node.latency} ms`, `每个实例 ${node.capacity} rps，${node.latency} ms`)}
        </p>
      )}
      {(node.kind === 'cache' || node.kind === 'cdn') &&
        (fixedHit ? (
          <p className="small">
            {tr(
              `Доля попаданий ${Math.round((node.hitRatio ?? 0) * 100)}% — определяется данными задачи`,
              `Hit ratio ${Math.round((node.hitRatio ?? 0) * 100)}%, set by the task`,
              `命中率 ${Math.round((node.hitRatio ?? 0) * 100)}%，由任务数据决定`,
            )}
          </p>
        ) : (
          <label>
            {tr('доля попаданий', 'hit ratio', '命中率')}: {Math.round((node.hitRatio ?? 0.8) * 100)}%
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
      {!locked && <button onClick={remove}>{tr('Удалить блок', 'Delete block', '删除组件')}</button>}
      </>
      )}
      {tab === 'load' && KINDS[node.kind].fit && (
        <table className="cmp small fit-table">
          {/* подсказки заданий ссылаются на эту таблицу по названию */}
          <caption>{tr('Подходит для', 'Good for', '适合的负载')}</caption>
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
                  <td>{f === 0 ? tr('не умеет', 'unsupported', '不支持') : f >= 1 ? tr('родной', 'native', '原生') : `×${f}`}</td>
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
              <td>{tr('вход', 'input', '输入')}</td>
              <td>{hideLoad ? '?' : `${fmt(stats.in)} rps`}</td>
            </tr>
            {!hideLoad && stats.writes > 0 && (
              <tr>
                <td>{tr('из них запись', 'of which writes', '其中写入')}</td>
                <td>{fmt(stats.writes)} rps</td>
              </tr>
            )}
            {stats.unsupported > 0 && (
              <tr className="bad-text">
                <td>{tr('не умеет', 'unsupported', '不支持')}</td>
                <td>{tr(`${Math.round(stats.unsupported * 100)}% запросов`, `${Math.round(stats.unsupported * 100)}% of requests`, `${Math.round(stats.unsupported * 100)}% 的请求`)}</td>
              </tr>
            )}
            <tr>
              <td>{tr('ёмкость', 'capacity', '容量')}</td>
              <td>{fmt(stats.capacity)} rps</td>
            </tr>
            <tr>
              <td>{tr('загрузка', 'utilization', '利用率')}</td>
              <td>{Math.round(stats.util * 100)}%</td>
            </tr>
            <tr>
              <td>{tr('успешно', 'success', '成功率')}</td>
              <td>{(stats.success * 100).toFixed(1)}%</td>
            </tr>
            <tr>
              <td>{tr('латентность', 'latency', '延迟')}</td>
              <td>{tr(`${Math.round(stats.latency)} мс`, `${Math.round(stats.latency)} ms`, `${Math.round(stats.latency)} ms`)}</td>
            </tr>
            <tr>
              <td>{tr('стоимость', 'cost', '成本')}</td>
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
        <b>{tr('📐 Прикидка:', '📐 Estimate:', '📐 估算：')}</b> {estimate.formula}
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
      <b>{tr('📐 Сначала прикидка (back-of-the-envelope):', '📐 First, a back-of-the-envelope estimate:', '📐 先做个粗略估算（back-of-the-envelope）：')}</b> {estimate.question}
      <div className="row" style={{ marginTop: 6 }}>
        <input
          type="text"
          inputMode="numeric"
          placeholder={tr('ваша оценка', 'your estimate', '你的估算')}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setWrong(false)
          }}
          onKeyDown={(e) => e.key === 'Enter' && check()}
        />
        <span className="small muted">{estimate.unit}</span>
        <button className="primary" onClick={check}>
          {tr('Проверить', 'Check', '检查')}
        </button>
        {tries >= 2 && <button onClick={onDone}>{tr('Показать расчёт', 'Show calculation', '显示计算过程')}</button>}
      </div>
      {wrong && (
        <div className="small warn-text">
          {tr(
            'Не попали в ±25%. В сутках 86 400 секунд, а пик выше среднего — проверьте множители.',
            'Not within ±25%. A day has 86,400 seconds, and the peak is above average: check your multipliers.',
            '误差超出了 ±25%。一天有 86,400 秒，而且峰值高于平均值：检查一下你的乘数。',
          )}
        </div>
      )}
    </div>
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
  if (hidden) return { tone: 'idle', label: tr('Нагрузка скрыта', 'Load hidden', '负载已隐藏'), detail: tr('Сначала сделайте прикидку нагрузки', 'Make the load estimate first', '请先完成负载估算') }
  if (!st) return { tone: 'idle', label: tr('Нет данных', 'No data', '无数据'), detail: '' }
  if (n.kind === 'client') {
    const mood = clientMood(st.success, st.latency)
    const tone: Tone = mood === 'happy' ? 'ok' : mood === 'meh' ? 'warn' : 'bad'
    const label =
      mood === 'happy'
        ? tr('Пользователи довольны', 'Users are happy', '用户很满意')
        : mood === 'meh'
          ? tr('Пользователи недовольны', 'Users are unhappy', '用户不太满意')
          : tr('Пользователи злятся', 'Users are angry', '用户很生气')
    const why =
      st.success < 0.95
        ? tr('много ошибок', 'many errors', '错误很多')
        : st.success < 0.995
          ? tr('часть запросов падает', 'some requests fail', '部分请求失败')
          : st.latency > 300
            ? tr('ответы медленные', 'responses are slow', '响应很慢')
            : tr('всё быстро и без ошибок', 'fast and error-free', '又快又没有错误')
    return {
      tone,
      face: MOOD_FACE[mood],
      label,
      detail: tr(`${why}: успешных ${(st.success * 100).toFixed(1)}%, ответ за ${Math.round(st.latency)} мс`, `${why}: ${(st.success * 100).toFixed(1)}% successful, ${Math.round(st.latency)} ms response`, `${why}：成功率 ${(st.success * 100).toFixed(1)}%，响应时间 ${Math.round(st.latency)} ms`),
    }
  }
  if (st.deadEnd) return { tone: 'bad', label: tr('Тупик', 'Dead end', '死路'), detail: tr('Запросам некуда идти дальше — подключите следующий блок', 'Requests have nowhere to go next; connect the next block', '请求无处可去：请连接下一个组件') }
  if (st.unsupported > 0)
    return { tone: 'bad', label: tr('Не подходит для запросов', 'Unsuitable for these requests', '不适合处理这些请求'), detail: tr(`не умеет обрабатывать ${pctOf(st.unsupported)} запросов`, `cannot handle ${pctOf(st.unsupported)} of requests`, `有 ${pctOf(st.unsupported)} 的请求无法处理`) }
  if (st.in <= 0) return { tone: 'idle', label: tr('Простаивает', 'Idle', '空闲'), detail: tr('Сюда не приходят запросы', 'No requests reach this block', '没有请求到达这个组件') }
  if (st.util >= 1 || st.success < 0.99)
    return {
      tone: 'bad',
      label: tr('Перегружен', 'Overloaded', '过载'),
      detail: tr(`загрузка ${pctOf(st.util)}, отказывает ${pctOf(1 - st.success)} запросов`, `${pctOf(st.util)} utilization, rejects ${pctOf(1 - st.success)} of requests`, `利用率 ${pctOf(st.util)}，拒绝了 ${pctOf(1 - st.success)} 的请求`),
    }
  if (st.util >= 0.8) return { tone: 'warn', label: tr('На пределе', 'Near the limit', '接近极限'), detail: tr(`загрузка ${pctOf(st.util)} — задержки растут, запаса почти нет`, `${pctOf(st.util)} utilization: latency grows, little headroom left`, `利用率 ${pctOf(st.util)}：延迟在上升，几乎没有余量了`) }
  return { tone: 'ok', label: tr('В норме', 'Healthy', '正常'), detail: tr(`загрузка ${pctOf(st.util)}, ответ за ${Math.round(st.latency)} мс`, `${pctOf(st.util)} utilization, ${Math.round(st.latency)} ms response`, `利用率 ${pctOf(st.util)}，响应时间 ${Math.round(st.latency)} ms`) }
}

/** Связь: асинхронная — жёлтая, в проблемный блок — красная, иначе зелёная */
function edgeStatus(e: BEdge, r: ReturnType<typeof simulate>, nodes: BNode[], hidden: boolean): Status {
  if (hidden) return { tone: 'idle', label: tr('Нагрузка скрыта', 'Load hidden', '负载已隐藏'), detail: '' }
  const st = r.edges[e.id]
  const target = r.nodes[e.to]
  const to = nodes.find((n) => n.id === e.to)
  if (!st || st.rps <= 0) return { tone: 'idle', label: tr('Без трафика', 'No traffic', '无流量'), detail: tr('По этой связи сейчас ничего не идёт', 'Nothing flows along this connection now', '这条连接上目前没有任何流量') }
  if (target && (target.success < 0.99 || target.deadEnd))
    return { tone: 'bad', label: tr('Ведёт в проблемный блок', 'Leads to a failing block', '指向出问题的组件'), detail: tr(`«${to?.label}» отвечает успешно только на ${(target.success * 100).toFixed(1)}%`, `“${to?.label}” succeeds only ${(target.success * 100).toFixed(1)}% of the time`, `“${to?.label}”的成功率只有 ${(target.success * 100).toFixed(1)}%`) }
  if (st.async) return { tone: 'warn', label: tr('Асинхронно', 'Asynchronous', '异步'), detail: tr('Сообщения ждут в очереди, ответ клиенту не задерживается', 'Messages wait in the queue; the client response is not delayed', '消息在队列中等待，客户端的响应不会因此变慢') }
  return { tone: 'ok', label: tr('В норме', 'Healthy', '正常'), detail: `${fmt(st.rps)} rps` }
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
      ? tr('подключений к провайдеру', 'connections to the provider', '到提供方的连接数')
      : tr('экземпляров (горизонтально)', 'instances (horizontal)', '实例数（水平扩展）'),
    replicas: tr('узлов в шарде: primary + реплики для чтения', 'nodes per shard: primary + read replicas', '每个分片的节点数：primary + 只读副本'),
    nodes: tr('узлов (данные и запись делятся между ними)', 'nodes (data and writes are split across them)', '节点数（数据和写入分摊到各节点）'),
    brokers: tr('брокеров', 'brokers', 'Broker 数'),
    partitions: tr('партиций (префиксов ключей)', 'partitions (key prefixes)', '分区数（key 前缀）'),
  }
  const unitHint: Record<typeof spec.unit, string> = {
    instances: external
      ? tr('Внешний API ограничен лимитом провайдера и числом подключений, а не процессором', 'An external API is limited by the provider’s rate limit and connections, not by CPU', '外部 API 受限于提供方的调用频率上限和连接数，而不是 CPU')
      : tr('Одинаковые экземпляры делят нагрузку поровну', 'Identical instances share the load evenly', '相同的实例平均分担负载'),
    replicas: tr('Реплики масштабируют только чтение: вся запись идёт в primary', 'Replicas scale reads only: all writes go to the primary', '副本只能扩展读取：所有写入都进入 primary'),
    nodes: tr('Масштабируется и чтение, и запись', 'Scales both reads and writes', '读取和写入都能扩展'),
    brokers: tr('Больше брокеров — больше пропускная способность и партиций', 'More brokers means more throughput and partitions', 'Broker 越多，吞吐量越大，能容纳的分区也越多'),
    partitions: tr('Объектное хранилище масштабируется по префиксам ключей', 'Object storage scales by key prefix', '对象存储按 key 前缀扩展'),
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
          {tr('размер машины (вертикально)', 'machine size (vertical)', '机器规格（垂直扩展）')}
          <select value={size} onChange={(e) => patch({ size: +e.target.value })}>
            {SIZES.map((x) => (
              <option key={x} value={x}>
                {x === 1 ? tr('обычная', 'standard', '标准') : x === SIZES[SIZES.length - 1] ? tr(`×${x} — самая большая`, `×${x}: the largest`, `×${x}：最大规格`) : `×${x}`}
              </option>
            ))}
          </select>
        </label>
      )}
      {spec.maxShards && (
        <>
          <label>
            {tr('шардов', 'shards', '分片数')}: <span className="range-num">{shards}</span>
            <input type="range" min={1} max={spec.maxShards} value={shards} onChange={(e) => patch({ shards: +e.target.value })} />
          </label>
          <div className="small muted">
            {tr(
              'Шарды делят данные и запись. Цена — транзакции и JOIN между шардами: OLTP медленнее, аналитика заметно медленнее.',
              'Shards split data and writes. The price is transactions and JOINs across shards: OLTP gets slower, analytics much slower.',
              '分片会拆分数据和写入。代价是跨分片的事务和 JOIN：OLTP 变慢，分析查询会慢得多。',
            )}
          </div>
        </>
      )}
      {isStorage(node.kind) && (
        <div className="small scaling-cap">
          {tr('ёмкость', 'capacity', '容量')}: {tr('чтение', 'reads', '读取')} {fmt(baseCapacity(node))} rps · {tr('запись', 'writes', '写入')} {fmt(writeCapacity(node))} rps
        </div>
      )}
    </div>
  )
}

