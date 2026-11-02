/**
 * Модель распила монолита. Сама система (модули, связи, цели) задаётся данными — см. projects.ts.
 * Модуль можно вынести в сервис, отделить ему БД, а для каждой зависимости,
 * пересекающей границу, выбрать способ взаимодействия. Метрики пересчитываются
 * из состояния, без случайности, поэтому каждое решение даёт понятный эффект.
 */

export type ModuleId = string

export interface ModuleDef {
  id: ModuleId
  title: string
  icon: string
  team: string
  desc: string
  /** Трудоёмкость выноса, млн ₽ (столько же стоит миграция его данных в свою БД) */
  effort?: number
}


/**
 * call — вызов функции другого модуля;
 * tx — запись в чужие таблицы в одной ACID-транзакции;
 * read — прямой SQL к чужим таблицам (JOIN).
 */
export type DepKind = 'call' | 'tx' | 'read'

/**
 * Как зависимость реализована, когда пересекает границу сервиса:
 * sync — синхронный REST/gRPC; async — событие через брокер;
 * saga — распределённая транзакция через события с компенсациями;
 * direct — по-прежнему прямой SQL в чужую БД; api — чтение через API владельца;
 * replica — локальная копия данных, обновляемая событиями.
 */
export type DepMode = 'sync' | 'async' | 'saga' | 'direct' | 'api' | 'replica'

export interface Dep {
  id: string
  from: ModuleId
  to: ModuleId
  kind: DepKind
  critical: boolean // без этого ключевой сценарий не работает
  /** Тяжёлое чтение: отчёт, выгрузка, агрегат по большой таблице — нагружает чужую БД */
  heavy?: boolean
  label: string
  why: string
}


export interface Project {
  id: string
  title: string
  short: string
  intro: string[]
  /** Модуль, с которого начинается ключевой пользовательский сценарий */
  entry: ModuleId
  entryLabel: string
  /** Самая медленная внешняя зависимость — для стресс-тестов */
  external: string
  modules: ModuleDef[]
  deps: Dep[]
  missions: Mission[]
  /** Пороги для подсветки метрик */
  targets: { latency: number; availability: number; complexity: number }
}

/** Эталонное решение: им проверяется, что миссия решаема в своём бюджете */
export interface Solution {
  extract: ModuleId[]
  ownDb: ModuleId[]
  modes: Record<string, DepMode>
  patterns: PatternId[]
}

export interface Mission {
  id: string
  title: string
  brief: string[]
  /** Бюджет, млн ₽ */
  budget: number
  goals: Goal[]
  debrief: string[]
  solution: Solution
  /** Как объяснить эталонное решение по шагам */
  solutionSteps: string[]
}

/** Метрики плюс деньги — то, по чему проверяются цели миссии */
export type Evaluation = Metrics & { spent: number; budget: number }

import {
  STRESS_TESTS,
  PATTERNS,
  excessPatterns,
  has,
  noPatterns,
  patternsCost,
  type PatternId,
  type Patterns,
  type StressContext,
} from './patterns'
import { tr } from '../../i18n'

export interface Goal {
  text: string
  check: (m: Evaluation) => boolean
}

export interface State {
  extracted: Record<ModuleId, boolean>
  ownDb: Record<ModuleId, boolean>
  modes: Record<string, DepMode>
  /** Включённые паттерны платформы */
  infra: Patterns
}

export function initialState(p: Project): State {
  const f = Object.fromEntries(p.modules.map((m) => [m.id, false])) as Record<ModuleId, boolean>
  return {
    extracted: { ...f },
    ownDb: { ...f },
    modes: {},
    infra: noPatterns(),
  }
}

/** Где выполняется модуль: 'monolith' или id сервиса */
export function unitOf(s: State, m: ModuleId): string {
  return s.extracted[m] ? m : 'monolith'
}

/** Где лежат таблицы модуля */
export function dbOf(s: State, m: ModuleId): string {
  return s.extracted[m] && s.ownDb[m] ? m : 'monolith-db'
}

export function crosses(s: State, d: Dep): boolean {
  return unitOf(s, d.from) !== unitOf(s, d.to)
}

export function allowedModes(d: Dep): DepMode[] {
  switch (d.kind) {
    case 'call':
      return d.critical ? ['sync'] : ['sync', 'async']
    case 'tx':
      return ['sync', 'saga']
    case 'read':
      return ['direct', 'api', 'replica']
  }
}

