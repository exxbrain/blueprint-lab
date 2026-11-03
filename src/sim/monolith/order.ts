/**
 * Оценка порядка распила: важна не только конечная архитектура, но и путь к ней.
 * Strangler Fig — это много маленьких безопасных шагов, при которых прод всё время работает.
 */
import { grade, type Review, type ReviewItem } from '../review'
import { tr } from '../../i18n'
import { PATTERNS, type PatternId } from './patterns'
import {
  MODE_LABEL,
  computeMetrics,
  defaultMode,
  initialState,
  plannedMode,
  type Mission,
  type ModuleId,
  type Project,
  type State,
} from './model'

export type SprintStatus = 'ok' | 'risk' | 'broken'

export interface SprintMark {
  sprint: number
  action: string
  status: SprintStatus
  problems: string[]
}

/** Связность модуля: сколько связей его касается. Начинать распил лучше с наименее связанных */
export function coupling(p: Project, m: ModuleId): number {
  return p.deps.filter((d) => d.from === m || d.to === m).length
}

function status(p: Project, s: State): { status: SprintStatus; problems: string[] } {
  const probs = computeMetrics(p, s).problems
  const broken = probs.filter((x) => x.severity === 'broken')
  const risk = probs.filter((x) => x.severity === 'risk')
  if (broken.length) return { status: 'broken', problems: broken.map((x) => x.text) }
  if (risk.length) return { status: 'risk', problems: risk.map((x) => x.text) }
  return { status: 'ok', problems: [] }
}

/**
 * states[0] — исходное состояние, states[i] — после спринта i; actions[i-1] — что сделали в спринте i.
 */
