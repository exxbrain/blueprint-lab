/**
 * CAP и кворумы: N реплик в двух дата-центрах, разрыв сети, падения узлов.
 * Запись уходит на все доступные реплики и подтверждается, когда ответили W.
 * Чтение опрашивает R реплик — в худшем случае самые отстающие (так и проверяется R + W > N).
 */

import { tr } from '../../i18n'

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
        push(step, 'event', tr('Связь между дата-центрами A и B разорвана', 'Network partition between data centers A and B'))
        break
      case 'heal': {
        partitioned = false
        antiEntropy(nodes.filter((x) => x.up))
        push(
          step,
          'event',
          cfg.resolve === 'lww'
            ? tr('Связь восстановлена: реплики выровнялись по последней записи (last write wins)', 'Connection restored: replicas converged on the latest write (last write wins)')
            : tr('Связь восстановлена: реплики слили свои данные', 'Connection restored: replicas merged their data'),
        )
        break
      }
      case 'down':
        nodes = nodes.map((x) => (x.id === step.node ? { ...x, up: false } : x))
        push(step, 'event', tr(`Узел ${step.node} упал`, `Node ${step.node} went down`))
        break
      case 'up':
        nodes = nodes.map((x) => (x.id === step.node ? { ...x, up: true } : x))
        push(step, 'event', tr(`Узел ${step.node} вернулся — со старыми данными`, `Node ${step.node} is back — with stale data`))
        break
      case 'write': {
        const reach = reachable(step.client)
        const enough = reach.length >= cfg.w
        if (!enough && (cfg.shortfall === 'reject' || reach.length === 0)) {
          m.rejectedWrites[step.client]++
          push(step, 'rejected', tr(`Запись «${step.item}» из ${step.client} отклонена: доступно ${reach.length} реплик из нужных ${cfg.w}`, `Write “${step.item}” from ${step.client} rejected: ${reach.length} replicas reachable, ${cfg.w} required`))
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
            ? tr(`Запись «${step.item}» из ${step.client} подтверждена: ${reach.length} реплик`, `Write “${step.item}” from ${step.client} acknowledged: ${reach.length} replicas`)
            : tr(`Запись «${step.item}» из ${step.client} принята «небрежным» кворумом: всего ${reach.length} реплик вместо ${cfg.w}`, `Write “${step.item}” from ${step.client} accepted by a sloppy quorum: only ${reach.length} replicas instead of ${cfg.w}`),
        )
        break
      }
      case 'read': {
        const reach = reachable(step.client)
        if (reach.length < cfg.r && (cfg.shortfall === 'reject' || reach.length === 0)) {
          m.rejectedReads[step.client]++
          push(step, 'rejected', tr(`Чтение из ${step.client} отклонено: доступно ${reach.length} реплик из нужных ${cfg.r}`, `Read from ${step.client} rejected: ${reach.length} replicas reachable, ${cfg.r} required`))
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
          push(step, 'stale', tr(`Чтение из ${step.client}: [${result.join(', ')}] — устарело, не видно «${missing.join('», «')}»`, `Read from ${step.client}: [${result.join(', ')}] — stale, missing “${missing.join('”, “')}”`))
        } else push(step, 'ok', tr(`Чтение из ${step.client}: [${result.join(', ')}] — актуально`, `Read from ${step.client}: [${result.join(', ')}] — up to date`))
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
    title: tr('Баланс счёта при разрыве сети', 'Account balance during a network partition'),
    brief: tr(
      [
        'Счёт клиента хранится в трёх репликах: две в дата-центре **A**, одна в **B**. Посреди дня связь между дата-центрами рвётся, и клиент пытается тратить деньги через оба.',
        'Банк не может показать неверный баланс или потерять операцию: лучше отказать в операции, чем списать деньги, которых уже нет. Но основной дата-центр A должен продолжать работать.',
      ],
      [
        'A customer account is stored in three replicas: two in data center **A**, one in **B**. In the middle of the day the link between the data centers goes down, and the customer tries to spend money through both.',
        'The bank must never show a wrong balance or lose a transaction: better to reject an operation than to spend money that is already gone. But the primary data center A must keep working.',
      ],
    ),
    steps: [
      { t: 'write', client: 'A', item: tr('+1000 зарплата', '+1000 salary') },
      { t: 'partition' },
      { t: 'write', client: 'A', item: tr('−300 оплата', '−300 payment'), note: tr('клиент платит картой', 'customer pays by card') },
      { t: 'read', client: 'B', note: tr('банкомат в B проверяет баланс', 'an ATM in B checks the balance') },
      { t: 'write', client: 'B', item: tr('−900 перевод', '−900 transfer'), note: tr('перевод через B', 'transfer via B') },
      { t: 'read', client: 'A' },
      { t: 'heal' },
      { t: 'read', client: 'A' },
    ],
    fixed: { n: 3 },
    start: { n: 3, w: 1, r: 1, shortfall: 'sloppy', resolve: 'lww' },
    goals: [
      { text: tr('Ни одного устаревшего чтения баланса', 'No stale balance reads'), check: noStale },
      { text: tr('Ни одна подтверждённая операция не потеряна', 'No acknowledged transaction is lost'), check: noLost },
      { text: tr('Дата-центр A продолжает работать при разрыве', 'Data center A keeps working during the partition'), check: (r) => r.metrics.rejectedWrites.A + r.metrics.rejectedReads.A === 0 },
    ],
    hints: tr(
      [
        'Пока связь разорвана, B не знает про оплату в A. Если он ответит, ответ может быть неверным.',
        'Кворум с R + W > N гарантирует, что чтение пересечётся с последней записью. Какие W и R при N = 3?',
        'Если реплик не хватает, отвечать «небрежно» нельзя — нужно отказать.',
      ],
      [
        'While the link is down, B does not know about the payment in A. If it answers, the answer may be wrong.',
        'A quorum with R + W > N guarantees that a read overlaps the latest write. Which W and R for N = 3?',
        'If there are not enough replicas, a sloppy answer is not allowed — the request must be rejected.',
      ],
    ),
    debrief: tr(
      [
        'Это CP: при разрыве (P) вы выбрали согласованность (C) и пожертвовали доступностью (A) в меньшем дата-центре. Сторона большинства (2 из 3) продолжает работать, меньшинство честно отказывает.',
        'Именно так ведут себя Raft/Paxos-системы (etcd, ZooKeeper, CockroachDB): кто в меньшинстве — тот не пишет. Для денег это правильный выбор.',
      ],
      [
        'This is CP: under a partition (P) you chose consistency (C) and sacrificed availability (A) in the smaller data center. The majority side (2 of 3) keeps working, the minority honestly rejects requests.',
        'This is exactly how Raft/Paxos systems behave (etcd, ZooKeeper, CockroachDB): the minority does not write. For money, this is the right choice.',
      ],
    ),
    solution: { n: 3, w: 2, r: 2, shortfall: 'reject', resolve: 'lww' },
  },
  {
    id: 'cart',
    title: tr('Корзина в чёрную пятницу', 'Shopping cart on Black Friday'),
    brief: tr(
      [
        'Корзина покупателя хранится в трёх репликах в двух дата-центрах. Во время распродажи связь между ними рвётся, а покупатель продолжает добавлять товары с телефона и ноутбука, которые ходят в разные дата-центры.',
        'Отказ в добавлении товара — потерянная продажа. Пусть корзина на секунду покажет не всё, но работать она должна всегда, и ни один добавленный товар не должен пропасть.',
      ],
      [
        'A shopper’s cart is stored in three replicas across two data centers. During a sale the link between them goes down, while the shopper keeps adding items from a phone and a laptop that talk to different data centers.',
        'A rejected add-to-cart is a lost sale. The cart may briefly show less than everything, but it must always work, and no added item may be lost.',
      ],
    ),
    steps: [
      { t: 'write', client: 'A', item: tr('кофе', 'coffee') },
      { t: 'partition' },
      { t: 'write', client: 'A', item: tr('чайник', 'kettle'), note: tr('с ноутбука', 'from the laptop') },
      { t: 'write', client: 'B', item: tr('кружка', 'mug'), note: tr('с телефона', 'from the phone') },
      { t: 'read', client: 'B' },
      { t: 'read', client: 'A' },
      { t: 'heal' },
      { t: 'read', client: 'B', note: tr('оформление заказа', 'checkout') },
    ],
    fixed: { n: 3 },
    start: { n: 3, w: 2, r: 2, shortfall: 'reject', resolve: 'lww' },
    goals: [
      { text: tr('Ни одного отказа — ни в A, ни в B', 'No rejected requests — neither in A nor in B'), check: (r) => sum(r.metrics.rejectedWrites) + sum(r.metrics.rejectedReads) === 0 },
      { text: tr('Ни один товар не потерян после восстановления связи', 'No item is lost after the connection is restored'), check: noLost },
    ],
    hints: tr(
      [
        'Строгий кворум в меньшинстве отказывает — это противоречит задаче. Что если писать в те реплики, что доступны?',
        'После восстановления связи у двух сторон разные корзины. «Последняя запись побеждает» выбросит одну из них целиком.',
        'Корзина — множество товаров: два множества можно объединить без потерь.',
      ],
      [
        'A strict quorum rejects requests on the minority side — that contradicts the task. What if you write to whichever replicas are reachable?',
        'After the connection is restored, the two sides have different carts. “Last write wins” will throw one of them away entirely.',
        'A cart is a set of items: two sets can be merged without losing anything.',
      ],
    ),
    debrief: tr(
      [
        'Это AP: при разрыве вы выбрали доступность, а согласованность получили позже (eventual consistency). Так устроена Dynamo-корзина Amazon — пример из той самой статьи.',
        'Ключевое — способ слияния. Last write wins молча теряет данные. Слияние множеств (по сути CRDT, например OR-Set) не теряет ничего. Цена AP — короткие окна, когда стороны видят разное.',
      ],
      [
        'This is AP: under a partition you chose availability and got consistency later (eventual consistency). This is how Amazon’s Dynamo shopping cart works — the example from that very paper.',
        'The key is the merge strategy. Last write wins silently loses data. A set merge (essentially a CRDT, e.g. an OR-Set) loses nothing. The price of AP is short windows when the sides see different data.',
      ],
    ),
    solution: { n: 3, w: 2, r: 2, shortfall: 'sloppy', resolve: 'merge' },
  },
  {
    id: 'five-nodes',
    title: tr('Пять узлов, два падают', 'Five nodes, two go down'),
    brief: tr(
      [
        'Кластер из пяти реплик должен переживать падение двух любых узлов без отказов и без устаревших чтений. Упавшие узлы возвращаются со старыми данными, синхронизация отстаёт.',
        'Ещё ограничение: чтение и запись — не дольше 20 мс, то есть ждать больше трёх реплик нельзя.',
      ],
      [
        'A cluster of five replicas must survive the failure of any two nodes with no rejected requests and no stale reads. Failed nodes come back with stale data; synchronization lags behind.',
        'One more constraint: reads and writes take at most 20 ms, so you cannot wait for more than three replicas.',
      ],
    ),
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
      { text: tr('Ни одного отказа при двух упавших узлах', 'No rejected requests with two nodes down'), check: (r) => sum(r.metrics.rejectedWrites) + sum(r.metrics.rejectedReads) === 0 },
      { text: tr('Ни одного устаревшего чтения', 'No stale reads'), check: noStale },
      { text: tr('Чтение и запись ≤ 20 мс', 'Reads and writes ≤ 20 ms'), check: (r) => r.metrics.readLatency <= 20 && r.metrics.writeLatency <= 20 },
    ],
    hints: tr(
      [
        'Пока два узла лежат, живых три. Сколько можно ждать при записи?',
        'Вернувшиеся узлы отстают. Чтение должно спросить столько реплик, чтобы среди них точно была свежая.',
        'R + W > N: при N = 5 и W = 3 нужно R = 3.',
      ],
      [
        'While two nodes are down, three are alive. How many can a write wait for?',
        'Returning nodes lag behind. A read must ask enough replicas that at least one of them is guaranteed to be fresh.',
        'R + W > N: with N = 5 and W = 3 you need R = 3.',
      ],
    ),
    debrief: tr(
      [
        'Классический кворум большинства: W = R = ⌈(N+1)/2⌉ = 3. Он переживает падение ⌊(N−1)/2⌋ = 2 узлов и гарантирует пересечение чтения с последней записью.',
        'Пять узлов вместо трёх — это не про скорость, а про то, сколько отказов вы переживаете одновременно.',
      ],
      [
        'The classic majority quorum: W = R = ⌈(N+1)/2⌉ = 3. It survives the failure of ⌊(N−1)/2⌋ = 2 nodes and guarantees that a read overlaps the latest write.',
        'Five nodes instead of three is not about speed, but about how many failures you can survive at once.',
      ],
    ),
    solution: { n: 5, w: 3, r: 3, shortfall: 'reject', resolve: 'lww' },
  },
  {
    id: 'fast-read',
    title: tr('Мгновенное чтение', 'Instant reads'),
    brief: tr(
      [
        'Каталог тарифов читают в тысячи раз чаще, чем меняют. Продукт требует, чтобы чтение отвечало за 2 мс — ждать одну реплику — и никогда не показывало устаревший тариф. Во время сбоя одного узла обновление тарифа может подождать.',
      ],
      [
        'The pricing plan catalog is read thousands of times more often than it changes. Product requires reads to answer in 2 ms — waiting for a single replica — and never show a stale plan. While one node is down, a plan update can wait.',
      ],
    ),
    steps: [
      { t: 'write', client: 'A', item: tr('тариф v1', 'plan v1') },
      { t: 'down', node: 3 },
      { t: 'write', client: 'A', item: tr('тариф v2', 'plan v2'), note: tr('обновление во время сбоя', 'update during the outage') },
      { t: 'up', node: 3 },
      { t: 'read', client: 'B' },
      { t: 'read', client: 'A' },
    ],
    fixed: { n: 3, resolve: 'lww' },
    start: { n: 3, w: 2, r: 2, shortfall: 'reject', resolve: 'lww' },
    goals: [
      { text: tr('Чтение ≤ 2 мс', 'Reads ≤ 2 ms'), check: (r) => r.metrics.readLatency <= 2 },
      { text: tr('Ни одного устаревшего чтения', 'No stale reads'), check: noStale },
      { text: tr('Чтение никогда не отказывает', 'Reads are never rejected'), check: (r) => sum(r.metrics.rejectedReads) === 0 },
    ],
    hints: tr(
      [
        'Чтение за 2 мс — значит R = 1. Какую реплику спросят? Любую, в том числе отставшую.',
        'Чтобы любая реплика была свежей, запись должна дойти до всех: W = N.',
        'Платой будет отказ записи, пока узел лежит. В задаче это разрешено.',
      ],
      [
        'A 2 ms read means R = 1. Which replica gets asked? Any of them, including one that lags behind.',
        'For every replica to be fresh, a write must reach all of them: W = N.',
        'The price is rejected writes while a node is down. The task allows that.',
      ],
    ),
    debrief: tr(
      [
        'R = 1, W = N — read-heavy настройка: чтение быстрое и всегда свежее, зато любая упавшая реплика блокирует запись. Обратный вариант W = 1, R = N подходит для потока записей.',
        'Это и есть PACELC: даже без разрыва сети (Else) приходится выбирать между задержкой (Latency) и согласованностью (Consistency).',
      ],
      [
        'R = 1, W = N is a read-heavy setup: reads are fast and always fresh, but any failed replica blocks writes. The opposite, W = 1, R = N, suits a write-heavy stream.',
        'This is PACELC: even without a network partition (Else) you have to choose between latency (Latency) and consistency (Consistency).',
      ],
    ),
    solution: { n: 3, w: 3, r: 1, shortfall: 'reject', resolve: 'lww' },
  },
]
