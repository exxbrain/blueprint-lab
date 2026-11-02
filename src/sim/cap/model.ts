/**
 * CAP и кворумы: N реплик в двух дата-центрах, разрыв сети, падения узлов.
 * Запись уходит на все доступные реплики и подтверждается, когда ответили W.
 * Чтение опрашивает R реплик — в худшем случае самые отстающие (так и проверяется R + W > N).
 */

export type Dc = 'A' | 'B'

export interface CapConfig {
  n: 3 | 5
  w: number
  r: number
  /** Что делать, если доступных реплик меньше W или R */
  shortfall: 'reject' | 'sloppy'
  /** Как сводить расхождения после восстановления связи */
  resolve: 'lww' | 'merge'
}

export type Step =
  | { t: 'write'; client: Dc; item: string; note?: string }
  | { t: 'read'; client: Dc; note?: string }
  | { t: 'partition' }
  | { t: 'heal' }
  | { t: 'down'; node: number }
  | { t: 'up'; node: number }

export interface NodeState {
  id: number
  dc: Dc
  up: boolean
  items: string[]
  ts: number
}

export type Outcome = 'ok' | 'rejected' | 'stale' | 'event'

export interface StepResult {
  step: Step
  outcome: Outcome
  text: string
  nodes: NodeState[]
  partitioned: boolean
}

export interface CapMetrics {
  rejectedWrites: Record<Dc, number>
  rejectedReads: Record<Dc, number>
  staleReads: number
  lostWrites: string[]
  readLatency: number
  writeLatency: number
}

export interface CapRun {
  log: StepResult[]
  metrics: CapMetrics
  final: NodeState[]
}

export function dcOf(n: number, id: number): Dc {
  return id <= (n === 3 ? 2 : 3) ? 'A' : 'B'
}

/** Латентность растёт с числом реплик, которых нужно дождаться */
export function latencyFor(k: number): number {
  return 2 + 8 * (k - 1)
}

