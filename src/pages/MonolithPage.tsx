import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MODE_LABEL,
  MODE_COST,
  allowedModes,
  computeMetrics,
  defaultMode,
  effortOf,
  evaluate,
  solutionState,
  stateCost,
  crosses,
  dbOf,
  initialState,
  modeOf,
  plannedMode,
  type Dep,
  type DepMode,
  type Metrics,
  type Mission,
  type ModuleId,
  type Project,
  type State,
} from '../sim/monolith/model'
import { PROJECTS } from '../sim/monolith/projects'
import { reviewMission } from '../sim/monolith/review'
import { recommendedOrder, replay, reviewOrder, type SprintMark } from '../sim/monolith/order'
import { ReviewPanel } from '../components/ReviewPanel'
import { RefModal } from '../components/RefCard'
import { PATTERNS, PATTERN_GROUPS, has, type PatternId } from '../sim/monolith/patterns'
import { markScenario, recordStars, useProgress, cappedStars, useHints, referenceNote } from '../progress'
import { TaskGate, TaskLevelTag } from '../components/Level'
import { href } from '../router'
import { DddStage } from '../components/DddStage'
import { menuOpen, modalAbove, sideColumn, usePhone, usePopoverReflow } from '../components/popover'
import { Scrim, Sheet, Tool, Workspace } from '../components/Workspace'
import { useViewport, type Viewport } from '../components/editor/useViewport'
import { ZoomMenu } from '../components/editor/ZoomMenu'
import { EditorBar } from '../components/editor/EditorBar'
import { PopoverDialog } from '../components/PopoverDialog'
import { ResultButton, ResultModal, useResultModal } from '../components/ResultModal'
import { DDD_STAGES } from '../sim/ddd/tasks'
import { tr } from '../i18n'
import { CLIENT, GATEWAY, KAFKA, MONO_DB, emulateMono } from '../sim/monolith/emulate'
import { NodeLog, TrafficPanel } from '../sim/builder/TrafficPanel'
import { HOP_MS, type LiveTrace } from '../sim/builder/BuilderCanvas'
import type { SpanStatus, Trace } from '../sim/builder/emulate'

const W = 1200
const BOX_W = 180
const BOX_H = 56

/** Раскладка холста зависит от числа модулей */
function layout(n: number) {
  const rows = Math.ceil(n / 2)
  const dbY = 165 + rows * 100 + 5
  const MONO = { x: 30, y: 130, w: 470, h: dbY + 54 + 20 - 130 }
  const H = MONO.y + MONO.h + 40
  const step = (H - 200) / rows
  return {
    H,
    MONO,
    MONO_DB: { x: 175, y: dbY, w: 180, h: 54 },
    inside: (i: number) => ({ x: 60 + (i % 2) * 230, y: 165 + Math.floor(i / 2) * 100 }),
    outside: (i: number) => ({ x: 590 + (i % 2) * 300, y: 130 + Math.floor(i / 2) * step }),
  }
}

interface LogEntry {
  sprint: number
  action: string
  cost: number
  notes: string[]
  tone: 'ok' | 'warn' | 'bad'
}

const stepsOf = (p: Project) => [...(DDD_STAGES[p.id] ?? []).map((t) => t.id), ...p.missions.map((m) => m.id)]
const stepKey = (p: Project, step: string) => `monolith/${p.id}/${step}`

export default function MonolithPage({ projectId, stepId }: { projectId?: string; stepId?: string }) {
  const progress = useProgress()
  // без адреса — первая нерешённая задача; выбирается один раз, чтобы после решения страница не перескакивала
  const [entry] = useState(() => {
    for (const p of PROJECTS) {
      const s = stepsOf(p).find((x) => !progress.scenarios[stepKey(p, x)])
      if (s) return { project: p.id, step: s }
    }
    return { project: PROJECTS[0].id, step: stepsOf(PROJECTS[0])[0] }
  })
  const project = PROJECTS.find((p) => p.id === projectId) ?? PROJECTS.find((p) => p.id === entry.project)!
  const steps = stepsOf(project)
  const step = stepId && steps.includes(stepId) ? stepId : project.id === entry.project ? entry.step : steps[0]
  const stage = (DDD_STAGES[project.id] ?? []).find((t) => t.id === step)
  const mission = project.missions.find((m) => m.id === step) ?? project.missions[0]
  const nextStep = steps[steps.indexOf(step) + 1]
  const title = stage ? stage.title : mission.title
  return (
    <div className="page">
      <div className="crumbs">
        <a href="#/">{tr('Карта', 'Map', '地图')}</a> / {tr('Распил монолита', 'Breaking up the monolith', '拆分单体')} / {project.title}
      </div>
      <h1>
        🪓 {project.title}
        {tr(': ', ': ', '：')}
        {title} <TaskLevelTag taskKey={stepKey(project, step)} full />
      </h1>
      {stage ? (
        <TaskGate taskKey={stepKey(project, stage.id)}>
          <DddStage
            key={project.id + stage.id}
            task={stage}
            progressKey={stepKey(project, stage.id)}
            onNext={nextStep ? () => (window.location.hash = href('monolith', project.id, nextStep)) : undefined}
            nextLabel={
              (DDD_STAGES[project.id] ?? []).some((t) => t.id === nextStep)
                ? tr('Дальше: карта контекстов', 'Next: context map', '下一步：上下文映射图')
                : tr('Дальше: распил', 'Next: the split', '下一步：拆分')
            }
          />
        </TaskGate>
      ) : (
        <TaskGate taskKey={stepKey(project, mission.id)}>
          <MissionView key={project.id + mission.id} project={project} mission={mission} />
        </TaskGate>
      )}
    </div>
  )
}

interface Snapshot {
  state: State
  spent: number
}