export function defaultMode(d: Dep): DepMode {
  return d.kind === 'read' ? 'direct' : 'sync'
}

/** Фактический режим: внутри одного процесса — локальный вызов (null) */
export function modeOf(s: State, d: Dep): DepMode | null {
  if (!crosses(s, d)) {
    // Внутри монолита всё локально; внутри одного сервиса — тоже
    return null
  }
  const m = s.modes[d.id]
  return m && allowedModes(d).includes(m) ? m : defaultMode(d)
}

/**
 * Режим, который сработает, когда связь пересечёт границу. Его можно подготовить заранее,
 * пока оба модуля в монолите: развязать код внутри «модульного монолита», а потом выносить.
 */
export function plannedMode(s: State, d: Dep): DepMode {
  const m = s.modes[d.id]
  return m && allowedModes(d).includes(m) ? m : defaultMode(d)
}

export const MODE_LABEL: Record<DepMode, string> = {
  sync: tr('синхронный вызов (REST)', 'synchronous call (REST)'),
  async: tr('сообщение через посредника, без ожидания ответа', 'message via an intermediary, no waiting for a reply'),
  saga: tr('шаги по событиям с откатом, если шаг не удался', 'steps via events, rolled back if a step fails'),
  direct: tr('прямой SQL в чужую БД', 'direct SQL into another module\'s DB'),
  api: tr('запрос в API владельца', 'call the owner\'s API'),
  replica: tr('своя копия данных, обновляется по событиям', 'own copy of the data, updated by events'),
}

export interface Problem {
  id: string
  severity: 'broken' | 'risk' | 'warn' | 'excess'
  text: string
}

export interface Metrics {
  services: number
  databases: number
  independent: ModuleId[]
  flowLatency: number
  flowAvailability: number
  blastRadius: number // средняя доля модулей, которые ломаются при падении одного компонента
  complexity: number
  problems: Problem[]
  stress: StressResult[]
  /** Тяжёлые чтения, которые всё ещё ходят в чужую БД (не через реплику) */
  heavyLeft: string[]
}

export interface StressResult {
  id: string
  title: string
  applies: boolean
  ok: boolean
  fix: (PatternId | string)[]
  fail: string
  need: string
}

const BASE_LATENCY = 80
const HOP = 15
const UNIT_AVAIL = 0.999

/** Синхронно ли вызывающий зависит от цели в рантайме (её падение ломает вызывающего) */
function syncRuntime(s: State, d: Dep): boolean {
  const m = modeOf(s, d)
  if (m === null) return true // один процесс — падают вместе
  // direct — синхронный поход в чужую БД
  return m === 'sync' || m === 'api' || m === 'direct'
}

