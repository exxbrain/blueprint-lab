/**
 * Поиск Bounded Context: карточки Event Storming (события, команды, термины, правила)
 * раскладываются по контекстам. Сравниваем разбиение с эталоном попарно — названия групп
 * не важны, важно, какие карточки оказались вместе, а какие порознь.
 * Второй тип задач — Context Map: выбрать тип отношений между контекстами.
 */
import { tr } from '../../i18n'
import type { Review, ReviewItem } from '../review'

export type CardKind = 'event' | 'command' | 'term' | 'policy'

export const CARD_KIND: Record<CardKind, { title: string; hint: string }> = {
  event: { title: tr('Событие', 'Event'), hint: tr('Что произошло в бизнесе', 'Something that happened in the business') },
  command: { title: tr('Команда', 'Command'), hint: tr('Намерение что-то сделать', 'An intent to do something') },
  term: { title: tr('Термин', 'Term'), hint: tr('Понятие и его данные в этой части бизнеса', 'A concept and its data in this part of the business') },
  policy: { title: tr('Правило', 'Policy'), hint: tr('«Когда X — сделать Y»', '“When X, do Y”') },
}

export interface DddContext {
  id: string
  name: string
  desc: string
}

export interface DddCard {
  id: string
  name: string
  kind: CardKind
  /** Контекст в эталоне */
  ctx: string
  /** Почему карточка относится к этому контексту — показывается при ошибке */
  why: string
}

export interface PartitionTask {
  type: 'partition'
  id: string
  title: string
  brief: string[]
  contexts: DddContext[]
  cards: DddCard[]
  /** Минимальная точность разбиения, чтобы задача считалась решённой */
  minScore: number
  hints: string[]
  debrief: string[]
}

export type MapPattern = 'partnership' | 'shared-kernel' | 'customer-supplier' | 'conformist' | 'acl' | 'ohs' | 'separate-ways'

export const MAP_PATTERNS: Record<MapPattern, { title: string; desc: string }> = {
  partnership: {
    title: 'Partnership',
    desc: tr('Две команды планируют и выпускают изменения вместе: успех или провал у них общий', 'Two teams plan and release changes together: they succeed or fail together'),
  },
  'shared-kernel': {
    title: 'Shared Kernel',
    desc: tr('Небольшая общая часть модели (код, схема), которую команды меняют только по согласию', 'A small shared part of the model (code, schema) that teams change only by agreement'),
  },
  'customer-supplier': {
    title: 'Customer / Supplier',
    desc: tr('Поставщик (upstream) учитывает потребности клиента (downstream) в своих планах', 'The supplier (upstream) takes the customer’s (downstream) needs into account in its plans'),
  },
  conformist: {
    title: 'Conformist',
    desc: tr('Downstream просто принимает модель upstream как есть: влиять на неё нельзя, а переводить не окупается', 'Downstream simply adopts the upstream model as is: it cannot influence it, and translating does not pay off'),
  },
  acl: {
    title: 'Anticorruption Layer',
    desc: tr('Downstream ставит слой-переводчик, чтобы чужая модель не проникала в его собственную', 'Downstream adds a translation layer so the foreign model does not leak into its own'),
  },
  ohs: {
    title: 'Open Host Service / Published Language',
    desc: tr('Upstream публикует один документированный протокол для всех потребителей вместо интеграции под каждого', 'Upstream publishes one documented protocol for all consumers instead of a custom integration for each'),
  },
  'separate-ways': {
    title: 'Separate Ways',
    desc: tr('Интеграции нет: связь не окупается, каждый решает свою задачу сам', 'No integration: the connection does not pay off, each side solves its own problem'),
  },
}

export interface MapRelation {
  id: string
  /** Кто поставляет модель/данные */
  upstream: string
  /** Кто от неё зависит */
  downstream: string
  situation: string
  answer: MapPattern
  why: string
  /** Другие защитимые ответы */
  alsoOk?: MapPattern[]
}

export interface MapTask {
  type: 'map'
  id: string
  title: string
  brief: string[]
  contexts: DddContext[]
  relations: MapRelation[]
  hints: string[]
  debrief: string[]
}

export type DddTask = PartitionTask | MapTask

// ---------------- разбиение ----------------

export interface Group {
  id: string
  name: string
}

export interface PartitionState {
  groups: Group[]
  /** карточка → группа; нет ключа — карточка ещё не разложена */
  place: Record<string, string>
}

export interface PartitionScore {
  /** Карточки, которые должны быть вместе, действительно вместе */
  cohesion: number
  /** Карточки из разных контекстов не смешаны */
  separation: number
  /** Итог (F1), 0..1 */
  score: number
  placed: number
  total: number
}