function MissionView({ project, mission }: { project: Project; mission: Mission }) {
  const [state, setState] = useState<State>(() => initialState(project))
  const [spent, setSpent] = useState(0)
  const [history, setHistory] = useState<Snapshot[]>([])
  const [log, setLog] = useState<LogEntry[]>([])
  const [selected, setSelected] = useState<ModuleId | null>(null)
  const metrics = useMemo(() => evaluate(project, state, spent, mission.budget), [project, state, spent, mission.budget])
  const traffic = useMonoTraffic(project, state, metrics)
  const goals = [
    ...mission.goals.map((g) => ({ text: g.text, ok: g.check(metrics) })),
    { text: tr(`Уложиться в бюджет ${mission.budget} млн ₽`, `Stay within the ${mission.budget} M ₽ budget`, `不超出 ${mission.budget} M ₽ 的预算`), ok: spent <= mission.budget },
  ]
  const t = project.targets
  const solved = goals.every((g) => g.ok)

  const [showReview, setShowReview] = useState(false)
  /** Пока смотрим эталон, своё решение лежит здесь */
  const [mine, setMine] = useState<{ state: State; spent: number; history: Snapshot[]; log: LogEntry[] } | null>(null)
  const viewingRef = mine !== null

  useEffect(() => {
    if (solved && !viewingRef) markScenario(`monolith/${project.id}/${mission.id}`)
  }, [solved, viewingRef, project.id, mission.id])

  const review = showReview || solved ? reviewMission(project, mission, state, spent) : null
  const hintState = useHints(`monolith/${project.id}/${mission.id}`)
  const stars = solved && !viewingRef && review ? cappedStars(review.stars, hintState.used) : undefined
  const result$ = useResultModal(solved, !viewingRef)
  useEffect(() => {
    if (stars) recordStars(`monolith/${project.id}/${mission.id}`, stars)
  }, [stars, project.id, mission.id])
  const recommended = useMemo(() => recommendedOrder(project, mission), [project, mission])
  // порядок: при просмотре эталона — рекомендуемый, иначе — ваша история спринтов
  const order =
    showReview || solved
      ? viewingRef
        ? reviewOrder(project, replay(project, recommended), recommended.map((x) => x.label))
        : reviewOrder(
            project,
            [...history.map((h) => h.state), state],
            [...log].reverse().map((e) => e.action),
          )
      : null

  const toggleReference = () => {
    if (mine) {
      setState(mine.state)
      setSpent(mine.spent)
      setHistory(mine.history)
      setLog(mine.log)
      setMine(null)
    } else {
      setMine({ state, spent, history, log })
      hintState.reveal()
      const ref = solutionState(project, mission.solution)
      setState(ref)
      setSpent(stateCost(project, ref))
      setHistory([])
      setLog([])
    }
  }

  /** Каждое изменение стоит денег; откат решения деньги не возвращает (кроме «Отменить») */
  const apply = (next: State, action: string) => {
    const before = metrics
    const after = computeMetrics(project, next)
    const cost = Math.max(0, stateCost(project, next) - stateCost(project, state))
    setHistory([...history, { state, spent }])
    setState(next)
    setSpent(spent + cost)
    setLog([{ sprint: history.length + 1, action, cost, ...diff(project, before, after) }, ...log])
  }

  const undo = () => {
    const prev = history[history.length - 1]
    if (!prev) return
    setHistory(history.slice(0, -1))
    setState(prev.state)
    setSpent(prev.spent)
    setLog(log.slice(1))
  }

  const reset = () => {
    setState(initialState(project))
    setSpent(0)
    setHistory([])
    setLog([])
  }

  const mod = project.modules.find((m) => m.id === selected)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [popover, setPopover] = useState<{ id: string; x: number; y: number } | null>(null)
  const phone = usePhone()
  // условие при входе — модальным окном (на телефоне); паттерны, проблемы и трафик — шторками
  const [panelOpen, setPanelOpen] = useState(true)
  const [sheet, setSheet] = useState<'patterns' | 'problems' | 'traffic' | null>(null)
  // масштаб и сдвиг — общие для всех редакторов; на телефоне при входе схема вписывается в экран
  const vp = useViewport({ width: W, height: layout(project.modules.length).H, autoFit: phone })
  const openDep = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    // на телефоне окно связи — шторка, место на холсте ему не нужно (и холста-обёртки там нет)
    const r = wrapRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 }
    setPopover({ id, x: e.clientX - r.left, y: e.clientY - r.top })
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc при открытом меню масштаба закрывает только меню (оно помечает событие обработанным)
      // Esc закрывает верхний слой: окно поверх (карточка справочника), потом меню, и только потом окно модуля
      if (e.key !== 'Escape' || e.defaultPrevented || menuOpen() || modalAbove()) return
      setPopover(null)
      setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const headEl = <>
      <div className="scenario-head">
        <div className="panel lesson">
          {project.intro.map((para) => (
            <p key={para} className="muted">
              {para}
            </p>
          ))}
          <h3>🎯 {mission.title}</h3>
          {mission.brief.map((para) => (
            <p key={para}>{para}</p>
          ))}
          <p className="small muted">
            {tr(
              'Каждое действие — это спринт и стоит денег: вынос модуля, миграция данных, внедрение паттерна, переделка связи. Передумали — деньги уже потрачены; «Отменить» откатывает шаг целиком. Наведите курсор на связь, чтобы узнать, откуда она взялась.',
              'Every action is a sprint and costs money: extracting a module, migrating data, introducing a pattern, reworking a link. Change your mind and the money is already spent; “Undo” rolls back a whole step. Hover over a link to see where it comes from.',
              '每个动作都是一个冲刺（sprint），都要花钱：拆出模块、迁移数据、引入模式、改造连接。改了主意，钱也已经花出去了；“撤销”会把整步回滚。把鼠标悬停在连接上，就能看到它从何而来。',
            )}
          </p>
          <details className="solution">
            <summary>{tr('Показать эталонное решение', 'Show reference solution', '查看参考答案')}</summary>
            <ol className="small">
              {mission.solutionSteps.map((st) => (
                <li key={st}>{st}</li>
              ))}
            </ol>
            <details className="solution">
              <summary>
                {tr('Рекомендуемый порядок по спринтам', 'Recommended sprint order', '推荐的冲刺顺序')} ({recommended.length})
              </summary>
              <ol className="small">
                {recommended.map((st) => (
                  <li key={st.label}>{st.label}</li>
                ))}
              </ol>
            </details>
          </details>
        </div>
        <div className={'panel goal' + (solved ? ' success' : '')}>
          <h4>{solved ? tr('✅ Миссия выполнена!', '✅ Mission complete!', '✅ 任务完成！') : tr('🎯 Цели', '🎯 Goals', '🎯 目标')}</h4>
          <ul className="goal-list">
            {goals.map((g) => (
              <li key={g.text} className={g.ok ? 'ok-text' : ''}>
                {g.ok ? '✓' : '○'} {g.text}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  const refEl = <>
      {viewingRef && (
        <div className="ref-banner">
          {tr(
            <>
              👁 Вы смотрите <b>эталонное решение</b> — в зачёт оно не идёт.
            </>,
            <>
              👁 You are viewing the <b>reference solution</b> — it does not count toward your progress.
            </>,
            <>
              👁 你正在查看<b>参考答案</b>——它不计入你的进度。
            </>,
          )}
          <button className="primary" onClick={toggleReference}>
            ↩ {tr('Вернуть моё решение', 'Back to my solution', '回到我的方案')}
          </button>
        </div>
      )}
    </>
  const actionsEl = <>
      <div className="row review-actions">
        {solved && !viewingRef ? (
          <ResultButton solved onClick={() => result$.setOpen(true)} />
        ) : (
          <button onClick={() => setShowReview(!showReview)}>
            📋 {showReview ? tr('Скрыть оценку', 'Hide assessment', '隐藏评估') : tr('Оценить решение', 'Assess solution', '评估方案')}
          </button>
        )}
        {!viewingRef && <button onClick={toggleReference} title={referenceNote()}>👁 {tr('Показать эталон на схеме', 'Show reference on canvas', '在图上查看参考答案')}</button>}
      </div>
    </>
  const resultEl = <>
      <ResultModal
        open={result$.open}
        onClose={() => result$.setOpen(false)}
        progressKey={`monolith/${project.id}/${mission.id}`}
        stars={stars ?? 1}
        title={tr('Миссия выполнена!', 'Mission complete!', '任务完成！')}
      >
        {review && order && (
          <div className="review-pair">
            <ReviewPanel review={review} title={tr('Итоговая архитектура', 'Final architecture', '最终架构')} />
            <ReviewPanel review={order.review} title={tr('Порядок распила', 'Decomposition order', '拆分顺序')}>
              <Timeline marks={order.timeline} />
            </ReviewPanel>
          </div>
        )}
        <div className="lesson">
          <h3>{tr('Разбор', 'Debrief', '解析')}</h3>
          {mission.debrief.map((para) => (
            <p key={para}>{para}</p>
          ))}
        </div>
      </ResultModal>
    </>
  const reviewEl = <>
      {review && order && showReview && !(solved && !viewingRef) && (
        <div className="review-pair">
          <ReviewPanel review={review} title={viewingRef ? tr('Итог эталона', 'Reference solution result', '参考答案的结果') : tr('Итоговая архитектура', 'Final architecture', '最终架构')} />
          <ReviewPanel review={order.review} title={viewingRef ? tr('Рекомендуемый порядок', 'Recommended order', '推荐顺序') : tr('Порядок распила', 'Decomposition order', '拆分顺序')}>
            <Timeline marks={order.timeline} />
          </ReviewPanel>
        </div>
      )}
    </>
  const metricsEl = <>
      <div className="mono-metrics">
        <div className={'metric budget ' + (spent > mission.budget ? 'bad' : spent > mission.budget * 0.8 ? 'warn' : 'ok')}>
          <div className="metric-value">
            {spent} / {mission.budget}
          </div>
          <div className="metric-label">{tr('потрачено, млн ₽', 'spent, M ₽', '已花费，M ₽')}</div>
          <div className="progressbar">
            <div style={{ width: `${Math.min(100, (spent / mission.budget) * 100)}%` }} />
          </div>
        </div>
        <Metric label={tr('независимых релизов', 'independent releases', '独立发布')} value={`${metrics.independent.length} / ${project.modules.length}`} tone={metrics.independent.length >= 5 ? 'ok' : undefined} />
        <Metric
          label={project.entryLabel}
          value={tr(`${metrics.flowLatency} мс`, `${metrics.flowLatency} ms`, `${metrics.flowLatency} ms`)}
          tone={metrics.flowLatency <= t.latency ? 'ok' : 'bad'}
        />
        <Metric
          label={tr(`доступность: ${project.entryLabel}`, `availability: ${project.entryLabel}`, `可用性：${project.entryLabel}`)}
          value={`${(metrics.flowAvailability * 100).toFixed(2)}%`}
          tone={metrics.flowAvailability >= t.availability ? 'ok' : 'bad'}
        />
        <Metric
          label={tr('радиус поражения', 'blast radius', '爆炸半径')}
          value={`${Math.round(metrics.blastRadius * 100)}%`}
          tone={metrics.blastRadius > 0.6 ? 'warn' : 'ok'}
          title={tr(
            'Какая доля функций в среднем ломается при падении одного компонента',
            'The average share of features that break when a single component fails',
            '单个组件故障时，平均有多大比例的功能会随之失效',
          )}
        />
        <Metric label={tr('сервисов / БД', 'services / DBs', '服务 / 数据库')} value={`${metrics.services} / ${metrics.databases}`} />
        <Metric label={tr('сложность', 'complexity', '复杂度')} value={metrics.complexity} tone={metrics.complexity <= t.complexity ? 'ok' : 'bad'} />
        <div className="row">
          <button onClick={undo} disabled={!history.length}>
            ↶ {tr('Отменить', 'Undo', '撤销')}
          </button>
          <button onClick={reset}>↺ {tr('Заново', 'Start over', '重新开始')}</button>
        </div>
      </div>
    </>
  const helpEl = <>
      <details className="metrics-help">
        <summary>{tr('Как считаются метрики', 'How metrics are calculated', '指标是如何计算的')}</summary>
        <ul className="small">
          {tr(
            <>
              <li>
                <b>Радиус поражения</b> — средняя доля функций, которые перестают работать при падении одного компонента.
                По очереди «роняем» монолит и каждый сервис: вместе с ним ломаются его модули и все, кто зависит от него
                синхронно (REST, API, прямой SQL), по цепочке. События, саги и реплики падение не передают, circuit
                breaker обрывает цепочку на некритичных связях. У монолита радиус 100%: упал процесс — легло всё.
              </li>
              <li>
                <b>Доступность</b> ключевого сценария — произведение доступностей всех процессов и БД, которые он
                синхронно задевает (каждый 99.9%). Каждый новый синхронный сервис на пути отнимает доступность, ретраи
                частично возвращают.
              </li>
              <li>
                <b>Латентность</b> — базовые 80 мс плюс 15 мс за каждый сетевой синхронный вызов на пути, плюс шлюз, BFF
                и sidecar-ы mesh.
              </li>
              <li>
                <b>Независимый релиз</b> — модуль вынесен, у него своя БД, никто не читает его таблицы напрямую и он не
                участвует в распределённой транзакции без саги.
              </li>
              <li>
                <b>Сложность эксплуатации</b> — 2 за каждый процесс, 1 за каждую БД и стоимость внедрённых паттернов.
              </li>
            </>,
            <>
              <li>
                <b>Blast radius</b> — the average share of features that stop working when a single component fails.
                We “take down” the monolith and each service in turn: its modules break along with it, as does everything
                that depends on it synchronously (REST, API, direct SQL), down the chain. Events, sagas and replicas do
                not propagate the failure, and a circuit breaker cuts the chain on non-critical links. A monolith has a
                100% radius: the process goes down and everything goes down with it.
              </li>
              <li>
                <b>Availability</b> of the key scenario is the product of the availabilities of all processes and
                databases it touches synchronously (99.9% each). Every new synchronous service on the path reduces
                availability; retries partly win it back.
              </li>
              <li>
                <b>Latency</b> — a base of 80 ms plus 15 ms per synchronous network call on the path, plus the gateway,
                BFF and mesh sidecars.
              </li>
              <li>
                <b>Independent release</b> — the module is extracted, has its own database, nobody reads its tables
                directly, and it takes part in no distributed transaction without a saga.
              </li>
              <li>
                <b>Operational complexity</b> — 2 per process, 1 per database, plus the cost of the patterns in use.
              </li>
            </>,
            <>
              <li>
                <b>爆炸半径</b>——单个组件故障时，平均有多大比例的功能会停止工作。我们依次“搞垮”单体和每个服务：随之失效的有它的模块，以及所有同步依赖它的组件（REST、API、直接 SQL），沿调用链一路传递。事件、Saga 和副本不会传递故障，circuit breaker 会在非关键连接上切断这条链。单体的爆炸半径是 100%：进程一挂，全部瘫痪。
              </li>
              <li>
                关键场景的<b>可用性</b>是它同步触及的所有进程和数据库的可用性之积（每个 99.9%）。路径上每多一个同步服务，可用性就会下降；重试可以挽回一部分。
              </li>
              <li>
                <b>延迟</b>——基础 80 ms，路径上每个同步网络调用再加 15 ms，另外还要加上网关、BFF 和 mesh 的 sidecar。
              </li>
              <li>
                <b>独立发布</b>——模块已经拆出，拥有自己的数据库，没有人直接读取它的表，并且它不参与任何没有 Saga 的分布式事务。
              </li>
              <li>
                <b>运维复杂度</b>——每个进程计 2，每个数据库计 1，再加上已采用模式的成本。
              </li>
            </>,
          )}
        </ul>
      </details>
    </>
  const canvasEl = <>
          <MonolithCanvas
            project={project}
            state={state}
            metrics={metrics}
            selected={selected}
            onSelect={(id) => {
              // повторный щелчок по выбранному модулю закрывает окно
              setSelected((cur) => (cur === id ? null : id))
              setPopover(null)
            }}
            activeDep={popover?.id ?? null}
            onDepClick={openDep}
            onBackground={() => {
              setPopover(null)
              setSelected(null)
            }}
            traces={traffic.inFlight}
            vp={vp}
          />
    </>
  const trafficEl = <>
          <TrafficPanel
            log={traffic.log}
            describe={(id) => describeNode(project, id)}
            running={traffic.running}
            setRunning={traffic.setRunning}
            onPickNode={(id) => project.modules.some((m) => m.id === id) && setSelected(id)}
          />
    </>
  const modPopEl = <>
          {mod && !popover && (
            <ModulePopover wrap={wrapRef.current} id={mod.id} label={mod.title} onClose={() => setSelected(null)}>
              <ModulePanel project={project} id={mod.id} state={state} apply={apply} />
              <NodeLog nodeId={mod.id} log={traffic.log} />
            </ModulePopover>
          )}
    </>
  const depPopEl = <>
          {popover && (
            <DepPopover
              project={project}
              d={project.deps.find((x) => x.id === popover.id)!}
              state={state}
              x={popover.x}
              y={popover.y}
              wrapWidth={wrapRef.current?.clientWidth ?? 800}
              apply={apply}
              onSelectModule={(id) => {
                setSelected(id)
                setPopover(null)
              }}
              onClose={() => setPopover(null)}
            />
          )}
    </>
  const patternsEl = <>
      <PatternsPanel state={state} metrics={metrics} apply={apply} />
    </>
  const bottomEl = <>
      <div className="mono-bottom">
        <section className="panel">
          <h4>
            {tr('Проблемы', 'Problems', '问题')} ({metrics.problems.length})
          </h4>
          {metrics.problems.length === 0 && <p className="small ok-text">{tr('Всё чисто', 'All clear', '一切正常')}</p>}
          <ul className="problems">
            {metrics.problems.map((p) => (
              <li key={p.id} className={p.severity}>
                {SEVERITY_ICON[p.severity]} {p.text}
              </li>
            ))}
          </ul>
        </section>
        <StressPanel metrics={metrics} />
        <section className="panel events">
          <h4>{tr('Журнал спринтов', 'Sprint log', '冲刺日志')}</h4>
          <ul>
            {log.length === 0 && <li className="muted">{tr('Спринт 0: монолит работает, все страдают', 'Sprint 0: the monolith works, everyone suffers', '冲刺 0：单体照常运行，所有人都很痛苦')}</li>}
            {log.map((e) => (
              <li key={e.sprint} className={e.tone === 'bad' ? 'error' : e.tone === 'warn' ? 'warn' : 'ok'}>
                <b>
                  {tr('Спринт', 'Sprint', '冲刺')} {e.sprint}:
                </b>{' '}
                {e.action}
                {e.cost > 0 && <span className="cost"> −{e.cost} {tr('млн ₽', 'M ₽', 'M ₽')}</span>}
                {e.notes.map((n) => (
                  <div key={n} className="small">
                    {n}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>

  // телефон: рабочий экран — схема на весь экран, масштаб пальцами; паттерны, проблемы и трафик — шторками
  if (phone)
    return (
      <>
        <Workspace
          title={mission.title}
          panelOpen={panelOpen}
          setPanelOpen={setPanelOpen}
          panel={
            <>
              {headEl}
              {actionsEl}
              {reviewEl}
              {metricsEl}
              {helpEl}
            </>
          }
          metrics={
            <>
              <span className={spent > mission.budget ? 'bad-text' : ''}>
                {spent}/{mission.budget} {tr('млн', 'M', 'M')}
              </span>
              <span className={metrics.flowLatency <= t.latency ? '' : 'bad-text'}>{tr(`${metrics.flowLatency} мс`, `${metrics.flowLatency} ms`, `${metrics.flowLatency} ms`)}</span>
              <span className={metrics.flowAvailability >= t.availability ? '' : 'bad-text'}>{(metrics.flowAvailability * 100).toFixed(2)}%</span>
              <span>{goals.filter((g) => g.ok).length}/{goals.length} 🎯</span>
            </>
          }
          right={
            <>
              <ZoomMenu vp={vp} />
              <button className="icon ws-btn" onClick={undo} disabled={!history.length} title={tr('Отменить', 'Undo', '撤销')} aria-label={tr('Отменить', 'Undo', '撤销')}>
                ↶
              </button>
              {solved && !viewingRef && (
                <button className="primary ws-btn" onClick={() => result$.setOpen(true)} title={tr('Результат', 'Result', '结果')} aria-label={tr('Результат', 'Result', '结果')}>
                  ★
                </button>
              )}
            </>
          }
          bottom={
            <>
              <Tool icon="🧩" label={tr('Паттерны', 'Patterns', '模式')} on={sheet === 'patterns'} onClick={() => setSheet(sheet === 'patterns' ? null : 'patterns')} />
              <Tool icon="⚠️" label={tr('Проблемы', 'Problems', '问题')} on={sheet === 'problems'} onClick={() => setSheet(sheet === 'problems' ? null : 'problems')} badge={metrics.problems.length || undefined} />
              <Tool icon="📡" label={tr('Трафик', 'Traffic', '流量')} on={sheet === 'traffic'} onClick={() => setSheet(sheet === 'traffic' ? null : 'traffic')} />
            </>
          }
        >
          {canvasEl}
          {refEl}
        </Workspace>
        {sheet === 'patterns' && (
          <Sheet title={tr('Паттерны', 'Patterns', '模式')} onClose={() => setSheet(null)}>
            {patternsEl}
          </Sheet>
        )}
        {sheet === 'problems' && (
          <Sheet title={tr('Проблемы и спринты', 'Problems and sprints', '问题与冲刺')} onClose={() => setSheet(null)}>
            {bottomEl}
          </Sheet>
        )}
        {sheet === 'traffic' && (
          <Sheet title={tr('Живой трафик', 'Live traffic', '实时流量')} onClose={() => setSheet(null)}>
            {trafficEl}
          </Sheet>
        )}
        {popover && <Scrim onClose={() => setPopover(null)} />}
        <div className="ws ws-dep">{depPopEl}</div>
        {modPopEl}
        {resultEl}
      </>
    )

  return (
    <>
      {headEl}
      {refEl}
      {actionsEl}
      {resultEl}
      {reviewEl}
      {metricsEl}
      {helpEl}
      <div className="mono-grid">
        <div className="panel canvas-wrap mono-wrap" ref={wrapRef}>
          <div className={'canvas-stage' + vp.stage.className} onPointerEnter={vp.stage.onPointerEnter} onPointerLeave={vp.stage.onPointerLeave}>
            <EditorBar vp={vp} />
            {canvasEl}
          </div>
          {trafficEl}
          {modPopEl}
          {depPopEl}
        </div>
      </div>
      {patternsEl}
      {bottomEl}
    </>
  )
}

function diff(project: Project, a: Metrics, b: Metrics): { notes: string[]; tone: LogEntry['tone'] } {
  const notes: string[] = []
  if (b.flowLatency !== a.flowLatency)
    notes.push(tr(`${project.entryLabel}: ${a.flowLatency} → ${b.flowLatency} мс`, `${project.entryLabel}: ${a.flowLatency} → ${b.flowLatency} ms`, `${project.entryLabel}：${a.flowLatency} → ${b.flowLatency} ms`))
  if (Math.abs(b.flowAvailability - a.flowAvailability) > 1e-6)
    notes.push(
      tr(
        `доступность: ${(a.flowAvailability * 100).toFixed(2)}% → ${(b.flowAvailability * 100).toFixed(2)}%`,
        `availability: ${(a.flowAvailability * 100).toFixed(2)}% → ${(b.flowAvailability * 100).toFixed(2)}%`,
        `可用性：${(a.flowAvailability * 100).toFixed(2)}% → ${(b.flowAvailability * 100).toFixed(2)}%`,
      ),
    )
  if (b.independent.length !== a.independent.length)
    notes.push(
      tr(
        `независимых релизов: ${a.independent.length} → ${b.independent.length}`,
        `independent releases: ${a.independent.length} → ${b.independent.length}`,
        `独立发布：${a.independent.length} → ${b.independent.length}`,
      ),
    )
  const old = new Set(a.problems.map((p) => p.id))
  const fresh = b.problems.filter((p) => !old.has(p.id))
  const fixed = a.problems.length - b.problems.filter((p) => old.has(p.id)).length
  for (const p of fresh) {
    if (p.severity === 'broken') notes.push(tr('⛔ Инцидент: ', '⛔ Incident: ', '⛔ 事故：') + p.text)
    else if (p.severity === 'risk') notes.push(tr('💥 Через неделю на проде: ', '💥 A week later in production: ', '💥 一周后在生产环境：') + p.text)
    else if (p.severity === 'excess') notes.push(tr('🧰 Оверинжиниринг: ', '🧰 Over-engineering: ', '🧰 过度设计：') + p.text)
  }
  const passedBefore = new Set(a.stress.filter((t) => t.applies && t.ok).map((t) => t.id))
  for (const t of b.stress) {
    if (t.applies && t.ok && !passedBefore.has(t.id)) notes.push(tr(`🔥 Учения «${t.title}» теперь проходят`, `🔥 Drill “${t.title}” now passes`, `🔥 演练“${t.title}”现在能通过了`))
  }
  if (fixed > 0) notes.push(tr(`✓ устранено проблем: ${fixed}`, `✓ problems fixed: ${fixed}`, `✓ 已解决的问题：${fixed}`))
  const tone = fresh.some((p) => p.severity === 'broken' || p.severity === 'risk')
    ? 'bad'
    : fresh.length
      ? 'warn'
      : 'ok'
  return { notes, tone }
}

function Metric(props: { label: string; value: string | number; tone?: 'ok' | 'warn' | 'bad'; title?: string }) {
  return (
    <div className={'metric ' + (props.tone ?? '')} title={props.title}>
      <div className="metric-value">{props.value}</div>
      <div className="metric-label">{props.label}</div>
    </div>
  )
}

type Apply = (s: State, action: string) => void

/** Полоса спринтов: зелёный — всё работает, оранжевый — риск потери данных, красный — прод сломан */
function Timeline({ marks }: { marks: SprintMark[] }) {
  if (!marks.length) return null
  return (
    <div className="timeline">
      {marks.map((m) => (
        <span
          key={m.sprint}
          className={'tl-dot ' + m.status}
          title={tr(
            `Спринт ${m.sprint}: ${m.action}${m.problems.length ? '\n' + m.problems.join('\n') : ''}`,
            `Sprint ${m.sprint}: ${m.action}${m.problems.length ? '\n' + m.problems.join('\n') : ''}`,
            `冲刺 ${m.sprint}：${m.action}${m.problems.length ? '\n' + m.problems.join('\n') : ''}`,
          )}
        />
      ))}
      <span className="small muted tl-legend">
        {marks.length} {tr('спр.', 'spr.', '个冲刺')} · <span className="ok-text">●</span> {tr('работает', 'healthy', '正常')} ·{' '}
        <span className="warn-text">●</span> {tr('риск', 'at risk', '有风险')} · <span className="bad-text">●</span>{' '}
        {tr('сломано', 'broken', '故障')}
      </span>
    </div>
  )
}

const SEVERITY_ICON: Record<Metrics['problems'][number]['severity'], string> = {
  broken: '⛔',
  risk: '💥',
  warn: '⚠️',
  excess: '🧰',
}

function PatternsPanel({ state, metrics, apply }: { state: State; metrics: Metrics; apply: Apply }) {
  const excess = new Set(metrics.problems.filter((p) => p.severity === 'excess').map((p) => p.id.replace('excess-', '')))
  const enabled = (Object.keys(PATTERNS) as PatternId[]).filter((k) => state.infra[k])
  const [refId, setRefId] = useState<string | null>(null)
  return (
    <section className="panel patterns-panel">
      {refId && <RefModal id={refId} onClose={() => setRefId(null)} />}
      <div className="card-head">
        <h4>{tr('Паттерны', 'Patterns', '模式')}</h4>
        <span className="small muted">
          {tr('включено', 'enabled', '已启用')} {enabled.length} · {tr('сложность', 'complexity', '复杂度')} +
          {enabled.reduce((s, k) => s + PATTERNS[k].cost, 0)}
        </span>
      </div>
      <div className="pattern-groups">
        {PATTERN_GROUPS.map((g) => (
          <div key={g.title} className="pattern-group">
            <div className="pattern-group-title">{g.title}</div>
            {g.patterns.map((k) => {
              const info = PATTERNS[k]
              const on = state.infra[k]
              const implied = !on && has(state.infra, k)
              return (
                <label
                  key={k}
                  className={'pattern' + (on ? ' on' : '') + (excess.has(k) ? ' excess' : '') + (implied ? ' implied' : '')}
                  title={info.desc}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) =>
                      apply(
                        { ...state, infra: { ...state.infra, [k]: e.target.checked } },
                        e.target.checked
                          ? tr(`внедрили «${info.title}»`, `introduced “${info.title}”`, `引入了“${info.title}”`)
                          : tr(`убрали «${info.title}»`, `removed “${info.title}”`, `移除了“${info.title}”`),
                      )
                    }
                  />
                  <span className="pattern-name">
                    {info.icon} {info.title}
                  </span>
                  <button
                    type="button"
                    className="icon info-btn"
                    title={tr('Что это и когда применять', 'What it is and when to use it', '这是什么，什么时候该用')}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setRefId(k)
                    }}
                  >
                    ⓘ
                  </button>
                  {implied && <span className="badge ok">{tr('покрыт', 'covered', '已覆盖')}</span>}
                  {excess.has(k) && <span className="badge bad">{tr('лишний', 'unnecessary', '多余')}</span>}
                  <span className="small muted">+{info.cost}</span>
                </label>
              )
            })}
            {g.elsewhere?.map((e) => (
              <div key={e.title} className="pattern elsewhere" title={tr(`Настраивается: ${e.where}`, `Configured via: ${e.where}`, `在此配置：${e.where}`)}>
                <span className="pattern-name">↪ {e.title}</span>
                <span className="small muted">{e.where}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}

function StressPanel({ metrics }: { metrics: Metrics }) {
  const relevant = metrics.stress.filter((t) => t.applies)
  const passed = relevant.filter((t) => t.ok).length
  return (
    <section className="panel">
      <h4>
        🔥 {tr('Стресс-тесты', 'Stress tests', '压力测试')} {passed} / {relevant.length}
      </h4>
      <ul className="stress">
        {metrics.stress.map((t) => (
          <li key={t.id} className={!t.applies ? 'na' : t.ok ? 'ok' : 'fail'}>
            <div>
              {!t.applies ? '·' : t.ok ? '✓' : '✗'} <b>{t.title}</b>
              {!t.applies && <span className="small muted">{tr(' — пока не актуально', ' — not relevant yet', '——暂不适用')}</span>}
            </div>
            {t.applies && !t.ok && (
              <div className="small">
                {t.fail}. <b>{tr('Что нужно решить:', 'What the system must do:', '系统需要做到：')}</b> {t.need}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function ModulePanel({ project, id, state, apply }: { project: Project; id: ModuleId; state: State; apply: Apply }) {
  const m = project.modules.find((x) => x.id === id)!
  const ext = state.extracted[id]
  const deps = project.deps.filter((d) => d.from === id || d.to === id)
  return (
    <div className="module-panel">
      <h4>
        {m.icon} {m.title}
      </h4>
      <p className="small muted">
        {m.desc} · {tr(<>команда «{m.team}»</>, <>team “{m.team}”</>, <>团队“{m.team}”</>)}
      </p>
      <div className="row">
        <button
          className={ext ? '' : 'primary'}
          onClick={() =>
            apply(
              {
                ...state,
                extracted: { ...state.extracted, [id]: !ext },
                ownDb: { ...state.ownDb, [id]: false },
              },
              ext
                ? tr(`вернули «${m.title}» в монолит`, `moved “${m.title}” back into the monolith`, `把“${m.title}”移回了单体`)
                : tr(`вынесли «${m.title}» в отдельный сервис`, `extracted “${m.title}” into a separate service`, `把“${m.title}”拆成了独立服务`),
            )
          }
        >
          {ext
            ? tr('↩ Вернуть в монолит', '↩ Move back into the monolith', '↩ 移回单体')
            : tr(`🪓 Вынести в сервис · ${effortOf(m)} млн`, `🪓 Extract into a service · ${effortOf(m)} M`, `🪓 拆成服务 · ${effortOf(m)} M`)}
        </button>
        {ext && (
          <button
            className={state.ownDb[id] ? '' : 'primary'}
            onClick={() =>
              apply(
                { ...state, ownDb: { ...state.ownDb, [id]: !state.ownDb[id] } },
                state.ownDb[id]
                  ? tr(`вернули таблицы «${m.title}» в общую БД`, `moved the “${m.title}” tables back into the shared database`, `把“${m.title}”的表移回了共享数据库`)
                  : tr(`выделили «${m.title}» собственную БД`, `gave “${m.title}” its own database`, `为“${m.title}”分出了独立的数据库`),
              )
            }
          >
            {state.ownDb[id]
              ? tr('Вернуть в общую БД', 'Back to the shared database', '移回共享数据库')
              : tr(`🗄️ Своя БД · ${effortOf(m)} млн`, `🗄️ Own database · ${effortOf(m)} M`, `🗄️ 独立数据库 · ${effortOf(m)} M`)}
          </button>
        )}
      </div>
      <h4 style={{ marginTop: 14 }}>{tr('Связи', 'Links', '连接')}</h4>
      {deps.map((d) => (
        <DepRow key={d.id} project={project} d={d} state={state} apply={apply} />
      ))}
    </div>
  )
}

function DepRow({ project, d, state, apply }: { project: Project; d: Dep; state: State; apply: Apply }) {
  const from = project.modules.find((x) => x.id === d.from)!
  const to = project.modules.find((x) => x.id === d.to)!
  const mode = modeOf(state, d)
  const options = allowedModes(d)
  return (
    <div className="dep" title={d.why}>
      <div className="small">
        {from.icon} {from.title} → {to.icon} {to.title}: <b>{d.label}</b>
        {d.critical && <span className="badge warn" style={{ marginLeft: 6 }}>{tr('критично', 'critical', '关键')}</span>}
      </div>
      {mode === null && options.length > 1 ? (
        <>
          <div className="small muted">
            {tr('в одном процессе · можно заранее подготовить развязку:', 'in one process · you can prepare decoupling in advance:', '在同一进程内 · 可以提前做好解耦：')}
          </div>
          <select
            value={plannedMode(state, d)}
            onChange={(e) =>
              apply(
                { ...state, modes: { ...state.modes, [d.id]: e.target.value as DepMode } },
                tr(
                  `подготовили в монолите ${from.title} → ${to.title}: ${MODE_LABEL[e.target.value as DepMode]}`,
                  `prepared inside the monolith ${from.title} → ${to.title}: ${MODE_LABEL[e.target.value as DepMode]}`,
                  `在单体内提前准备 ${from.title} → ${to.title}：${MODE_LABEL[e.target.value as DepMode]}`,
                ),
              )
            }
          >
            {options.map((o) => (
              <option key={o} value={o}>
                {o === defaultMode(d) ? tr('оставить как есть', 'leave as is', '保持原样') : MODE_LABEL[o]}
                {MODE_COST[o] ? tr(` · ${MODE_COST[o]} млн`, ` · ${MODE_COST[o]} M`, ` · ${MODE_COST[o]} M`) : ''}
              </option>
            ))}
          </select>
        </>
      ) : mode === null ? (
        <div className="small muted">{tr('в одном процессе: обычный вызов', 'in one process: a plain call', '在同一进程内：普通调用')}</div>
      ) : options.length > 1 ? (
        <select
          value={mode}
          onChange={(e) =>
            apply(
              { ...state, modes: { ...state.modes, [d.id]: e.target.value as DepMode } },
              `${from.title} → ${to.title}: ${MODE_LABEL[e.target.value as DepMode]}`,
            )
          }
        >
          {options.map((o) => (
            <option key={o} value={o}>
              {MODE_LABEL[o]}
              {MODE_COST[o] ? tr(` · ${MODE_COST[o]} млн`, ` · ${MODE_COST[o]} M`, ` · ${MODE_COST[o]} M`) : ''}
            </option>
          ))}
        </select>
      ) : (
        <div className="small">{MODE_LABEL[mode]}</div>
      )}
    </div>
  )
}

function DepPopover({
  project,
  d,
  state,
  x,
  y,
  wrapWidth,
  apply,
  onSelectModule,
  onClose,
}: {
  project: Project
  d: Dep
  state: State
  x: number
  y: number
  wrapWidth: number
  apply: Apply
  onSelectModule: (id: ModuleId) => void
  onClose: () => void
}) {
  const from = project.modules.find((m) => m.id === d.from)!
  const to = project.modules.find((m) => m.id === d.to)!
  const mode = modeOf(state, d)
  const options = allowedModes(d)
  const left = Math.max(8, Math.min(x - 150, wrapWidth - 316))
  return (
    <div className="dep-popover" style={{ left, top: y + 14 }} onClick={(e) => e.stopPropagation()}>
      <div className="card-head">
        <b>
          {from.icon} {from.title} → {to.icon} {to.title}
        </b>
        <button className="icon" onClick={onClose} title={tr('Закрыть (Esc)', 'Close (Esc)', '关闭（Esc）')}>
          ✕
        </button>
      </div>
      <div className="small" style={{ margin: '4px 0' }}>
        <b>{d.label}</b> · {KIND_SHORT[d.kind]}
        {d.critical && (
          <span className="badge warn" style={{ marginLeft: 6 }}>
            {tr('критично', 'critical', '关键')}
          </span>
        )}
      </div>
      <p className="small muted">{d.why}</p>
      {mode === null ? (
        <>
          <p className="small">
            {tr('Сейчас это вызов внутри одного процесса.', 'Right now this is a call within a single process.', '目前这是同一进程内的调用。')}
            {options.length > 1
              ? tr(
                  ' Развязку можно подготовить заранее, ещё в монолите — тогда вынос модуля пройдёт без инцидентов:',
                  ' You can prepare decoupling in advance, while still in the monolith — then extracting the module will go without incidents:',
                  '可以趁还在单体里时提前做好解耦——这样拆出模块时就不会出事故：',
                )
              : tr(' Вынесите один из модулей, чтобы выбрать способ связи.', ' Extract one of the modules to choose how they communicate.', '先拆出其中一个模块，才能选择它们的通信方式。')}
          </p>
          {options.length > 1 && (
            <div className="mode-options">
              {options.map((o) => {
                const cur = plannedMode(state, d)
                return (
                  <button
                    key={o}
                    className={o === cur ? 'primary' : ''}
                    onClick={() => {
                      if (o !== cur)
                        apply(
                          { ...state, modes: { ...state.modes, [d.id]: o } },
                          tr(
                            `подготовили в монолите ${from.title} → ${to.title}: ${MODE_LABEL[o]}`,
                            `prepared inside the monolith ${from.title} → ${to.title}: ${MODE_LABEL[o]}`,
                            `在单体内提前准备 ${from.title} → ${to.title}：${MODE_LABEL[o]}`,
                          ),
                        )
                    }}
                  >
                    {o === defaultMode(d) ? tr('оставить как есть', 'leave as is', '保持原样') : MODE_LABEL[o]}
                    {MODE_COST[o] ? <span className="small muted"> · {MODE_COST[o]} {tr('млн', 'M', 'M')}</span> : null}
                  </button>
                )
              })}
            </div>
          )}
          <div className="row">
            {[from, to]
              .filter((m) => !state.extracted[m.id])
              .map((m) => (
                <button key={m.id} onClick={() => onSelectModule(m.id)}>
                  {tr(<>Открыть «{m.title}»</>, <>Open “{m.title}”</>, <>打开“{m.title}”</>)}
                </button>
              ))}
          </div>
        </>
      ) : (
        <div className="mode-options">
          {options.map((o) => (
            <button
              key={o}
              className={o === mode ? 'primary' : ''}
              disabled={options.length === 1}
              onClick={() => {
                if (o !== mode)
                  apply(
                    { ...state, modes: { ...state.modes, [d.id]: o } },
                    `${from.title} → ${to.title}: ${MODE_LABEL[o]}`,
                  )
              }}
            >
              {MODE_LABEL[o]}
              {MODE_COST[o] ? <span className="small muted"> · {MODE_COST[o]} {tr('млн', 'M', 'M')}</span> : null}
            </button>
          ))}
          {options.length === 1 && (
            <p className="small muted">
              {tr(
                'Критичный вызов: ответ нужен до продолжения операции, поэтому только синхронно.',
                'Critical call: the response is needed before the operation can continue, so only synchronous.',
                '关键调用：必须拿到响应，操作才能继续，所以只能同步调用。',
              )}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------- canvas ----------------

type Pos = Record<string, { x: number; y: number }>

function targetPositions(project: Project, state: State): Pos {
  const { inside, outside } = layout(project.modules.length)
  const pos: Pos = {}
  project.modules.forEach((m, i) => (pos[m.id] = state.extracted[m.id] ? outside(i) : inside(i)))
  return pos
}

/** Плавно ведёт позиции к целевым — модули «переезжают» из монолита */
function useAnimatedPositions(target: Pos): Pos {
  const [pos, setPos] = useState(target)
  const cur = useRef(target)
  useEffect(() => {
    let raf = 0
    const step = () => {
      let moving = false
      const next: Pos = {}
      for (const k of Object.keys(target)) {
        const c = cur.current[k] ?? target[k]
        const t = target[k]
        const nx = c.x + (t.x - c.x) * 0.14
        const ny = c.y + (t.y - c.y) * 0.14
        const done = Math.abs(t.x - nx) < 0.5 && Math.abs(t.y - ny) < 0.5
        next[k] = done ? t : { x: nx, y: ny }
        if (!done) moving = true
      }
      cur.current = next
      setPos(next)
      if (moving) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target])
  return pos
}

function MonolithCanvas({
  project,
  state,
  metrics,
  selected,
  onSelect,
  activeDep,
  onDepClick,
  onBackground,
  traces,
  vp,
}: {
  project: Project
  state: State
  metrics: Metrics
  traces?: LiveTrace[]
  /** Масштаб и сдвиг — общие для всех редакторов схем */
  vp: Viewport
  selected: ModuleId | null
  onSelect: (id: ModuleId) => void
  activeDep: string | null
  onDepClick: (id: string, e: React.MouseEvent) => void
  onBackground: () => void
}) {
  const [hovered, setHovered] = useState<string | null>(null)
  const { H, MONO, MONO_DB } = layout(project.modules.length)
  const target = useMemo(() => targetPositions(project, state), [project, state])
  const pos = useAnimatedPositions(target)
  const center = (id: string) => ({ x: pos[id].x + BOX_W / 2, y: pos[id].y + BOX_H / 2 })
  const dbCenter = (id: ModuleId) => {
    const db = dbOf(state, id)
    if (db === 'monolith-db') return { x: MONO_DB.x + MONO_DB.w / 2, y: MONO_DB.y + MONO_DB.h / 2 }
    return { x: pos[id].x + BOX_W + 40, y: pos[id].y + BOX_H / 2 }
  }
  const brokenDep = (d: Dep) => metrics.problems.some((p) => p.severity === 'broken' && p.id.startsWith(d.id + '-'))
  const anyExtracted = project.modules.some((m) => state.extracted[m.id])
  const entry = state.infra.gateway ? { x: 330, y: 92 } : { x: 120, y: 48 }

  const edges = project.deps.map((d) => {
    const mode = modeOf(state, d)
    const a = center(d.from)
    const isBroken = brokenDep(d)
    let b = center(d.to)
    let cls = 'mdep-local'
    if (mode === 'sync' || mode === 'api') cls = 'mflow mflow-sync'
    else if (mode === 'async' || mode === 'saga' || mode === 'replica') cls = 'mflow mflow-async'
    else if (mode === 'direct') {
      cls = 'mflow mflow-db'
      b = dbCenter(d.to)
    }
    if (isBroken) cls = 'mflow mflow-broken'
    const cx = (a.x + b.x) / 2
    const cy = (a.y + b.y) / 2 - (crosses(state, d) ? 30 : 0)
    // середина квадратичной кривой Безье (t = 0.5)
    const mid = { x: 0.25 * a.x + 0.5 * cx + 0.25 * b.x, y: 0.25 * a.y + 0.5 * cy + 0.25 * b.y }
    const path = `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`
    const geom = { a, c: { x: cx, y: cy }, b }
    // подпись только по наведению или для открытой связи — постоянные подписи закрывают сервисы
    const showChip = hovered === d.id || activeDep === d.id
    return { d, mode, path, cls, isBroken, mid, showChip, geom }
  })

  return (
    <svg
      ref={vp.bindSvg}
      className={'builder-canvas mono-canvas' + (vp.zoomed ? ' zoomed' : '')}
      viewBox={vp.viewBox}
      onClick={(e) => {
        // щелчок после сдвига схемы (пробел, средняя кнопка, палец) — не «мимо»: окно модуля остаётся
        if (e.target === e.currentTarget && !vp.recentlyPanned()) onBackground()
      }}
      onPointerDownCapture={vp.onPointerDownCapture}
      onPointerDown={(e) => {
        // пустое место (не модуль и не связь) — сдвиг приближенной схемы, в том числе внутри коробки монолита
        if (!(e.target as Element).closest?.('.mmod, .mdep, .dep-chip')) vp.onBackgroundDown(e)
      }}
      onPointerMove={(e) => vp.onMove(e)}
      onPointerUp={(e) => vp.onUp(e)}
      onPointerCancel={(e) => vp.onUp(e)}
      onContextMenu={(e) => vp.onContextMenu(e)}
    >
      {/* клиенты и фасад */}
      <g>
        <rect x={50} y={20} width={140} height={44} rx={8} className="mono-client" />
        <text x={120} y={47} className="mono-label" textAnchor="middle">
          📱 {tr('Клиенты', 'Clients', '客户端')}
        </text>
      </g>
      {state.infra.gateway && (
        <g className="appear">
          <line x1={190} y1={42} x2={260} y2={92} className="mflow mflow-sync" />
          <rect x={260} y={72} width={160} height={40} rx={8} className="mono-gw" />
          <text x={340} y={97} className="mono-label" textAnchor="middle">
            🚪 {tr('Strangler-фасад', 'Strangler facade', 'Strangler 门面')}
          </text>
        </g>
      )}
      {state.infra.bff && (
        <g className="appear">
          <rect x={440} y={72} width={110} height={40} rx={8} className="mono-gw" />
          <text x={495} y={97} className="mono-label" textAnchor="middle">
            📱 BFF
          </text>
        </g>
      )}
      {/* остальные включённые паттерны — значками */}
      <g className="pattern-rail">
        {RAIL.filter((k) => state.infra[k]).map((k, i) => (
          <g key={k} transform={`translate(${W - 40 - (i % 10) * 34},${10 + Math.floor(i / 10) * 34})`} className="appear">
            <rect width={30} height={30} rx={7} />
            <text x={15} y={21} textAnchor="middle">
              {PATTERNS[k].icon}
            </text>
            <title>{PATTERNS[k].title}</title>
          </g>
        ))}
      </g>
      <line
        x1={entry.x}
        y1={entry.y + 20}
        x2={MONO.x + MONO.w / 2}
        y2={MONO.y}
        className="mflow mflow-sync"
      />
      {project.modules.filter((m) => state.extracted[m.id]).map((m) => {
        const c = center(m.id)
        return (
          <line
            key={'gw-' + m.id}
            x1={state.infra.gateway ? 420 : 190}
            y1={state.infra.gateway ? 92 : 42}
            x2={c.x}
            y2={pos[m.id].y}
            className={'mflow ' + (state.infra.gateway ? 'mflow-sync' : 'mflow-broken')}
          />
        )
      })}

      {/* монолит */}
      <rect
        x={MONO.x}
        y={MONO.y}
        width={MONO.w}
        height={MONO.h}
        rx={16}
        className={'mono-box' + (anyExtracted ? ' shrinking' : '')}
      />
      <text x={MONO.x + 16} y={MONO.y + 24} className="mono-title">
        🏛 {tr('Монолит', 'Monolith', '单体')}
      </text>
      <Cylinder x={MONO_DB.x} y={MONO_DB.y} w={MONO_DB.w} h={MONO_DB.h} label={tr('Общая БД', 'Shared database', '共享数据库')} />

      {state.infra.kafka && (
        <g className="appear">
          <rect x={560} y={H - 40} width={620} height={28} rx={6} className="mono-kafka" />
          <text x={870} y={H - 21} className="mono-label" textAnchor="middle">
            📜 Kafka {state.infra.outbox ? '+ outbox' : ''}
          </text>
        </g>
      )}
      {state.infra.kafka && state.infra.cdc && (
        <path
          d={`M${MONO_DB.x + MONO_DB.w},${MONO_DB.y + MONO_DB.h / 2} Q${MONO_DB.x + MONO_DB.w + 200},${MONO_DB.y + 20} 560,${H - 26}`}
          className="mflow mflow-async"
        >
          <title>{tr('CDC: изменения из журнала транзакций БД уходят в брокер', 'CDC: changes from the database transaction log go to the broker', 'CDC：数据库事务日志中的变更被发送到 Broker')}</title>
        </path>
      )}
      {state.infra.sagaOrchestrator && (
        <g className="appear">
          <rect x={560} y={H - 80} width={190} height={30} rx={6} className="mono-gw" />
          <text x={655} y={H - 60} className="mono-label small-label" textAnchor="middle">
            🎼 {tr('Оркестратор саг', 'Saga orchestrator', 'Saga 编排器')}
          </text>
        </g>
      )}

      {/* связи */}
      {edges.map(({ d, mode, path, cls, isBroken, mid }) => (
        <g
          key={d.id}
          className={'mdep' + (activeDep === d.id ? ' active' : '')}
          onMouseEnter={() => setHovered(d.id)}
          onMouseLeave={() => setHovered((h) => (h === d.id ? null : h))}
          onClick={(e) => onDepClick(d.id, e)}
        >
          <path d={path} className="mdep-hit" />
          <path d={path} className={cls}>
            <title>
              {d.label}: {d.why}
              {mode ? tr(` Сейчас: ${MODE_LABEL[mode]}.`, ` Now: ${MODE_LABEL[mode]}.`, ` 当前：${MODE_LABEL[mode]}。`) : ''}
            </title>
          </path>
          {isBroken && (
            <text x={mid.x} y={mid.y - 16} className="broken-x" textAnchor="middle">
              ✗
            </text>
          )}
        </g>
      ))}

      {/* модули */}
      {project.modules.map((m) => {
        const p = pos[m.id]
        const ext = state.extracted[m.id]
        const indep = metrics.independent.includes(m.id)
        return (
          <g
            key={m.id}
            data-id={m.id}
            className={'mmod' + (selected === m.id ? ' selected' : '') + (ext ? ' extracted' : '') + (indep ? ' indep' : '')}
            transform={`translate(${p.x},${p.y})`}
            onClick={() => onSelect(m.id)}
          >
            <rect width={BOX_W} height={BOX_H} rx={10} className="mmod-box" />
            <text x={12} y={24} className="mono-label">
              {m.icon} {m.title}
            </text>
            <text x={12} y={44} className="bnode-sub">
              {ext
                ? indep
                  ? tr('🚀 независимый релиз', '🚀 independent release', '🚀 独立发布')
                  : tr('сервис', 'service', '服务')
                : tr('модуль монолита', 'monolith module', '单体模块')}
            </text>
            {ext && state.ownDb[m.id] && <Cylinder x={BOX_W + 14} y={6} w={52} h={44} label="" small />}
            {ext && state.infra.mesh && (
              <g className="appear sidecar">
                <rect x={BOX_W - 8} y={-8} width={16} height={16} rx={4} />
                <title>{tr('Sidecar-прокси service mesh', 'Service mesh sidecar proxy', 'Service mesh 的 sidecar 代理')}</title>
              </g>
            )}
            {ext && state.infra.containers && (
              <text x={BOX_W - 22} y={20} className="appear k8s-badge">
                ☸
              </text>
            )}
          </g>
        )
      })}

      {traces && traces.length > 0 && (
        <MonoTrafficLayer
          traces={traces}
          geom={(hopId) => {
            if (hopId.startsWith('entry:')) {
              const m = hopId.slice(6)
              if (!pos[m]) return null
              const from = state.infra.gateway && anyExtracted ? { x: 340, y: 112 } : { x: 120, y: 64 }
              const to = center(m)
              return { a: from, c: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, b: to }
            }
            if (hopId.startsWith('db:')) {
              const m = hopId.slice(3)
              if (!pos[m]) return null
              const a = center(m)
              const b = dbCenter(m)
              return { a, c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, b }
            }
            const e = edges.find((x) => x.d.id === hopId)
            return e ? e.geom : null
          }}
        />
      )}

      {/* подписи связей — поверх модулей */}
      {placeChips(edges.filter((e) => e.showChip)).map(({ d, mode, isBroken, text, x, y, w }) => {
          const tone = isBroken ? 'broken' : mode === null ? 'local' : mode
          return (
            <g
              key={'chip-' + d.id}
              className={'dep-chip ' + tone + (activeDep === d.id ? ' active' : '')}
              transform={`translate(${x},${y})`}
              onMouseEnter={() => setHovered(d.id)}
              onMouseLeave={() => setHovered((h) => (h === d.id ? null : h))}
              onClick={(e) => onDepClick(d.id, e)}
            >
              <rect width={w} height={20} rx={10} />
              <text x={w / 2} y={14} textAnchor="middle">
                {text}
              </text>
            </g>
          )
        })}
    </svg>
  )
}

const CHIP_H = 20
const CHIP_GAP = 3

/** Раздвигает пересекающиеся плашки по вертикали, чтобы подписи не наползали друг на друга */
function placeChips<T extends { d: Dep; mode: DepMode | null; mid: { x: number; y: number } }>(items: T[]) {
  const placed: (T & { text: string; x: number; y: number; w: number })[] = []
  const sorted = [...items].sort((a, b) => a.mid.y - b.mid.y || a.mid.x - b.mid.x)
  for (const it of sorted) {
    const text = `${it.mode ? MODE_SHORT[it.mode] : KIND_SHORT[it.d.kind]} · ${it.d.label}`
    const w = text.length * 6.3 + 16
    const x = it.mid.x - w / 2
    let y = it.mid.y - CHIP_H / 2
    let moved = true
    while (moved) {
      moved = false
      for (const p of placed) {
        const overlapX = x < p.x + p.w && p.x < x + w
        const overlapY = y < p.y + CHIP_H + CHIP_GAP && p.y < y + CHIP_H + CHIP_GAP
        if (overlapX && overlapY) {
          y = p.y + CHIP_H + CHIP_GAP
          moved = true
        }
      }
    }
    placed.push({ ...it, text, x, y, w })
  }
  return placed
}

/** Паттерны, у которых нет своего элемента на схеме, показываем значками в правом верхнем углу */
const RAIL: PatternId[] = [
  'accessToken',
  'rateLimiter',
  'discovery',
  'mtls',
  'acl',
  'idempotentConsumer',
  'eventSourcing',
  'circuitBreakers',
  'retry',
  'bulkhead',
  'idempotencyKeys',
  'tracing',
  'logs',
  'metrics',
  'health',
  'auditLog',
  'canary',
  'config',
  'contracts',
]

const MODE_SHORT: Record<DepMode, string> = {
  sync: 'REST',
  api: 'API',
  async: tr('событие', 'event', '事件'),
  saga: tr('сага', 'saga', 'Saga'),
  replica: tr('реплика', 'replica', '副本'),
  direct: tr('SQL в чужую БД', 'SQL into another DB', '用 SQL 访问他人数据库'),
}

const KIND_SHORT: Record<Dep['kind'], string> = {
  call: tr('вызов', 'call', '调用'),
  tx: tr('общая транзакция', 'shared transaction', '共享事务'),
  read: 'JOIN',
}

function Cylinder({ x, y, w, h, label, small }: { x: number; y: number; w: number; h: number; label: string; small?: boolean }) {
  const ry = small ? 6 : 9
  return (
    <g className="cyl appear">
      <path
        d={`M${x},${y + ry} v${h - 2 * ry} a${w / 2},${ry} 0 0 0 ${w},0 v${-(h - 2 * ry)}`}
        className="cyl-body"
      />
      <ellipse cx={x + w / 2} cy={y + ry} rx={w / 2} ry={ry} className="cyl-top" />
      {label && (
        <text x={x + w / 2} y={y + h / 2 + 10} textAnchor="middle" className="mono-label small-label">
          🗄️ {label}
        </text>
      )}
      {!label && (
        <text x={x + w / 2} y={y + h / 2 + 8} textAnchor="middle" className="small-label">
          🗄️
        </text>
      )}
    </g>
  )
}

// ---------------- живой трафик ----------------

/** Запросы по текущей схеме распила; журнал сбрасывается, когда схема меняется */
function useMonoTraffic(project: Project, state: State, metrics: Metrics) {
  const [running, setRunning] = useState(true)
  const [inFlight, setInFlight] = useState<LiveTrace[]>([])
  const [log, setLog] = useState<Trace[]>([])
  const latest = useRef({ project, state, metrics })
  latest.current = { project, state, metrics }
  const sig = JSON.stringify(state)
  useEffect(() => {
    setLog([])
    setInFlight([])
  }, [sig])
  useEffect(() => {
    if (!running) return
    const tick = () => {
      const { project, state, metrics } = latest.current
      const t = emulateMono(project, state, metrics)
      const now = performance.now()
      const alive = (x: LiveTrace) => now - x.born < (x.hops.length + 3) * HOP_MS + 1500
      setInFlight((xs) => [...xs.filter(alive), { ...t, born: now }].slice(-10))
      setLog((xs) => [t, ...xs].slice(0, 60))
    }
    tick()
    const h = setInterval(tick, 900)
    return () => clearInterval(h)
  }, [running])
  return { running, setRunning, inFlight, log }
}

function describeNode(project: Project, id: string): { icon: string; label: string } | undefined {
  const m = project.modules.find((x) => x.id === id)
  if (m) return { icon: m.icon, label: m.title }
  if (id === MONO_DB) return { icon: '🗄', label: tr('Общая БД', 'Shared DB', '共享数据库') }
  if (id === KAFKA) return { icon: '📜', label: 'Kafka' }
  if (id === GATEWAY) return { icon: '🚪', label: tr('Strangler-фасад', 'Strangler facade', 'Strangler 门面') }
  if (id === CLIENT) return { icon: '📱', label: tr('Клиенты', 'Clients', '客户端') }
  if (id.endsWith('-db')) {
    const owner = project.modules.find((x) => x.id === id.slice(0, -3))
    return { icon: '🗄', label: tr(`БД «${owner?.title ?? id}»`, `“${owner?.title ?? id}” DB`, `“${owner?.title ?? id}”的数据库`) }
  }
  return undefined
}

type Geom = { a: { x: number; y: number }; c: { x: number; y: number }; b: { x: number; y: number } }

const MONO_DOT: Record<SpanStatus, string> = {
  ok: '#7cc4ff',
  hit: '#5be49b',
  miss: '#ffb454',
  slow: '#ff9f43',
  error: '#ff6b7a',
  queued: '#ffd166',
  async: '#ffd166',
}

/** Точки бегут по связям в порядке вызовов; ошибки и события подписываются над целью */
function MonoTrafficLayer({ traces, geom }: { traces: LiveTrace[]; geom: (hopId: string) => Geom | null }) {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    let raf = 0
    const tick = () => {
      setNow(performance.now())
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  const step = HOP_MS * 0.7
  const dots: React.ReactElement[] = []
  const marks: React.ReactElement[] = []
  for (const t of traces) {
    t.hops.forEach((h, i) => {
      const g = geom(h.edgeId)
      if (!g) return
      const start = t.born + i * step
      const p = (now - start) / HOP_MS
      if (p >= 0 && p <= 1) {
        const u = 1 - p
        const x = u * u * g.a.x + 2 * u * p * g.c.x + p * p * g.b.x
        const y = u * u * g.a.y + 2 * u * p * g.c.y + p * p * g.b.y
        dots.push(<circle key={`${t.id}-${i}`} cx={x} cy={y} r={h.status === 'error' ? 8 : 6} fill={MONO_DOT[h.status]} className="tdot" />)
      }
      const age = now - (start + HOP_MS)
      const text =
        h.status === 'error' ? (t.httpStatus ? String(t.httpStatus) : 'ERR')
        : h.status === 'miss' ? 'fallback'
        : h.status === 'queued' ? tr('событие', 'event', '事件')
        : ''
      if (text && age >= 0 && age < 1400)
        marks.push(
          <text key={`${t.id}-m${i}`} x={g.b.x} y={g.b.y - 34 - age / 50} textAnchor="middle" className={'tmark big ' + h.status} style={{ opacity: 1 - age / 1400 }}>
            {text}
          </text>,
        )
    })
  }
  return (
    <g className="traffic" pointerEvents="none">
      {dots}
      {marks}
    </g>
  )
}

/** Окно модуля — колонка сбоку от него на всю видимую высоту: справа, а если не помещается — слева */
function ModulePopover({ wrap, id, label, onClose, children }: { wrap: HTMLDivElement | null; id: ModuleId; label: string; onClose: () => void; children: React.ReactNode }) {
  usePopoverReflow()
  const el = wrap?.querySelector(`.mmod[data-id="${id}"]`)
  const r = el?.getBoundingClientRect()
  const style: React.CSSProperties = r ? sideColumn(r.left, r.right, 330, r.top) : { left: 8, top: 72 }
  return (
    <PopoverDialog
      label={label}
      className="node-popover module-popover"
      style={style}
      onClose={onClose}
      keep=".mmod, .mdep, .dep-chip, .dep-popover, .access-row, .wf-name"
      rootProps={{ onClick: (e) => e.stopPropagation() }}
    >
      <button className="icon popover-x" onClick={onClose} title={tr('Закрыть (Esc)', 'Close (Esc)', '关闭（Esc）')} aria-label={tr('Закрыть', 'Close', '关闭')}>
        ✕
      </button>
      {children}
    </PopoverDialog>
  )
}