export function computeMetrics(p: Project, s: State): Metrics {
  const problems: Problem[] = []
  const ext = p.modules.filter((m) => s.extracted[m.id])
  const services = ext.length + (ext.length < p.modules.length ? 1 : 0) // + сам монолит, если в нём что-то осталось
  const databases = ext.filter((m) => s.ownDb[m.id]).length + (p.modules.some((m) => dbOf(s, m.id) === 'monolith-db') ? 1 : 0)

  // ---- проблемы по зависимостям
  for (const d of p.deps) {
    const m = modeOf(s, d)
    if (m === null) continue
    const a = p.modules.find((x) => x.id === d.from)!.title
    const b = p.modules.find((x) => x.id === d.to)!.title
    if ((m === 'async' || m === 'saga' || m === 'replica') && !has(s.infra, 'kafka')) {
      problems.push({ id: `${d.id}-nokafka`, severity: 'broken', text: tr(`${a} → ${b}: выбран обмен событиями, но брокера нет`, `${a} → ${b}: event messaging is selected, but there is no broker`) })
    }
    if ((m === 'async' || m === 'saga' || m === 'replica') && has(s.infra, 'kafka') && !has(s.infra, 'outbox') && !has(s.infra, 'cdc')) {
      problems.push({
        id: `${d.id}-dualwrite`,
        severity: 'risk',
        text: tr(
          `${a} → ${b}: dual write — запись в БД и публикация события не атомарны, событие может потеряться (нужен Outbox или CDC)`,
          `${a} → ${b}: dual write — the DB write and event publishing are not atomic, so the event may be lost (Outbox or CDC needed)`,
        ),
      })
    }
    if (d.kind === 'tx' && m === 'sync') {
      problems.push({
        id: `${d.id}-tx`,
        severity: 'risk',
        text: tr(
          `${a} → ${b}: была ACID-транзакция, стали два сетевых вызова. Сбой между ними оставит данные записанными наполовину (${d.label})`,
          `${a} → ${b}: an ACID transaction became two network calls. A failure between them leaves the data half-written (${d.label})`,
        ),
      })
    }
    if (d.kind === 'read' && m === 'direct') {
      if (dbOf(s, d.to) !== 'monolith-db' && dbOf(s, d.to) !== dbOf(s, d.from)) {
        problems.push({
          id: `${d.id}-broken`,
          severity: 'broken',
          text: tr(
            `${a} → ${b}: таблицы «${b}» переехали в отдельную БД, прямой SQL больше не работает (${d.label})`,
            `${a} → ${b}: the “${b}” tables moved to a separate database, so direct SQL no longer works (${d.label})`,
          ),
        })
      } else {
        problems.push({
          id: `${d.id}-shared`,
          severity: 'warn',
          text: tr(
            `${a} → ${b}: читает чужие таблицы напрямую — схему «${b}» нельзя менять без согласования`,
            `${a} → ${b}: reads another module's tables directly — the “${b}” schema cannot change without coordination`,
          ),
        })
      }
    }
  }
  for (const m of ext) {
    if (!s.ownDb[m.id]) {
      problems.push({
        id: `${m.id}-shareddb`,
        severity: 'warn',
        text: tr(
          `${m.title}: отдельный сервис, но общая БД с монолитом — распределённый монолит`,
          `${m.title}: a separate service, but a shared database with the monolith — a distributed monolith`,
        ),
      })
    }
  }
  if (ext.length > 0 && !has(s.infra, 'gateway')) {
    problems.push({
      id: 'no-gateway',
      severity: 'broken',
      text: tr(
        'Клиенты ходят напрямую в монолит: запросы к вынесенным модулям уходят в никуда. Нужен strangler-фасад',
        'Clients call the monolith directly: requests to extracted modules go nowhere. A strangler facade is needed',
      ),
    })
  }
  if (ext.length >= 3 && !has(s.infra, 'tracing')) {
    problems.push({
      id: 'no-tracing',
      severity: 'warn',
      text: tr(
        'Сервисов много, трассировки нет: поиск причины инцидента займёт часы',
        'Many services and no tracing: finding the root cause of an incident will take hours',
      ),
    })
  }

  // ---- независимость релизов
  const independent = p.modules.filter((m) => {
    if (!s.extracted[m.id] || !s.ownDb[m.id]) return false
    return !p.deps.some(
      (d) =>
        (d.from === m.id || d.to === m.id) &&
        crosses(s, d) &&
        (modeOf(s, d) === 'direct' || (d.kind === 'tx' && modeOf(s, d) === 'sync')),
    )
  }).map((m) => m.id)

  // ---- путь оформления заказа
  const visited = new Set<ModuleId>()
  let latency = BASE_LATENCY + (has(s.infra, 'gateway') && ext.length ? 5 : 0) + (has(s.infra, 'bff') && ext.length ? 3 : 0)
  const units = new Set<string>()
  const walk = (m: ModuleId) => {
    if (visited.has(m)) return
    visited.add(m)
    units.add(unitOf(s, m))
    for (const d of p.deps.filter((x) => x.from === m)) {
      const mode = modeOf(s, d)
      if (mode === 'sync' || mode === 'api') latency += HOP + (s.infra.mesh ? 2 : 0)
      if (mode === 'direct' && crosses(s, d)) latency += 3
      const runtime = syncRuntime(s, d)
      // circuit breaker защищает от падения некритичной синхронной зависимости
      if (runtime && !(has(s.infra, 'circuitBreakers') && !d.critical && mode !== null)) walk(d.to)
    }
  }
  walk(p.entry)
  // общая БД монолита тоже точка отказа, если её кто-то использует на пути
  const dbs = new Set([...visited].map((m) => dbOf(s, m)))
  // ретраи маскируют кратковременные сбои сетевых вызовов
  const remoteUnits = [...units].filter((u) => u !== unitOf(s, p.entry)).length
  const remoteAvail = has(s.infra, 'retry') ? 0.9997 : UNIT_AVAIL
  let availability = UNIT_AVAIL * Math.pow(remoteAvail, remoteUnits) * Math.pow(0.9995, dbs.size)
  if (problems.some((x) => x.severity === 'broken')) availability *= 0.97

  // ---- радиус поражения: падает один юнит — какая доля модулей перестаёт работать
  const allUnits = new Set(p.modules.map((m) => unitOf(s, m.id)))
  let blast = 0
  for (const u of allUnits) {
    const dead = new Set(p.modules.filter((m) => unitOf(s, m.id) === u).map((m) => m.id))
    let changed = true
    while (changed) {
      changed = false
      for (const d of p.deps) {
        if (dead.has(d.to) && !dead.has(d.from) && syncRuntime(s, d)) {
          const mode = modeOf(s, d)
          if (has(s.infra, 'circuitBreakers') && !d.critical && mode !== null) continue
          dead.add(d.from)
          changed = true
        }
      }
    }
    blast += dead.size / p.modules.length
  }
  blast /= allUnits.size

  const complexity = services * 2 + databases + patternsCost(s.infra)

  // ---- стресс-тесты и лишние паттерны
  const crossing = p.deps.map((d) => ({ d, mode: modeOf(s, d) })).filter((x) => x.mode !== null)
  const isSync = (m: DepMode | null) => m === 'sync' || m === 'api'
  const isEvent = (m: DepMode | null) => m === 'async' || m === 'saga' || m === 'replica'
  const heavy = p.deps.filter((d) => d.heavy)
  const heavyLeft = heavy.filter((d) => modeOf(s, d) !== 'replica').map((d) => d.id)
  const ctx: StressContext = {
    has: (id) => has(s.infra, id),
    services: ext.length,
    syncCrossing: crossing.some((x) => isSync(x.mode)),
    criticalSyncCrossing: crossing.some((x) => isSync(x.mode) && x.d.critical),
    eventCrossing: crossing.some((x) => isEvent(x.mode)),
    sagas: crossing.some((x) => x.mode === 'saga'),
    monolithCrossing: crossing.some(
      (x) => x.mode !== 'direct' && (!s.extracted[x.d.from] || !s.extracted[x.d.to]),
    ),
    heavyReads: heavy.length > 0,
    heavyReadsIsolated: heavyLeft.length === 0,
    external: p.external,
  }
  const stress = STRESS_TESTS.map((t) => ({
    id: t.id,
    title: t.title(ctx),
    applies: t.applies(ctx),
    ok: t.ok(ctx),
    fix: t.fix,
    need: t.need,
    fail: t.fail,
  }))
  for (const e of excessPatterns(s.infra, ctx)) {
    problems.push({ id: `excess-${e.id}`, severity: 'excess', text: tr(`Лишний паттерн «${PATTERN_TITLE(e.id)}»: ${e.reason}`, `Unnecessary pattern “${PATTERN_TITLE(e.id)}”: ${e.reason}`) })
  }

  return {
    services,
    databases,
    independent,
    flowLatency: latency,
    flowAvailability: availability,
    blastRadius: blast,
    complexity,
    problems,
    stress,
    heavyLeft,
  }
}

