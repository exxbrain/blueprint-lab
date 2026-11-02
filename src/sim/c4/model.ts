/**
 * Упражнения по C4 model (Simon Brown): Context → Containers → Components → Code.
 * Ученик раскладывает карточки-кандидаты на диаграмму, задаёт тип каждого элемента,
 * ставит их внутрь или снаружи границы системы и проводит подписанные связи.
 */
import { grade, type Review, type ReviewItem } from '../review'

export type C4Kind = 'person' | 'system' | 'external' | 'container' | 'component' | 'code'
export type C4Level = 'context' | 'container' | 'component'

export const KIND_INFO: Record<C4Kind, { title: string; short: string; desc: string }> = {
  person: { title: 'Person', short: 'Человек', desc: 'Пользователь или роль: клиент, оператор, администратор' },
  system: {
    title: 'Software System',
    short: 'Наша система',
    desc: 'Система, которую мы проектируем: то, что приносит ценность пользователям',
  },
  external: {
    title: 'External System',
    short: 'Внешняя система',
    desc: 'Чужая система, которой мы пользуемся или которая пользуется нами',
  },
  container: {
    title: 'Container',
    short: 'Контейнер',
    desc: 'Отдельно запускаемое приложение или хранилище: SPA, мобильное приложение, API, БД, брокер',
  },
  component: {
    title: 'Component',
    short: 'Компонент',
    desc: 'Группа кода за общим интерфейсом внутри одного контейнера: контроллер, сервис, репозиторий',
  },
  code: { title: 'Code', short: 'Код', desc: 'Класс, таблица, функция — уровень, который почти никогда не рисуют руками' },
}

export const LEVEL_INFO: Record<C4Level, { title: string; allowed: C4Kind[] }> = {
  context: { title: 'System Context', allowed: ['person', 'system', 'external'] },
  container: { title: 'Container', allowed: ['person', 'external', 'container'] },
  component: { title: 'Component', allowed: ['person', 'external', 'container', 'component'] },
}

/** Кандидат на диаграмму */
export interface Card {
  id: string
  name: string
  desc: string
  kind: C4Kind
  /** Нужен ли на этой диаграмме */
  belongs: boolean
  /** Должен стоять внутри границы (для уровней container и component) */
  inside?: boolean
  /** Почему ловушке не место на этой диаграмме */
  why?: string
}

export interface ExpectedRel {
  from: string
  to: string
  /** Подсказка, что примерно должно быть в подписи */
  label: string
  tech?: string
}

export interface Placed {
  card: string
  x: number
  y: number
  kind: C4Kind | null
  tech: string
}

export interface Rel {
  id: string
  from: string
  to: string
  label: string
  tech: string
}

export interface DiagramState {
  placed: Placed[]
  rels: Rel[]
}

export interface C4Exercise {
  id: string
  title: string
  level: C4Level
  brief: string[]
  /** Граница системы или контейнера, внутри которой рисуем (для container и component) */
  boundary?: { name: string; kind: 'system' | 'container' }
  cards: Card[]
  rels: ExpectedRel[]
  /** Стартовая диаграмма — для упражнений «найди и исправь» */
  start?: DiagramState
  hints: string[]
  debrief: string[]
  solution: DiagramState
}

export const CANVAS = { w: 1000, h: 640 }
export const BOUNDARY = { x: 230, y: 120, w: 540, h: 430 }
export const EL_W = 170
export const EL_H = 74

export function insideBoundary(p: Placed): boolean {
  const cx = p.x + EL_W / 2
  const cy = p.y + EL_H / 2
  return cx > BOUNDARY.x && cx < BOUNDARY.x + BOUNDARY.w && cy > BOUNDARY.y && cy < BOUNDARY.y + BOUNDARY.h
}

/** Нужна ли технология у элемента и у связей на этом уровне */
export function needsTech(level: C4Level, kind: C4Kind | null): boolean {
  return level !== 'context' && (kind === 'container' || kind === 'component')
}