export function reviewOrder(p: Project, states: State[], actions: string[]): { review: Review; timeline: SprintMark[] } {
  const items: ReviewItem[] = []
  const timeline: SprintMark[] = states.slice(1).map((s, i) => ({ sprint: i + 1, action: actions[i] ?? '', ...status(p, s) }))
  const title = (id: string) => p.modules.find((x) => x.id === id)?.title ?? id

  // 1. инциденты и риск по спринтам
  const broken = timeline.filter((t) => t.status === 'broken')
  const risky = timeline.filter((t) => t.status === 'risk')
  if (!timeline.length) items.push({ tone: 'info', text: tr('Пока ни одного спринта', 'No sprints yet', '还没有任何冲刺') })
  else if (!broken.length && !risky.length)
    items.push({ tone: 'ok', text: tr('Ни одного спринта со сломанным продом или риском потери данных', 'Not a single sprint with broken production or risk of data loss', '没有一个冲刺弄坏生产环境或带来数据丢失风险') })
  // каждая отдельная причина — со спринтом, где она появилась (не больше трёх, чтобы не тонуть)
  const causes = (marks: SprintMark[]) => {
    const seen = new Map<string, SprintMark>()
    for (const t of marks) for (const pr of t.problems) if (!seen.has(pr)) seen.set(pr, t)
    return [...seen.entries()].slice(0, 3)
  }
  if (broken.length) {
    items.push({ tone: 'bad', text: tr(`Прод был сломан ${broken.length} из ${timeline.length} спринтов`, `Production was broken in ${broken.length} of ${timeline.length} sprints`, `${timeline.length} 个冲刺中有 ${broken.length} 个弄坏了生产环境`) })
    for (const [pr, t] of causes(broken))
      items.push({ tone: 'bad', text: tr(`Спринт ${t.sprint} («${t.action}»): ${pr}`, `Sprint ${t.sprint} (“${t.action}”): ${pr}`, `冲刺 ${t.sprint}（“${t.action}”）：${pr}`) })
  }
  if (risky.length) {
    items.push({ tone: 'warn', text: tr(`${risky.length} спринт(ов) с риском потери данных`, `${risky.length} sprint(s) at risk of data loss`, `${risky.length} 个冲刺存在数据丢失风险`) })
    for (const [pr, t] of causes(risky)) items.push({ tone: 'info', text: tr(`Спринт ${t.sprint} («${t.action}»): ${pr}`, `Sprint ${t.sprint} (“${t.action}”): ${pr}`, `冲刺 ${t.sprint}（“${t.action}”）：${pr}`) })
  }

  // 2. фасад до первого выноса
  const firstExtract = states.findIndex((s) => p.modules.some((m) => s.extracted[m.id]))
  const firstGateway = states.findIndex((s) => s.infra.gateway)
  if (firstExtract > 0 && (firstGateway < 0 || firstGateway > firstExtract))
    items.push({
      tone: 'warn',
      text: tr(
        'Модуль вынесли раньше, чем поставили strangler-фасад. Фасад ставят первым: клиенты переключаются на него, пока всё ещё идёт в монолит',
        'A module was extracted before the strangler facade was in place. The facade goes first: clients switch to it while everything still goes to the monolith',
        '在 strangler 门面就位之前就拆出了模块。门面要最先上线：客户端先切换到门面，而此时所有请求仍然转发给单体',
      ),
    })

  // 3. порядок модулей: от краёв к ядру
  const final = states[states.length - 1]
  const order: ModuleId[] = []
  states.forEach((s, i) => {
    if (i === 0) return
    for (const m of p.modules)
      if (s.extracted[m.id] && !states[i - 1].extracted[m.id] && final.extracted[m.id]) {
        const at = order.indexOf(m.id)
        if (at >= 0) order.splice(at, 1)
        order.push(m.id)
      }
  })
  let worst: { a: ModuleId; b: ModuleId; diff: number } | null = null
  let inversions = 0
  for (let i = 0; i < order.length; i++)
    for (let j = i + 1; j < order.length; j++) {
      const diff = coupling(p, order[i]) - coupling(p, order[j])
      if (diff > 1) {
        inversions++
        if (!worst || diff > worst.diff) worst = { a: order[i], b: order[j], diff }
      }
    }
  if (order.length >= 2) {
    if (worst)
      items.push({
        tone: 'warn',
        text: tr(
          `«${title(worst.a)}» (${coupling(p, worst.a)} связей) вынесли раньше, чем «${title(worst.b)}» (${coupling(p, worst.b)}). Начинают с краёв: меньше связей — меньше риска и быстрее первый результат`,
          `“${title(worst.a)}” (${coupling(p, worst.a)} dependencies) was extracted before “${title(worst.b)}” (${coupling(p, worst.b)}). Start from the edges: fewer dependencies mean less risk and a faster first result`,
          `“${title(worst.a)}”（${coupling(p, worst.a)} 个依赖）比“${title(worst.b)}”（${coupling(p, worst.b)} 个）更早被拆出。应当从边缘开始：依赖越少，风险越小，也越快见到第一个成果`,
        ),
      })
    else items.push({ tone: 'ok', text: tr(`Порядок выноса от краёв к ядру: ${order.map(title).join(' → ')}`, `Extraction order from the edges to the core: ${order.map(title).join(' → ')}`, `从边缘到核心的拆分顺序：${order.map(title).join(' → ')}`) })
  }

  // 4. метания: сделали и откатили
  let thrash = 0
  for (let i = 1; i < states.length; i++) {
    const a = states[i - 1]
    const b = states[i]
    for (const m of p.modules) {
      if (a.extracted[m.id] && !b.extracted[m.id]) thrash++
      if (a.ownDb[m.id] && !b.ownDb[m.id] && b.extracted[m.id]) thrash++
    }
    for (const k of Object.keys(PATTERNS) as PatternId[]) if (a.infra[k] && !b.infra[k]) thrash++
    for (const d of p.deps) {
      const ma = plannedMode(a, d)
      if (ma !== defaultMode(d) && ma !== plannedMode(b, d)) thrash++
    }
  }
  if (thrash) items.push({ tone: thrash > 2 ? 'warn' : 'info', text: tr(`Откатов уже сделанной работы: ${thrash}`, `Rollbacks of completed work: ${thrash}`, `回滚已完成工作的次数：${thrash}`) })

  // штрафы: инциденты дороже всего
  const r = grade(true, 1, items)
  const score = Math.max(
    0,
    r.score - Math.min(50, broken.length * 10) - Math.min(30, risky.length * 5) - Math.min(20, Math.max(0, inversions - 1) * 5),
  )
  const stars = score >= 85 ? 3 : score >= 65 ? 2 : 1
  const verdict =
    stars === 3
      ? tr('Образцовый Strangler Fig: маленькие безопасные шаги', 'Textbook Strangler Fig: small, safe steps', '教科书级的 Strangler Fig：小步快走，步步安全')
      : stars === 2
        ? tr('Добрались, но по дороге были инциденты или лишние риски', 'You got there, but with incidents or unnecessary risks along the way', '目标达成了，但途中出现了事故或不必要的风险')
        : tr('Путь был опасным: прод ломался, данные были под угрозой', 'A dangerous path: production broke and data was at risk', '这条路很危险：生产环境坏过，数据也曾面临风险')
  return { review: { score, stars, verdict, items }, timeline }
}

