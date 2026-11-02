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
import { PATTERNS, PATTERN_GROUPS, has, type PatternId } from '../sim/monolith/patterns'
import { markScenario, useProgress } from '../progress'

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

export default function MonolithPage() {
  const progress = useProgress()
  const [projectId, setProjectId] = useState(PROJECTS[0].id)
  const project = PROJECTS.find((p) => p.id === projectId)!
  return (
    <div className="page">
      <div className="crumbs">
        <a href="#/">Главная</a> / <a href="#/microservices">Микросервисы</a> / Распил монолита
      </div>
      <h1>🪓 Распил монолита</h1>
      <div className="row tabs">
        {PROJECTS.map((p, i) => (
          <button
            key={p.id}
            className={p.id === projectId ? 'primary' : ''}
            onClick={() => setProjectId(p.id)}
            title={p.short}
          >
            Уровень {i + 1}: {p.title}{' '}
            <span className="small">
              {p.missions.filter((m) => progress.scenarios[`monolith/${p.id}/${m.id}`]).length}/{p.missions.length}
            </span>
          </button>
        ))}
      </div>
      <Level key={project.id} project={project} />
    </div>
  )
}

function Level({ project }: { project: Project }) {
  const progress = useProgress()
  const [missionId, setMissionId] = useState(project.missions[0].id)
  const mission = project.missions.find((m) => m.id === missionId)!
  return (
    <>
      <div className="row tabs missions">
        <span className="muted small">Миссия:</span>
        {project.missions.map((m) => (
          <button key={m.id} className={m.id === missionId ? 'primary' : ''} onClick={() => setMissionId(m.id)}>
            {progress.scenarios[`monolith/${project.id}/${m.id}`] ? '✓ ' : ''}
            {m.title} <span className="small">· {m.budget} млн ₽</span>
          </button>
        ))}
      </div>
      <MissionView key={mission.id} project={project} mission={mission} />
    </>
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
  const [selected, setSelected] = useState<ModuleId | null>(project.modules[0].id)
  const metrics = useMemo(() => evaluate(project, state, spent, mission.budget), [project, state, spent, mission.budget])
  const goals = [
    ...mission.goals.map((g) => ({ text: g.text, ok: g.check(metrics) })),
    { text: `Уложиться в бюджет ${mission.budget} млн ₽`, ok: spent <= mission.budget },
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
  const openDep = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const r = wrapRef.current!.getBoundingClientRect()
    setPopover({ id, x: e.clientX - r.left, y: e.clientY - r.top })
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPopover(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
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
            Каждое действие — это спринт и стоит денег: вынос модуля, миграция данных, внедрение паттерна, переделка
            связи. Передумали — деньги уже потрачены; «Отменить» откатывает шаг целиком. Наведите курсор на связь,
            чтобы узнать, откуда она взялась.
          </p>
          <details className="solution">
            <summary>Показать эталонное решение</summary>
            <ol className="small">
              {mission.solutionSteps.map((st) => (
                <li key={st}>{st}</li>
              ))}
            </ol>
            <details className="solution">
              <summary>Рекомендуемый порядок по спринтам ({recommended.length})</summary>
              <ol className="small">
                {recommended.map((st) => (
                  <li key={st.label}>{st.label}</li>
                ))}
              </ol>
            </details>
          </details>
        </div>
        <div className={'panel goal' + (solved ? ' success' : '')}>
          <h4>{solved ? '✅ Миссия выполнена!' : '🎯 Цели'}</h4>
          <ul className="goal-list">
            {goals.map((g) => (
              <li key={g.text} className={g.ok ? 'ok-text' : ''}>
                {g.ok ? '✓' : '○'} {g.text}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {solved && (
        <div className="panel success lesson" style={{ marginBottom: 12 }}>
          <h3>Разбор</h3>
          {mission.debrief.map((para) => (
            <p key={para}>{para}</p>
          ))}
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
      <div className="row review-actions">
        {!solved && (
          <button onClick={() => setShowReview(!showReview)}>
            📋 {showReview ? 'Скрыть оценку' : 'Оценить решение'}
          </button>
        )}
        {!viewingRef && <button onClick={toggleReference}>👁 Показать эталон на схеме</button>}
      </div>
      {review && order && (
        <div className="review-pair">
          <ReviewPanel review={review} title={viewingRef ? 'Итог эталона' : 'Итоговая архитектура'} />
          <ReviewPanel review={order.review} title={viewingRef ? 'Рекомендуемый порядок' : 'Порядок распила'}>
            <Timeline marks={order.timeline} />
          </ReviewPanel>
        </div>
      )}

      <div className="mono-metrics">
        <div className={'metric budget ' + (spent > mission.budget ? 'bad' : spent > mission.budget * 0.8 ? 'warn' : 'ok')}>
          <div className="metric-value">
            {spent} / {mission.budget}
          </div>
          <div className="metric-label">потрачено, млн ₽</div>
          <div className="progressbar">
            <div style={{ width: `${Math.min(100, (spent / mission.budget) * 100)}%` }} />
          </div>
        </div>
        <Metric label="независимых релизов" value={`${metrics.independent.length} / ${project.modules.length}`} tone={metrics.independent.length >= 5 ? 'ok' : undefined} />
        <Metric
          label={project.entryLabel}
          value={`${metrics.flowLatency} мс`}
          tone={metrics.flowLatency <= t.latency ? 'ok' : 'bad'}
        />
        <Metric
          label={`доступность: ${project.entryLabel}`}
          value={`${(metrics.flowAvailability * 100).toFixed(2)}%`}
          tone={metrics.flowAvailability >= t.availability ? 'ok' : 'bad'}
        />
        <Metric
          label="радиус поражения"
          value={`${Math.round(metrics.blastRadius * 100)}%`}
          tone={metrics.blastRadius > 0.6 ? 'warn' : 'ok'}
          title="Какая доля функций в среднем ломается при падении одного компонента"
        />
        <Metric label="сервисов / БД" value={`${metrics.services} / ${metrics.databases}`} />
        <Metric label="сложность" value={metrics.complexity} tone={metrics.complexity <= t.complexity ? 'ok' : 'bad'} />
        <div className="row">
          <button onClick={undo} disabled={!history.length}>
            ↶ Отменить
          </button>
          <button onClick={reset}>↺ Заново</button>
        </div>
      </div>

      <details className="metrics-help">
        <summary>Как считаются метрики</summary>
        <ul className="small">
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
        </ul>
      </details>

      <div className="mono-grid">
        <div className="panel canvas-wrap mono-wrap" ref={wrapRef}>
          <MonolithCanvas
            project={project}
            state={state}
            metrics={metrics}
            selected={selected}
            onSelect={(id) => {
              setSelected(id)
              setPopover(null)
            }}
            activeDep={popover?.id ?? null}
            onDepClick={openDep}
            onBackground={() => setPopover(null)}
          />
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
        </div>
        <aside className="panel props">
          {mod && <ModulePanel project={project} id={mod.id} state={state} apply={apply} />}
        </aside>
      </div>

      <PatternsPanel state={state} metrics={metrics} apply={apply} />

      <div className="mono-bottom">
        <section className="panel">
          <h4>Проблемы ({metrics.problems.length})</h4>
          {metrics.problems.length === 0 && <p className="small ok-text">Всё чисто</p>}
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
          <h4>Журнал спринтов</h4>
          <ul>
            {log.length === 0 && <li className="muted">Спринт 0: монолит работает, все страдают</li>}
            {log.map((e) => (
              <li key={e.sprint} className={e.tone === 'bad' ? 'error' : e.tone === 'warn' ? 'warn' : 'ok'}>
                <b>Спринт {e.sprint}:</b> {e.action}
                {e.cost > 0 && <span className="cost"> −{e.cost} млн ₽</span>}
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
  )
}

function diff(project: Project, a: Metrics, b: Metrics): { notes: string[]; tone: LogEntry['tone'] } {
  const notes: string[] = []
  if (b.flowLatency !== a.flowLatency)
    notes.push(`${project.entryLabel}: ${a.flowLatency} → ${b.flowLatency} мс`)
  if (Math.abs(b.flowAvailability - a.flowAvailability) > 1e-6)
    notes.push(
      `доступность: ${(a.flowAvailability * 100).toFixed(2)}% → ${(b.flowAvailability * 100).toFixed(2)}%`,
    )
  if (b.independent.length !== a.independent.length)
    notes.push(`независимых релизов: ${a.independent.length} → ${b.independent.length}`)
  const old = new Set(a.problems.map((p) => p.id))
  const fresh = b.problems.filter((p) => !old.has(p.id))
  const fixed = a.problems.length - b.problems.filter((p) => old.has(p.id)).length
  for (const p of fresh) {
    if (p.severity === 'broken') notes.push('⛔ Инцидент: ' + p.text)
    else if (p.severity === 'risk') notes.push('💥 Через неделю на проде: ' + p.text)
    else if (p.severity === 'excess') notes.push('🧰 Оверинжиниринг: ' + p.text)
  }
  const passedBefore = new Set(a.stress.filter((t) => t.applies && t.ok).map((t) => t.id))
  for (const t of b.stress) {
    if (t.applies && t.ok && !passedBefore.has(t.id)) notes.push(`🔥 Учения «${t.title}» теперь проходят`)
  }
  if (fixed > 0) notes.push(`✓ устранено проблем: ${fixed}`)
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
          title={`Спринт ${m.sprint}: ${m.action}${m.problems.length ? '\n' + m.problems.join('\n') : ''}`}
        />
      ))}
      <span className="small muted tl-legend">
        {marks.length} спр. · <span className="ok-text">●</span> работает · <span className="warn-text">●</span> риск ·{' '}
        <span className="bad-text">●</span> сломано
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
  // какие учения закрывает каждый паттерн — подсказка «зачем он»
  const covers = (id: PatternId) => metrics.stress.filter((t) => t.applies && t.fix.includes(id)).map((t) => t.title)
  return (
    <section className="panel patterns-panel">
      <div className="card-head">
        <h4>Паттерны</h4>
        <span className="small muted">
          включено {enabled.length} · сложность +{enabled.reduce((s, k) => s + PATTERNS[k].cost, 0)}
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
              const cov = covers(k)
              return (
                <label
                  key={k}
                  className={'pattern' + (on ? ' on' : '') + (excess.has(k) ? ' excess' : '') + (implied ? ' implied' : '')}
                  title={info.desc + (cov.length ? `\n\nПомогает в учениях: ${cov.join('; ')}` : '')}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) =>
                      apply(
                        { ...state, infra: { ...state.infra, [k]: e.target.checked } },
                        `${e.target.checked ? 'внедрили' : 'убрали'} «${info.title}»`,
                      )
                    }
                  />
                  <span className="pattern-name">
                    {info.icon} {info.title}
                  </span>
                  {implied && <span className="badge ok">покрыт</span>}
                  {excess.has(k) && <span className="badge bad">лишний</span>}
                  <span className="small muted">+{info.cost}</span>
                </label>
              )
            })}
            {g.elsewhere?.map((e) => (
              <div key={e.title} className="pattern elsewhere" title={`Настраивается: ${e.where}`}>
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
        🔥 Стресс-тесты {passed} / {relevant.length}
      </h4>
      <ul className="stress">
        {metrics.stress.map((t) => (
          <li key={t.id} className={!t.applies ? 'na' : t.ok ? 'ok' : 'fail'}>
            <div>
              {!t.applies ? '·' : t.ok ? '✓' : '✗'} <b>{t.title}</b>
              {!t.applies && <span className="small muted"> — пока не актуально</span>}
            </div>
            {t.applies && !t.ok && (
              <div className="small">
                {t.fail}. Поможет:{' '}
                {t.fix.map((f) => (f in PATTERNS ? PATTERNS[f as PatternId].title : f)).join(' + ')}
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
        {m.desc} · команда «{m.team}»
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
              ext ? `вернули «${m.title}» в монолит` : `вынесли «${m.title}» в отдельный сервис`,
            )
          }
        >
          {ext ? '↩ Вернуть в монолит' : `🪓 Вынести в сервис · ${effortOf(m)} млн`}
        </button>
        {ext && (
          <button
            className={state.ownDb[id] ? '' : 'primary'}
            onClick={() =>
              apply(
                { ...state, ownDb: { ...state.ownDb, [id]: !state.ownDb[id] } },
                state.ownDb[id] ? `вернули таблицы «${m.title}» в общую БД` : `выделили «${m.title}» собственную БД`,
              )
            }
          >
            {state.ownDb[id] ? 'Вернуть в общую БД' : `🗄️ Своя БД · ${effortOf(m)} млн`}
          </button>
        )}
      </div>
      <h4 style={{ marginTop: 14 }}>Связи</h4>
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
        {d.critical && <span className="badge warn" style={{ marginLeft: 6 }}>критично</span>}
      </div>
      {mode === null && options.length > 1 ? (
        <>
          <div className="small muted">в одном процессе · можно заранее подготовить развязку:</div>
          <select
            value={plannedMode(state, d)}
            onChange={(e) =>
              apply(
                { ...state, modes: { ...state.modes, [d.id]: e.target.value as DepMode } },
                `подготовили в монолите ${from.title} → ${to.title}: ${MODE_LABEL[e.target.value as DepMode]}`,
              )
            }
          >
            {options.map((o) => (
              <option key={o} value={o}>
                {o === defaultMode(d) ? 'оставить как есть' : MODE_LABEL[o]}
                {MODE_COST[o] ? ` · ${MODE_COST[o]} млн` : ''}
              </option>
            ))}
          </select>
        </>
      ) : mode === null ? (
        <div className="small muted">в одном процессе: обычный вызов</div>
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
              {MODE_COST[o] ? ` · ${MODE_COST[o]} млн` : ''}
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
        <button className="icon" onClick={onClose} title="Закрыть (Esc)">
          ✕
        </button>
      </div>
      <div className="small" style={{ margin: '4px 0' }}>
        <b>{d.label}</b> · {KIND_SHORT[d.kind]}
        {d.critical && (
          <span className="badge warn" style={{ marginLeft: 6 }}>
            критично
          </span>
        )}
      </div>
      <p className="small muted">{d.why}</p>
      {mode === null ? (
        <>
          <p className="small">
            Сейчас это вызов внутри одного процесса.
            {options.length > 1
              ? ' Развязку можно подготовить заранее, ещё в монолите — тогда вынос модуля пройдёт без инцидентов:'
              : ' Вынесите один из модулей, чтобы выбрать способ связи.'}
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
                          `подготовили в монолите ${from.title} → ${to.title}: ${MODE_LABEL[o]}`,
                        )
                    }}
                  >
                    {o === defaultMode(d) ? 'оставить как есть' : MODE_LABEL[o]}
                    {MODE_COST[o] ? <span className="small muted"> · {MODE_COST[o]} млн</span> : null}
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
                  Открыть «{m.title}»
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
              {MODE_COST[o] ? <span className="small muted"> · {MODE_COST[o]} млн</span> : null}
            </button>
          ))}
          {options.length === 1 && (
            <p className="small muted">Критичный вызов: ответ нужен до продолжения операции, поэтому только синхронно.</p>
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
}: {
  project: Project
  state: State
  metrics: Metrics
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
    // подпись только по наведению или для открытой связи — постоянные подписи закрывают сервисы
    const showChip = hovered === d.id || activeDep === d.id
    return { d, mode, path, cls, isBroken, mid, showChip }
  })

  return (
    <svg
      className="builder-canvas mono-canvas"
      viewBox={`0 0 ${W} ${H}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onBackground()
      }}
    >
      {/* клиенты и фасад */}
      <g>
        <rect x={50} y={20} width={140} height={44} rx={8} className="mono-client" />
        <text x={120} y={47} className="mono-label" textAnchor="middle">
          📱 Клиенты
        </text>
      </g>
      {state.infra.gateway && (
        <g className="appear">
          <line x1={190} y1={42} x2={260} y2={92} className="mflow mflow-sync" />
          <rect x={260} y={72} width={160} height={40} rx={8} className="mono-gw" />
          <text x={340} y={97} className="mono-label" textAnchor="middle">
            🚪 Strangler-фасад
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
        🏛 Монолит
      </text>
      <Cylinder x={MONO_DB.x} y={MONO_DB.y} w={MONO_DB.w} h={MONO_DB.h} label="Общая БД" />

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
          <title>CDC: изменения из журнала транзакций БД уходят в брокер</title>
        </path>
      )}
      {state.infra.sagaOrchestrator && (
        <g className="appear">
          <rect x={560} y={H - 80} width={190} height={30} rx={6} className="mono-gw" />
          <text x={655} y={H - 60} className="mono-label small-label" textAnchor="middle">
            🎼 Оркестратор саг
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
              {mode ? ` Сейчас: ${MODE_LABEL[mode]}.` : ''}
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
            className={'mmod' + (selected === m.id ? ' selected' : '') + (ext ? ' extracted' : '') + (indep ? ' indep' : '')}
            transform={`translate(${p.x},${p.y})`}
            onClick={() => onSelect(m.id)}
          >
            <rect width={BOX_W} height={BOX_H} rx={10} className="mmod-box" />
            <text x={12} y={24} className="mono-label">
              {m.icon} {m.title}
            </text>
            <text x={12} y={44} className="bnode-sub">
              {ext ? (indep ? '🚀 независимый релиз' : 'сервис') : 'модуль монолита'}
            </text>
            {ext && state.ownDb[m.id] && <Cylinder x={BOX_W + 14} y={6} w={52} h={44} label="" small />}
            {ext && state.infra.mesh && (
              <g className="appear sidecar">
                <rect x={BOX_W - 8} y={-8} width={16} height={16} rx={4} />
                <title>Sidecar-прокси service mesh</title>
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
  async: 'событие',
  saga: 'сага',
  replica: 'реплика',
  direct: 'SQL в чужую БД',
}

const KIND_SHORT: Record<Dep['kind'], string> = {
  call: 'вызов',
  tx: 'общая транзакция',
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