export function runCap(cfg: CapConfig, steps: Step[]): CapRun {
  let nodes: NodeState[] = Array.from({ length: cfg.n }, (_, i) => ({
    id: i + 1,
    dc: dcOf(cfg.n, i + 1),
    up: true,
    items: [],
    ts: 0,
  }))
  let partitioned = false
  let clock = 0
  const acked: string[] = []
  const m: CapMetrics = {
    rejectedWrites: { A: 0, B: 0 },
    rejectedReads: { A: 0, B: 0 },
    staleReads: 0,
    lostWrites: [],
    readLatency: latencyFor(cfg.r),
    writeLatency: latencyFor(cfg.w),
  }
  const log: StepResult[] = []
  const snap = () => nodes.map((x) => ({ ...x, items: [...x.items] }))
  const reachable = (dc: Dc) => nodes.filter((x) => x.up && (!partitioned || x.dc === dc))
  const fresher = (a: NodeState, b: NodeState) =>
    cfg.resolve === 'lww' ? a.ts - b.ts : a.items.length - b.items.length
  const antiEntropy = (group: NodeState[]) => {
    if (group.length < 2) return
    if (cfg.resolve === 'lww') {
      const best = group.reduce((a, b) => (b.ts > a.ts ? b : a))
      for (const x of group) {
        x.items = [...best.items]
        x.ts = best.ts
      }
    } else {
      const all = [...new Set(group.flatMap((x) => x.items))]
      const ts = Math.max(...group.map((x) => x.ts))
      for (const x of group) {
        x.items = [...all]
        x.ts = ts
      }
    }
  }
  const push = (step: Step, outcome: Outcome, text: string) => log.push({ step, outcome, text, nodes: snap(), partitioned })

  for (const step of steps) {
    clock++
    switch (step.t) {
      case 'partition':
        partitioned = true
        push(step, 'event', 'Связь между дата-центрами A и B разорвана')
        break
      case 'heal': {
        partitioned = false
        antiEntropy(nodes.filter((x) => x.up))
        push(
          step,
          'event',
          cfg.resolve === 'lww'
            ? 'Связь восстановлена: реплики выровнялись по последней записи (last write wins)'
            : 'Связь восстановлена: реплики слили свои данные',
        )
        break
      }
      case 'down':
        nodes = nodes.map((x) => (x.id === step.node ? { ...x, up: false } : x))
        push(step, 'event', `Узел ${step.node} упал`)
        break
      case 'up':
        nodes = nodes.map((x) => (x.id === step.node ? { ...x, up: true } : x))
        push(step, 'event', `Узел ${step.node} вернулся — со старыми данными`)
        break
      case 'write': {
        const reach = reachable(step.client)
        const enough = reach.length >= cfg.w
        if (!enough && (cfg.shortfall === 'reject' || reach.length === 0)) {
          m.rejectedWrites[step.client]++
          push(step, 'rejected', `Запись «${step.item}» из ${step.client} отклонена: доступно ${reach.length} реплик из нужных ${cfg.w}`)
          break
        }
        if (cfg.resolve === 'lww') {
          const base = reach.reduce((a, b) => (b.ts > a.ts ? b : a))
          const items = [...base.items, step.item]
          for (const x of reach) {
            x.items = [...items]
            x.ts = clock
          }
        } else {
          for (const x of reach) {
            if (!x.items.includes(step.item)) x.items = [...x.items, step.item]
            x.ts = clock
          }
        }
        acked.push(step.item)
        push(
          step,
          'ok',
          enough
            ? `Запись «${step.item}» из ${step.client} подтверждена: ${reach.length} реплик`
            : `Запись «${step.item}» из ${step.client} принята «небрежным» кворумом: всего ${reach.length} реплик вместо ${cfg.w}`,
        )
        break
      }
      case 'read': {
        const reach = reachable(step.client)
        if (reach.length < cfg.r && (cfg.shortfall === 'reject' || reach.length === 0)) {
          m.rejectedReads[step.client]++
          push(step, 'rejected', `Чтение из ${step.client} отклонено: доступно ${reach.length} реплик из нужных ${cfg.r}`)
          break
        }
        // худший случай: отвечают самые отстающие из доступных
        const asked = [...reach].sort(fresher).slice(0, Math.min(cfg.r, reach.length))
        const result =
          cfg.resolve === 'lww'
            ? asked.reduce((a, b) => (b.ts > a.ts ? b : a)).items
            : [...new Set(asked.flatMap((x) => x.items))]
        const missing = acked.filter((i) => !result.includes(i))
        if (missing.length) {
          m.staleReads++
          push(step, 'stale', `Чтение из ${step.client}: [${result.join(', ')}] — устарело, не видно «${missing.join('», «')}»`)
        } else push(step, 'ok', `Чтение из ${step.client}: [${result.join(', ')}] — актуально`)
        break
      }
    }
  }
  // в конце сети и узлы восстанавливаются: что из подтверждённого пропало навсегда?
  partitioned = false
  for (const x of nodes) x.up = true
  antiEntropy(nodes)
  m.lostWrites = acked.filter((i) => !nodes[0].items.includes(i))
  return { log, metrics: m, final: nodes }
}

// ---------------- задачи ----------------

export interface CapTask {
  id: string
  title: string
  brief: string[]
  steps: Step[]
  /** Настройки, которые в задаче менять нельзя */
  fixed?: Partial<CapConfig>
  start: CapConfig
  goals: { text: string; check: (run: CapRun, cfg: CapConfig) => boolean }[]
  hints: string[]
  debrief: string[]
  solution: CapConfig
}

const noStale = (r: CapRun) => r.metrics.staleReads === 0
const noLost = (r: CapRun) => r.metrics.lostWrites.length === 0
const sum = (x: Record<Dc, number>) => x.A + x.B