export interface Step {
  label: string
  apply: (s: State) => State
}

const PLATFORM_FIRST: PatternId[] = ['gateway', 'kafka', 'outbox', 'cdc', 'idempotentConsumer', 'sagaOrchestrator']

/**
 * Рекомендуемый порядок для эталона: сначала платформа, затем модули от краёв к ядру.
 * Для каждого модуля: подготовить развязку в монолите → вынести → отделить БД.
 */
export function recommendedOrder(p: Project, m: Mission): Step[] {
  const steps: Step[] = []
  const sol = m.solution
  const pat = (k: PatternId): Step => ({
    label: tr(`Внедрить «${PATTERNS[k].title}»`, `Introduce “${PATTERNS[k].title}”`, `引入“${PATTERNS[k].title}”`),
    apply: (s) => ({ ...s, infra: { ...s.infra, [k]: true } }),
  })
  for (const k of PLATFORM_FIRST) if (sol.patterns.includes(k)) steps.push(pat(k))
  const title = (id: string) => p.modules.find((x) => x.id === id)!.title
  const prepared = new Set<string>()
  const mods = [...sol.extract].sort((a, b) => coupling(p, a) - coupling(p, b))
  for (const mod of mods) {
    for (const d of p.deps) {
      const mode = sol.modes[d.id]
      if (!mode || prepared.has(d.id) || (d.from !== mod && d.to !== mod)) continue
      prepared.add(d.id)
      steps.push({
        label: tr(
          `Подготовить ${title(d.from)} → ${title(d.to)}: ${MODE_LABEL[mode]}`,
          `Prepare ${title(d.from)} → ${title(d.to)}: ${MODE_LABEL[mode]}`,
          `准备 ${title(d.from)} → ${title(d.to)}：${MODE_LABEL[mode]}`,
        ),
        apply: (s) => ({ ...s, modes: { ...s.modes, [d.id]: mode } }),
      })
    }
    steps.push({ label: tr(`Вынести «${title(mod)}»`, `Extract “${title(mod)}”`, `拆出“${title(mod)}”`), apply: (s) => ({ ...s, extracted: { ...s.extracted, [mod]: true } }) })
    if (sol.ownDb.includes(mod))
      steps.push({ label: tr(`Своя БД для «${title(mod)}»`, `Own database for “${title(mod)}”`, `为“${title(mod)}”配置独立数据库`), apply: (s) => ({ ...s, ownDb: { ...s.ownDb, [mod]: true } }) })
  }
  for (const k of sol.patterns) if (!PLATFORM_FIRST.includes(k)) steps.push(pat(k))
  return steps
}

/** Прогон рекомендуемого порядка: состояния после каждого шага */
export function replay(p: Project, steps: Step[]): State[] {
  const states = [initialState(p)]
  for (const st of steps) states.push(st.apply(states[states.length - 1]))
  return states
}