export function reviewDiagram(ex: C4Exercise, d: DiagramState): Review & { solved: boolean } {
  const items: ReviewItem[] = []
  const card = (id: string) => ex.cards.find((c) => c.id === id)!
  const placed = new Map(d.placed.map((p) => [p.card, p]))
  const level = LEVEL_INFO[ex.level]

  // 1. состав диаграммы
  for (const c of ex.cards) {
    const p = placed.get(c.id)
    if (c.belongs && !p) items.push({ tone: 'bad', text: `Не хватает «${c.name}»` })
    if (!c.belongs && p) items.push({ tone: 'bad', text: `«${c.name}» здесь лишний: ${c.why ?? 'не относится к этому уровню'}` })
  }

  // 2. типы элементов
  for (const p of d.placed) {
    const c = card(p.card)
    if (!c.belongs) continue
    if (!p.kind) items.push({ tone: 'bad', text: `У «${c.name}» не выбран тип элемента` })
    else if (p.kind !== c.kind)
      items.push({
        tone: 'bad',
        text: `«${c.name}» — не ${KIND_INFO[p.kind].title}, а ${KIND_INFO[c.kind].title} (${KIND_INFO[c.kind].desc})`,
      })
    else if (!level.allowed.includes(p.kind))
      items.push({ tone: 'bad', text: `${KIND_INFO[p.kind].title} не рисуют на диаграмме уровня ${level.title}` })
    if (p.kind && needsTech(ex.level, p.kind) && !p.tech.trim())
      items.push({ tone: 'warn', text: `У «${c.name}» не указана технология — на уровне ${level.title} она обязательна` })
  }

  // 3. граница
  if (ex.boundary) {
    for (const p of d.placed) {
      const c = card(p.card)
      if (!c.belongs || c.inside === undefined) continue
      const ins = insideBoundary(p)
      if (c.inside && !ins) items.push({ tone: 'bad', text: `«${c.name}» — часть «${ex.boundary.name}», его место внутри границы` })
      if (!c.inside && ins) items.push({ tone: 'bad', text: `«${c.name}» не входит в «${ex.boundary.name}» — вынесите за границу` })
    }
  }

  // 4. связи
  for (const r of ex.rels) {
    const exact = d.rels.find((x) => x.from === r.from && x.to === r.to)
    const reversed = d.rels.find((x) => x.from === r.to && x.to === r.from)
    const a = card(r.from).name
    const b = card(r.to).name
    if (!exact) {
      if (reversed)
        items.push({
          tone: 'warn',
          text: `Связь «${a}» ↔ «${b}» направлена наоборот: стрелка идёт от того, кто инициирует взаимодействие (${r.label})`,
        })
      else items.push({ tone: 'bad', text: `Нет связи «${a}» → «${b}» (${r.label})` })
      continue
    }
    if (!exact.label.trim()) items.push({ tone: 'warn', text: `Связь «${a}» → «${b}» без подписи: что именно происходит?` })
    if (ex.level !== 'context' && r.tech && !exact.tech.trim())
      items.push({ tone: 'warn', text: `У связи «${a}» → «${b}» не указан протокол или технология (например, ${r.tech})` })
  }
  for (const x of d.rels) {
    const known = ex.rels.some((r) => (r.from === x.from && r.to === x.to) || (r.from === x.to && r.to === x.from))
    if (!known && placed.has(x.from) && placed.has(x.to) && card(x.from).belongs && card(x.to).belongs)
      items.push({ tone: 'info', text: `Связь «${card(x.from).name}» → «${card(x.to).name}» в эталоне не нужна` })
  }

  const bad = items.filter((i) => i.tone === 'bad').length
  const warn = items.filter((i) => i.tone === 'warn').length
  if (!bad && !warn) items.unshift({ tone: 'ok', text: 'Диаграмма соответствует нотации C4 и задаче' })
  const r = grade(bad === 0, 1, items)
  return { ...r, solved: bad === 0 && warn === 0 }
}
