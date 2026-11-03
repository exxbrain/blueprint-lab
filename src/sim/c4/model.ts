/**
 * Упражнения по C4 model (Simon Brown): Context → Containers → Components → Code.
 * Ученик раскладывает карточки-кандидаты на диаграмму, задаёт тип каждого элемента,
 * ставит их внутрь или снаружи границы системы и проводит подписанные связи.
 */
import { tr } from '../../i18n'
import { grade, type Review, type ReviewItem } from '../review'

export type C4Kind = 'person' | 'system' | 'external' | 'container' | 'component' | 'code'
export type C4Level = 'context' | 'container' | 'component'

export const KIND_INFO: Record<C4Kind, { title: string; short: string; desc: string }> = {
  person: { title: 'Person', short: tr('Человек', 'Person', '人员'), desc: tr('Пользователь или роль: клиент, оператор, администратор', 'A user or role: customer, operator, administrator', '用户或角色：客户、操作员、管理员') },
  system: {
    title: 'Software System',
    short: tr('Наша система', 'Our system', '我们的系统'),
    desc: tr('Система, которую мы проектируем: то, что приносит ценность пользователям', 'The system we are designing: the thing that delivers value to its users', '我们正在设计的系统：为用户创造价值的那个系统'),
  },
  external: {
    title: 'External System',
    short: tr('Внешняя система', 'External system', '外部系统'),
    desc: tr('Чужая система, которой мы пользуемся или которая пользуется нами', 'Someone else\'s system that we use or that uses us', '别人的系统：我们使用它，或者它使用我们'),
  },
  container: {
    title: 'Container',
    short: tr('Контейнер', 'Container', '容器'),
    desc: tr('Отдельно запускаемое приложение или хранилище: SPA, мобильное приложение, API, БД, брокер', 'A separately runnable application or data store: SPA, mobile app, API, database, broker', '可独立运行的应用或数据存储：SPA、移动应用、API、数据库、Broker'),
  },
  component: {
    title: 'Component',
    short: tr('Компонент', 'Component', '组件'),
    desc: tr('Группа кода за общим интерфейсом внутри одного контейнера: контроллер, сервис, репозиторий', 'A grouping of code behind a well-defined interface inside one container: controller, service, repository', '同一容器内、隐藏在明确接口背后的一组代码：控制器、服务、仓储'),
  },
  code: { title: 'Code', short: tr('Код', 'Code', '代码'), desc: tr('Класс, таблица, функция — уровень, который почти никогда не рисуют руками', 'A class, table, function — a level that is almost never drawn by hand', '类、表、函数——这一层级几乎从不手工绘制') },
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
    if (c.belongs && !p) items.push({ tone: 'bad', text: tr(`Не хватает «${c.name}»`, `Missing “${c.name}”`, `缺少“${c.name}”`) })
    if (!c.belongs && p) items.push({ tone: 'bad', text: tr(`«${c.name}» здесь лишний: ${c.why ?? 'не относится к этому уровню'}`, `“${c.name}” does not belong here: ${c.why ?? 'not part of this level'}`, `“${c.name}”不应出现在这里：${c.why ?? '不属于这一层级'}`) })
  }

  // 2. типы элементов
  for (const p of d.placed) {
    const c = card(p.card)
    if (!c.belongs) continue
    if (!p.kind) items.push({ tone: 'bad', text: tr(`У «${c.name}» не выбран тип элемента`, `“${c.name}” has no element type selected`, `“${c.name}”尚未选择元素类型`) })
    else if (p.kind !== c.kind)
      items.push({
        tone: 'bad',
        text: tr(
          `«${c.name}» — не ${KIND_INFO[p.kind].title}, а ${KIND_INFO[c.kind].title} (${KIND_INFO[c.kind].desc})`,
          `“${c.name}” is not a ${KIND_INFO[p.kind].title} but a ${KIND_INFO[c.kind].title} (${KIND_INFO[c.kind].desc})`,
          `“${c.name}”不是 ${KIND_INFO[p.kind].title}，而是 ${KIND_INFO[c.kind].title}（${KIND_INFO[c.kind].desc}）`,
        ),
      })
    else if (!level.allowed.includes(p.kind))
      items.push({ tone: 'bad', text: tr(`${KIND_INFO[p.kind].title} не рисуют на диаграмме уровня ${level.title}`, `A ${KIND_INFO[p.kind].title} is not drawn on a ${level.title} diagram`, `${level.title} 图中不绘制 ${KIND_INFO[p.kind].title}`) })
    if (p.kind && needsTech(ex.level, p.kind) && !p.tech.trim())
      items.push({ tone: 'warn', text: tr(`У «${c.name}» не указана технология — на уровне ${level.title} она обязательна`, `“${c.name}” has no technology — it is required at the ${level.title} level`, `“${c.name}”未注明技术——在 ${level.title} 层级这是必填项`) })
  }

  // 3. граница
  if (ex.boundary) {
    for (const p of d.placed) {
      const c = card(p.card)
      if (!c.belongs || c.inside === undefined) continue
      const ins = insideBoundary(p)
      if (c.inside && !ins) items.push({ tone: 'bad', text: tr(`«${c.name}» — часть «${ex.boundary.name}», его место внутри границы`, `“${c.name}” is part of “${ex.boundary.name}” — it belongs inside the boundary`, `“${c.name}”属于“${ex.boundary.name}”——应放在边界之内`) })
      if (!c.inside && ins) items.push({ tone: 'bad', text: tr(`«${c.name}» не входит в «${ex.boundary.name}» — вынесите за границу`, `“${c.name}” is not part of “${ex.boundary.name}” — move it outside the boundary`, `“${c.name}”不属于“${ex.boundary.name}”——请把它移到边界之外`) })
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
          text: tr(
            `Связь «${a}» ↔ «${b}» направлена наоборот: стрелка идёт от того, кто инициирует взаимодействие (${r.label})`,
            `The relationship “${a}” ↔ “${b}” points the wrong way: the arrow goes from whoever initiates the interaction (${r.label})`,
            `“${a}” ↔ “${b}”的关系方向反了：箭头应从发起交互的一方指出（${r.label}）`,
          ),
        })
      else items.push({ tone: 'bad', text: tr(`Нет связи «${a}» → «${b}» (${r.label})`, `Missing relationship “${a}” → “${b}” (${r.label})`, `缺少关系“${a}” → “${b}”（${r.label}）`) })
      continue
    }
    if (!exact.label.trim()) items.push({ tone: 'warn', text: tr(`Связь «${a}» → «${b}» без подписи: что именно происходит?`, `Relationship “${a}” → “${b}” has no label: what exactly happens?`, `关系“${a}” → “${b}”没有标注：具体发生了什么？`) })
    if (ex.level !== 'context' && r.tech && !exact.tech.trim())
      items.push({ tone: 'warn', text: tr(`У связи «${a}» → «${b}» не указан протокол или технология (например, ${r.tech})`, `Relationship “${a}” → “${b}” has no protocol or technology (e.g. ${r.tech})`, `关系“${a}” → “${b}”未注明协议或技术（例如 ${r.tech}）`) })
  }
  for (const x of d.rels) {
    const known = ex.rels.some((r) => (r.from === x.from && r.to === x.to) || (r.from === x.to && r.to === x.from))
    if (!known && placed.has(x.from) && placed.has(x.to) && card(x.from).belongs && card(x.to).belongs)
      items.push({ tone: 'info', text: tr(`Связь «${card(x.from).name}» → «${card(x.to).name}» в эталоне не нужна`, `Relationship “${card(x.from).name}” → “${card(x.to).name}” is not in the reference diagram`, `参考答案中没有关系“${card(x.from).name}” → “${card(x.to).name}”`) })
  }

  const bad = items.filter((i) => i.tone === 'bad').length
  const warn = items.filter((i) => i.tone === 'warn').length
  if (!bad && !warn) items.unshift({ tone: 'ok', text: tr('Диаграмма соответствует нотации C4 и задаче', 'The diagram follows C4 notation and matches the task', '图表符合 C4 表示法，也与任务要求一致') })
  const r = grade(bad === 0, 1, items)
  return { ...r, solved: bad === 0 && warn === 0 }
}