function PATTERN_TITLE(id: PatternId): string {
  return PATTERNS[id].title
}


// ---------------- деньги ----------------

export const MODE_COST: Record<DepMode, number> = {
  sync: 0,
  direct: 0,
  api: 1,
  async: 1,
  replica: 2,
  saga: 3,
}

export function effortOf(m: ModuleDef): number {
  return m.effort ?? 2
}

/** Сколько стоит построить текущее состояние с нуля, млн ₽ */
export function stateCost(p: Project, s: State): number {
  let cost = 0
  for (const m of p.modules) {
    if (s.extracted[m.id]) cost += effortOf(m)
    if (s.extracted[m.id] && s.ownDb[m.id]) cost += effortOf(m)
  }
  // развязка оплачивается, когда её сделали — даже если связь пока внутри монолита
  for (const d of p.deps) cost += MODE_COST[plannedMode(s, d)]
  return cost + patternsCost(s.infra)
}

export function solutionState(p: Project, sol: Solution): State {
  const s = initialState(p)
  for (const m of sol.extract) s.extracted[m] = true
  for (const m of sol.ownDb) s.ownDb[m] = true
  s.modes = { ...sol.modes }
  for (const k of sol.patterns) s.infra[k] = true
  return s
}

export function evaluate(p: Project, s: State, spent: number, budget: number): Evaluation {
  return { ...computeMetrics(p, s), spent, budget }
}