export const CAP_TASKS: CapTask[] = [
  {
    id: 'balance',
    title: 'Баланс счёта при разрыве сети',
    brief: [
      'Счёт клиента хранится в трёх репликах: две в дата-центре **A**, одна в **B**. Посреди дня связь между дата-центрами рвётся, и клиент пытается тратить деньги через оба.',
      'Банк не может показать неверный баланс или потерять операцию: лучше отказать в операции, чем списать деньги, которых уже нет. Но основной дата-центр A должен продолжать работать.',
    ],
    steps: [
      { t: 'write', client: 'A', item: '+1000 зарплата' },
      { t: 'partition' },
      { t: 'write', client: 'A', item: '−300 оплата', note: 'клиент платит картой' },
      { t: 'read', client: 'B', note: 'банкомат в B проверяет баланс' },
      { t: 'write', client: 'B', item: '−900 перевод', note: 'перевод через B' },
      { t: 'read', client: 'A' },
      { t: 'heal' },
      { t: 'read', client: 'A' },
    ],
    fixed: { n: 3 },
    start: { n: 3, w: 1, r: 1, shortfall: 'sloppy', resolve: 'lww' },
    goals: [
      { text: 'Ни одного устаревшего чтения баланса', check: noStale },
      { text: 'Ни одна подтверждённая операция не потеряна', check: noLost },
      { text: 'Дата-центр A продолжает работать при разрыве', check: (r) => r.metrics.rejectedWrites.A + r.metrics.rejectedReads.A === 0 },
    ],
    hints: [
      'Пока связь разорвана, B не знает про оплату в A. Если он ответит, ответ может быть неверным.',
      'Кворум с R + W > N гарантирует, что чтение пересечётся с последней записью. Какие W и R при N = 3?',
      'Если реплик не хватает, отвечать «небрежно» нельзя — нужно отказать.',
    ],
    debrief: [
      'Это CP: при разрыве (P) вы выбрали согласованность (C) и пожертвовали доступностью (A) в меньшем дата-центре. Сторона большинства (2 из 3) продолжает работать, меньшинство честно отказывает.',
      'Именно так ведут себя Raft/Paxos-системы (etcd, ZooKeeper, CockroachDB): кто в меньшинстве — тот не пишет. Для денег это правильный выбор.',
    ],
    solution: { n: 3, w: 2, r: 2, shortfall: 'reject', resolve: 'lww' },
  },
  {
    id: 'cart',
    title: 'Корзина в чёрную пятницу',
    brief: [
      'Корзина покупателя хранится в трёх репликах в двух дата-центрах. Во время распродажи связь между ними рвётся, а покупатель продолжает добавлять товары с телефона и ноутбука, которые ходят в разные дата-центры.',
      'Отказ в добавлении товара — потерянная продажа. Пусть корзина на секунду покажет не всё, но работать она должна всегда, и ни один добавленный товар не должен пропасть.',
    ],
    steps: [
      { t: 'write', client: 'A', item: 'кофе' },
      { t: 'partition' },
      { t: 'write', client: 'A', item: 'чайник', note: 'с ноутбука' },
      { t: 'write', client: 'B', item: 'кружка', note: 'с телефона' },
      { t: 'read', client: 'B' },
      { t: 'read', client: 'A' },
      { t: 'heal' },
      { t: 'read', client: 'B', note: 'оформление заказа' },
    ],
    fixed: { n: 3 },
    start: { n: 3, w: 2, r: 2, shortfall: 'reject', resolve: 'lww' },
    goals: [
      { text: 'Ни одного отказа — ни в A, ни в B', check: (r) => sum(r.metrics.rejectedWrites) + sum(r.metrics.rejectedReads) === 0 },
      { text: 'Ни один товар не потерян после восстановления связи', check: noLost },
    ],
    hints: [
      'Строгий кворум в меньшинстве отказывает — это противоречит задаче. Что если писать в те реплики, что доступны?',
      'После восстановления связи у двух сторон разные корзины. «Последняя запись побеждает» выбросит одну из них целиком.',
      'Корзина — множество товаров: два множества можно объединить без потерь.',
    ],
    debrief: [
      'Это AP: при разрыве вы выбрали доступность, а согласованность получили позже (eventual consistency). Так устроена Dynamo-корзина Amazon — пример из той самой статьи.',
      'Ключевое — способ слияния. Last write wins молча теряет данные. Слияние множеств (по сути CRDT, например OR-Set) не теряет ничего. Цена AP — короткие окна, когда стороны видят разное.',
    ],
    solution: { n: 3, w: 2, r: 2, shortfall: 'sloppy', resolve: 'merge' },
  },
  {
    id: 'quorum5',
    title: 'Пять узлов, два падают',
    brief: [
      'Кластер из пяти реплик должен переживать падение двух любых узлов без отказов и без устаревших чтений. Упавшие узлы возвращаются со старыми данными, синхронизация отстаёт.',
      'Ещё ограничение: чтение и запись — не дольше 20 мс, то есть ждать больше трёх реплик нельзя.',
    ],
    steps: [
      { t: 'write', client: 'A', item: 'v1' },
      { t: 'down', node: 1 },
      { t: 'down', node: 4 },
      { t: 'write', client: 'A', item: 'v2' },
      { t: 'write', client: 'B', item: 'v3' },
      { t: 'up', node: 1 },
      { t: 'up', node: 4 },
      { t: 'read', client: 'B' },
      { t: 'read', client: 'A' },
    ],
    fixed: { n: 5, shortfall: 'reject', resolve: 'lww' },
    start: { n: 5, w: 2, r: 2, shortfall: 'reject', resolve: 'lww' },
    goals: [
      { text: 'Ни одного отказа при двух упавших узлах', check: (r) => sum(r.metrics.rejectedWrites) + sum(r.metrics.rejectedReads) === 0 },
      { text: 'Ни одного устаревшего чтения', check: noStale },
      { text: 'Чтение и запись ≤ 20 мс', check: (r) => r.metrics.readLatency <= 20 && r.metrics.writeLatency <= 20 },
    ],
    hints: [
      'Пока два узла лежат, живых три. Сколько можно ждать при записи?',
      'Вернувшиеся узлы отстают. Чтение должно спросить столько реплик, чтобы среди них точно была свежая.',
      'R + W > N: при N = 5 и W = 3 нужно R = 3.',
    ],
    debrief: [
      'Классический кворум большинства: W = R = ⌈(N+1)/2⌉ = 3. Он переживает падение ⌊(N−1)/2⌋ = 2 узлов и гарантирует пересечение чтения с последней записью.',
      'Пять узлов вместо трёх — это не про скорость, а про то, сколько отказов вы переживаете одновременно.',
    ],
    solution: { n: 5, w: 3, r: 3, shortfall: 'reject', resolve: 'lww' },
  },
  {
    id: 'fast-read',
    title: 'Мгновенное чтение',
    brief: [
      'Каталог тарифов читают в тысячи раз чаще, чем меняют. Продукт требует, чтобы чтение отвечало за 2 мс — ждать одну реплику — и никогда не показывало устаревший тариф. Во время сбоя одного узла обновление тарифа может подождать.',
    ],
    steps: [
      { t: 'write', client: 'A', item: 'тариф v1' },
      { t: 'down', node: 3 },
      { t: 'write', client: 'A', item: 'тариф v2', note: 'обновление во время сбоя' },
      { t: 'up', node: 3 },
      { t: 'read', client: 'B' },
      { t: 'read', client: 'A' },
    ],
    fixed: { n: 3, resolve: 'lww' },
    start: { n: 3, w: 2, r: 2, shortfall: 'reject', resolve: 'lww' },
    goals: [
      { text: 'Чтение ≤ 2 мс', check: (r) => r.metrics.readLatency <= 2 },
      { text: 'Ни одного устаревшего чтения', check: noStale },
      { text: 'Чтение никогда не отказывает', check: (r) => sum(r.metrics.rejectedReads) === 0 },
    ],
    hints: [
      'Чтение за 2 мс — значит R = 1. Какую реплику спросят? Любую, в том числе отставшую.',
      'Чтобы любая реплика была свежей, запись должна дойти до всех: W = N.',
      'Платой будет отказ записи, пока узел лежит. В задаче это разрешено.',
    ],
    debrief: [
      'R = 1, W = N — read-heavy настройка: чтение быстрое и всегда свежее, зато любая упавшая реплика блокирует запись. Обратный вариант W = 1, R = N подходит для потока записей.',
      'Это и есть PACELC: даже без разрыва сети (Else) приходится выбирать между задержкой (Latency) и согласованностью (Consistency).',
    ],
    solution: { n: 3, w: 3, r: 1, shortfall: 'reject', resolve: 'lww' },
  },
]