export function scorePartition(t: PartitionTask, s: PartitionState): PartitionScore {
  let tp = 0
  let fp = 0
  let fn = 0
  const cards = t.cards
  for (let i = 0; i < cards.length; i++)
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i]
      const b = cards[j]
      const refSame = a.ctx === b.ctx
      const ga = s.place[a.id]
      const gb = s.place[b.id]
      const userSame = !!ga && ga === gb
      if (refSame && userSame) tp++
      else if (!refSame && userSame) fp++
      else if (refSame && !userSame) fn++
    }
  const cohesion = tp + fn ? tp / (tp + fn) : 1
  const separation = tp + fp ? tp / (tp + fp) : 0
  const score = cohesion + separation ? (2 * cohesion * separation) / (cohesion + separation) : 0
  const placed = cards.filter((c) => s.place[c.id]).length
  return { cohesion, separation, score, placed, total: cards.length }
}

export function partitionSolved(t: PartitionTask, s: PartitionState): boolean {
  const sc = scorePartition(t, s)
  return sc.placed === sc.total && sc.score >= t.minScore
}

/** Какому контексту эталона соответствует группа игрока: тому, чьих карточек в ней больше всего */
const STOP = new Set(['and', 'the', 'for', 'для', 'про', 'под', 'над', 'без', 'при', 'или'])

/** Основы слов названия: «Корзины покупателя» → корзи, покуп. Хватает, чтобы узнать контекст в имени группы */
function stems(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^a-zа-я0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map((w) => w.slice(0, 5))
}

/**
 * Контекст, который игрок сам назвал в имени группы. Только если название группы целиком из слов названия контекста
 * («Корзина», «Рестораны» для «Рестораны и меню») и это подкреплено стикерами — их больше трети группы.
 * Лишнее слово («Письма о заказах», «Курьеры для заказов») — не узнаём: о группе говорит большинство стикеров.
 */
function namedContext(t: PartitionTask, name: string, counts: Record<string, number>): string | undefined {
  const mine = stems(name)
  if (!mine.length) return
  const fits = t.contexts.filter((c) => {
    const words = new Set(stems(c.name))
    return words.size > 0 && mine.every((w) => words.has(w))
  })
  // «Оплата» подходит и к «Оплата», и к «Оплата услуг» — тогда берём точное совпадение
  const exact = fits.filter((c) => stems(c.name).every((w) => mine.includes(w)))
  const hit = fits.length === 1 ? fits[0] : exact.length === 1 ? exact[0] : undefined
  if (!hit) return
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  return (counts[hit.id] ?? 0) * 3 > total ? hit.id : undefined
}

/**
 * О каком контексте группа. Если игрок назвал группу контекстом («Корзина») и такие стикеры в ней есть — этим контекстом:
 * тогда «не на месте» — чужие стикеры в ней, а не стикеры корзины. Иначе — по большинству стикеров.
 */
export function groupContexts(t: PartitionTask, s: PartitionState): Record<string, { ctx: string | undefined; byName: boolean }> {
  const out: Record<string, { ctx: string | undefined; byName: boolean }> = {}
  for (const g of s.groups) {
    const counts: Record<string, number> = {}
    for (const c of t.cards) if (s.place[c.id] === g.id) counts[c.ctx] = (counts[c.ctx] ?? 0) + 1
    const named = namedContext(t, g.name, counts)
    out[g.id] = named ? { ctx: named, byName: true } : { ctx: Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0], byName: false }
  }
  return out
}

/** Стикеры не в своём контексте — по тому, о чём группа (см. groupContexts) */
export function misplacedCards(t: PartitionTask, s: PartitionState): DddCard[] {
  const g = groupContexts(t, s)
  return t.cards.filter((c) => s.place[c.id] && g[s.place[c.id]]?.ctx !== c.ctx)
}

export function reviewPartition(t: PartitionTask, s: PartitionState, hintsUsed: number): Review {
  const sc = scorePartition(t, s)
  const items: ReviewItem[] = []
  const ctxName = (id: string) => t.contexts.find((c) => c.id === id)?.name ?? id
  const about = groupContexts(t, s)
  const major = Object.fromEntries(Object.entries(about).map(([k, v]) => [k, v.ctx]))
  const groupName = (id: string) => s.groups.find((g) => g.id === id)?.name ?? id

  if (sc.placed < sc.total)
    items.push({ tone: 'bad', text: tr(`Разложено ${sc.placed} из ${sc.total} карточек`, `${sc.placed} of ${sc.total} cards placed`) })

  const solved = partitionSolved(t, s)
  // карточки не в «своём» контексте; пока задача не решена — без ответа, только пара наводящих подсказок
  const misplaced = misplacedCards(t, s)
  if (solved)
    for (const c of misplaced) {
      const g = s.place[c.id]
      items.push({
        tone: 'bad',
        // группу называем так, как её назвал игрок; «в основном» — только когда о ней говорит большинство стикеров, а не название
        text: about[g].byName
          ? tr(
              `«${c.name}» лежит в группе «${groupName(g)}», а относится к «${ctxName(c.ctx)}»: ${c.why}`,
              `“${c.name}” sits in group “${groupName(g)}”, but it belongs to “${ctxName(c.ctx)}”: ${c.why}`,
            )
          : tr(
              `«${c.name}» лежит в группе «${groupName(g)}» — там в основном стикеры контекста «${ctxName(major[g]!)}», а этот относится к «${ctxName(c.ctx)}»: ${c.why}`,
              `“${c.name}” sits in group “${groupName(g)}”, which mostly holds “${ctxName(major[g]!)}” stickies, but this one belongs to “${ctxName(c.ctx)}”: ${c.why}`,
            ),
      })
    }
  else if (misplaced.length) {
    items.push({
      tone: 'bad',
      text: tr(`Стикеров не на своём месте: ${misplaced.length} (отмечены красным)`, `Stickies in the wrong place: ${misplaced.length} (marked in red)`),
    })
    for (const c of misplaced.slice(0, 2)) items.push({ tone: 'info', text: tr(`«${c.name}»: ${c.why}`, `“${c.name}”: ${c.why}`) })
  }
  // контекст эталона разрезан на несколько групп
  for (const ctx of t.contexts) {
    const groups = s.groups.filter((g) => major[g.id] === ctx.id)
    if (groups.length > 1)
      items.push({
        tone: 'warn',
        text: tr(
          `Группы ${groups.map((g) => `«${groupName(g.id)}»`).join(' и ')} описывают одно и то же — «${ctx.name}»: один язык и одни данные, их стоит объединить`,
          `Groups ${groups.map((g) => `“${groupName(g.id)}”`).join(' and ')} describe the same thing, “${ctx.name}”: one language and one set of data, so merge them`,
        ),
      })
  }
  // стикеры одного контекста смешаны с чужими: называем группу игрока и сами стикеры, а не контекст эталона
  for (const ctx of t.contexts) {
    const mine = t.cards.filter((c) => c.ctx === ctx.id && s.place[c.id])
    if (!mine.length || s.groups.some((g) => major[g.id] === ctx.id)) continue
    // группа, где этих стикеров больше всего
    const counts: Record<string, number> = {}
    for (const c of mine) counts[s.place[c.id]] = (counts[s.place[c.id]] ?? 0) + 1
    const gid = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    const names = mine.filter((c) => s.place[c.id] === gid).slice(0, 2).map((c) => `«${c.name}»`).join(tr(' и ', ' and '))
    const scattered = Object.keys(counts).length > 1
    items.push({
      tone: 'warn',
      text: scattered
        ? tr(
            `${names} и похожие стикеры разбросаны по разным группам и везде в меньшинстве — у них свой язык и свои данные, соберите их в отдельный контекст`,
            `${names} and similar stickies are scattered across groups and are a minority everywhere; they have their own language and data, so gather them into a separate context`,
          )
        : tr(
            `В группе «${groupName(gid)}» смешаны два контекста: ${names} живут по своим правилам — вынесите их в отдельную группу`,
            `Group “${groupName(gid)}” mixes two contexts: ${names} follow their own rules, so move them into a separate group`,
          ),
    })
  }
  // до решения — не больше одного намёка про контексты, иначе замечания перечислят весь ответ
  if (!solved) {
    const warns = items.filter((i) => i.tone === 'warn')
    for (const w of warns.slice(1)) items.splice(items.indexOf(w), 1)
  }
  if (!items.length)
    items.push({ tone: 'ok', text: tr('Разбиение совпадает с эталоном: в каждом контексте свой язык и свои данные', 'The split matches the reference: each context has its own language and data') })
  if (hintsUsed) items.push({ tone: 'info', text: tr(`Подсказок использовано: ${hintsUsed}`, `Hints used: ${hintsUsed}`) })

  let score = Math.round(sc.score * 100) - 5 * hintsUsed
  if (!solved) score = Math.min(score, 40)
  score = Math.max(0, score)
  const stars = !solved ? 1 : score >= 95 ? 3 : score >= 85 ? 2 : 1
  const verdict = !solved
    ? tr('Пока не похоже на разбиение эталона', 'Not close to the reference split yet')
    : stars === 3
      ? tr('Границы проведены точно', 'Boundaries drawn precisely')
      : tr('Границы почти верные — посмотрите замечания', 'Boundaries are almost right; see the notes')
  return { score, stars: stars as 1 | 2 | 3, verdict, items }
}

/** Эталонное разбиение — для проверки и «Показать эталон» */
export function referenceState(t: PartitionTask): PartitionState {
  return {
    groups: t.contexts.map((c) => ({ id: `g-${c.id}`, name: c.name })),
    place: Object.fromEntries(t.cards.map((c) => [c.id, `g-${c.ctx}`])),
  }
}

// ---------------- карта контекстов ----------------

export function scoreMap(t: MapTask, answers: Record<string, MapPattern | undefined>): { correct: number; total: number } {
  return { correct: t.relations.filter((r) => isRightPattern(r, answers[r.id])).length, total: t.relations.length }
}

export function isRightPattern(r: MapRelation, a: MapPattern | undefined): boolean {
  return !!a && (a === r.answer || !!r.alsoOk?.includes(a))
}

export function mapStars(wrongChecks: number, hintsUsed: number): 1 | 2 | 3 {
  const penalty = wrongChecks + (hintsUsed > 1 ? 1 : 0)
  return penalty === 0 ? 3 : penalty === 1 ? 2 : 1
}
