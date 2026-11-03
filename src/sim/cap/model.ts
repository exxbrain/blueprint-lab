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
        push(step, 'event', tr('Связь между дата-центрами A и B разорвана', 'Network partition between data centers A and B', '数据中心 A 与 B 之间发生网络分区'))
        break
      case 'heal': {
        partitioned = false
        antiEntropy(nodes.filter((x) => x.up))
        push(
          step,
          'event',
          cfg.resolve === 'lww'
            ? tr('Связь восстановлена: реплики выровнялись по последней записи (last write wins)', 'Connection restored: replicas converged on the latest write (last write wins)', '连接已恢复：各副本按最后一次写入对齐（last write wins）')
            : tr('Связь восстановлена: реплики слили свои данные', 'Connection restored: replicas merged their data', '连接已恢复：各副本合并了各自的数据'),
        )
        break
      }
      case 'down':
        nodes = nodes.map((x) => (x.id === step.node ? { ...x, up: false } : x))
        push(step, 'event', tr(`Узел ${step.node} упал`, `Node ${step.node} went down`, `节点 ${step.node} 宕机了`))
        break
      case 'up':
        nodes = nodes.map((x) => (x.id === step.node ? { ...x, up: true } : x))
        push(step, 'event', tr(`Узел ${step.node} вернулся — со старыми данными`, `Node ${step.node} is back — with stale data`, `节点 ${step.node} 恢复了，但数据是旧的`))
        break
      case 'write': {
        const reach = reachable(step.client)
        const enough = reach.length >= cfg.w
        if (!enough && (cfg.shortfall === 'reject' || reach.length === 0)) {
          m.rejectedWrites[step.client]++
          push(step, 'rejected', tr(`Запись «${step.item}» из ${step.client} отклонена: доступно ${reach.length} реплик из нужных ${cfg.w}`, `Write “${step.item}” from ${step.client} rejected: ${reach.length} replicas reachable, ${cfg.w} required`, `来自 ${step.client} 的写入“${step.item}”被拒绝：可达副本 ${reach.length} 个，需要 ${cfg.w} 个`))
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
            ? tr(`Запись «${step.item}» из ${step.client} подтверждена: ${reach.length} реплик`, `Write “${step.item}” from ${step.client} acknowledged: ${reach.length} replicas`, `来自 ${step.client} 的写入“${step.item}”已确认：${reach.length} 个副本`)
            : tr(`Запись «${step.item}» из ${step.client} принята «небрежным» кворумом: всего ${reach.length} реплик вместо ${cfg.w}`, `Write “${step.item}” from ${step.client} accepted by a sloppy quorum: only ${reach.length} replicas instead of ${cfg.w}`, `来自 ${step.client} 的写入“${step.item}”被宽松法定人数（sloppy quorum）接受：只有 ${reach.length} 个副本，而不是 ${cfg.w} 个`),
        )
        break
      }
      case 'read': {
        const reach = reachable(step.client)
        if (reach.length < cfg.r && (cfg.shortfall === 'reject' || reach.length === 0)) {
          m.rejectedReads[step.client]++
          push(step, 'rejected', tr(`Чтение из ${step.client} отклонено: доступно ${reach.length} реплик из нужных ${cfg.r}`, `Read from ${step.client} rejected: ${reach.length} replicas reachable, ${cfg.r} required`, `来自 ${step.client} 的读取被拒绝：可达副本 ${reach.length} 个，需要 ${cfg.r} 个`))
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
          push(step, 'stale', tr(`Чтение из ${step.client}: [${result.join(', ')}] — устарело, не видно «${missing.join('», «')}»`, `Read from ${step.client}: [${result.join(', ')}] — stale, missing “${missing.join('”, “')}”`, `来自 ${step.client} 的读取：[${result.join(', ')}]，数据已过期，缺少“${missing.join('”, “')}”`))
        } else push(step, 'ok', tr(`Чтение из ${step.client}: [${result.join(', ')}] — актуально`, `Read from ${step.client}: [${result.join(', ')}] — up to date`, `来自 ${step.client} 的读取：[${result.join(', ')}]，数据是最新的`))
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
    title: tr('Баланс счёта при разрыве сети', 'Account balance during a network partition', '网络分区时的账户余额'),
    brief: tr(
      [
        'Счёт клиента хранится в трёх репликах: две в дата-центре **A**, одна в **B**. Посреди дня связь между дата-центрами рвётся, и клиент пытается тратить деньги через оба.',
        'Банк не может показать неверный баланс или потерять операцию: лучше отказать в операции, чем списать деньги, которых уже нет. Но основной дата-центр A должен продолжать работать.',
      ],
      [
        'A customer account is stored in three replicas: two in data center **A**, one in **B**. In the middle of the day the link between the data centers goes down, and the customer tries to spend money through both.',
        'The bank must never show a wrong balance or lose a transaction: better to reject an operation than to spend money that is already gone. But the primary data center A must keep working.',
      ],
      [
        '客户账户存储在三个副本中：两个在数据中心 **A**，一个在 **B**。白天某个时刻，两个数据中心之间的链路断了，而客户试图通过两边花钱。',
        '银行绝不能显示错误的余额，也不能丢失交易：宁可拒绝操作，也不能花掉已经不存在的钱。但主数据中心 A 必须继续工作。',
      ],
    ),
    steps: [
      { t: 'write', client: 'A', item: tr('+1000 зарплата', '+1000 salary', '+1000 工资') },
      { t: 'partition' },
      { t: 'write', client: 'A', item: tr('−300 оплата', '−300 payment', '−300 付款'), note: tr('клиент платит картой', 'customer pays by card', '客户刷卡付款') },
      { t: 'read', client: 'B', note: tr('банкомат в B проверяет баланс', 'an ATM in B checks the balance', 'B 中的 ATM 查询余额') },
      { t: 'write', client: 'B', item: tr('−900 перевод', '−900 transfer', '−900 转账'), note: tr('перевод через B', 'transfer via B', '通过 B 转账') },
      { t: 'read', client: 'A' },
      { t: 'heal' },
      { t: 'read', client: 'A' },
    ],
    fixed: { n: 3 },
    start: { n: 3, w: 1, r: 1, shortfall: 'sloppy', resolve: 'lww' },
    goals: [
      { text: tr('Ни одного устаревшего чтения баланса', 'No stale balance reads', '没有一次读到过期余额'), check: noStale },
      { text: tr('Ни одна подтверждённая операция не потеряна', 'No acknowledged transaction is lost', '已确认的交易一笔都不丢失'), check: noLost },
      { text: tr('Дата-центр A продолжает работать при разрыве', 'Data center A keeps working during the partition', '分区期间数据中心 A 照常工作'), check: (r) => r.metrics.rejectedWrites.A + r.metrics.rejectedReads.A === 0 },
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
      [
        '链路中断期间，B 不知道 A 中发生的付款。如果 B 作答，答案可能是错的。',
        '满足 R + W > N 的法定人数能保证读取与最新写入有交集。N = 3 时，W 和 R 应该取多少？',
        '如果副本不够，就不能“将就”作答，必须拒绝请求。',
      ],
    ),
    debrief: tr(
      [
        'Это CP: при разрыве (P) вы выбрали согласованность (C) и пожертвовали доступностью (A) в меньшем дата-центре. Сторона большинства (2 из 3) продолжает работать, меньшинство честно отказывает.',
        'Похоже ведут себя Raft/Paxos-системы (etcd, ZooKeeper, CockroachDB): кто в меньшинстве — тот не пишет. Но кворум R + W > N без лидера — ещё не линеаризуемость: конкурентные записи, расхождение часов и LWW по-прежнему дают аномалии (Kleppmann, DDIA, гл. 9). Настоящие CP-системы используют консенсус с лидером, а для денег нужна ещё условная запись или проверка инварианта («баланс не меньше нуля»).',
      ],
      [
        'This is CP: under a partition (P) you chose consistency (C) and sacrificed availability (A) in the smaller data center. The majority side (2 of 3) keeps working, the minority honestly rejects requests.',
        'Raft/Paxos systems behave similarly (etcd, ZooKeeper, CockroachDB): the minority does not write. But a leaderless R + W > N quorum is not yet linearizability: concurrent writes, clock skew and LWW still produce anomalies (Kleppmann, DDIA, ch. 9). Real CP systems use leader-based consensus, and money also needs a conditional write or an invariant check (“the balance never goes below zero”).',
      ],
      [
        '这就是 CP：在分区（P）时，你选择了一致性（C），牺牲了较小数据中心的可用性（A）。多数派一侧（3 个中的 2 个）继续工作，少数派则老老实实地拒绝请求。',
        'Raft/Paxos 系统（etcd、ZooKeeper、CockroachDB）的行为与此类似：少数派不写入。但无领导者的 R + W > N 法定人数还算不上线性一致性：并发写入、时钟偏差和 LWW 仍会产生异常（Kleppmann，《DDIA》第 9 章）。真正的 CP 系统使用基于领导者的共识，而涉及钱的场景还需要条件写入或不变量检查（“余额永远不低于零”）。',
      ],
    ),
    solution: { n: 3, w: 2, r: 2, shortfall: 'reject', resolve: 'lww' },
  },
  {
    id: 'cart',
    title: tr('Корзина в чёрную пятницу', 'Shopping cart on Black Friday', '黑色星期五的购物车'),
    brief: tr(
      [
        'Корзина покупателя хранится в трёх репликах в двух дата-центрах. Во время распродажи связь между ними рвётся, а покупатель продолжает добавлять товары с телефона и ноутбука, которые ходят в разные дата-центры.',
        'Отказ в добавлении товара — потерянная продажа. Пусть корзина на секунду покажет не всё, но работать она должна всегда, и ни один добавленный товар не должен пропасть.',
      ],
      [
        'A shopper’s cart is stored in three replicas across two data centers. During a sale the link between them goes down, while the shopper keeps adding items from a phone and a laptop that talk to different data centers.',
        'A rejected add-to-cart is a lost sale. The cart may briefly show less than everything, but it must always work, and no added item may be lost.',
      ],
      [
        '顾客的购物车存储在两个数据中心的三个副本中。促销期间，两个数据中心之间的链路断了，而顾客还在用手机和笔记本电脑继续加购商品，这两台设备连接的是不同的数据中心。',
        '加购被拒绝就等于丢了一单生意。购物车可以短暂地显示不全，但必须始终可用，而且加进去的商品一件都不能丢。',
      ],
    ),
    steps: [
      { t: 'write', client: 'A', item: tr('кофе', 'coffee', '咖啡') },
      { t: 'partition' },
      { t: 'write', client: 'A', item: tr('чайник', 'kettle', '水壶'), note: tr('с ноутбука', 'from the laptop', '用笔记本电脑') },
      { t: 'write', client: 'B', item: tr('кружка', 'mug', '马克杯'), note: tr('с телефона', 'from the phone', '用手机') },
      { t: 'read', client: 'B' },
      { t: 'read', client: 'A' },
      { t: 'heal' },
      { t: 'read', client: 'B', note: tr('оформление заказа', 'checkout', '结账下单') },
    ],
    fixed: { n: 3 },
    start: { n: 3, w: 2, r: 2, shortfall: 'reject', resolve: 'lww' },
    goals: [
      { text: tr('Ни одного отказа — ни в A, ни в B', 'No rejected requests — neither in A nor in B', '无论 A 还是 B，都没有请求被拒绝'), check: (r) => sum(r.metrics.rejectedWrites) + sum(r.metrics.rejectedReads) === 0 },
      { text: tr('Ни один товар не потерян после восстановления связи', 'No item is lost after the connection is restored', '连接恢复后没有任何商品丢失'), check: noLost },
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
      [
        '严格的法定人数会让少数派一侧拒绝请求，这与任务要求相矛盾。如果写入当前能连上的那些副本呢？',
        '连接恢复后，两侧的购物车各不相同。“最后写入者胜”（last write wins）会把其中一个整个扔掉。',
        '购物车是商品的集合：两个集合可以合并，而且不丢任何东西。',
      ],
    ),
    debrief: tr(
      [
        'Это AP: при разрыве вы выбрали доступность, а согласованность получили позже (eventual consistency). Так устроена Dynamo-корзина Amazon — пример из той самой статьи.',
        'Ключевое — способ слияния. Last write wins молча теряет данные. Простое объединение множеств ничего не теряет, но у него обратная беда: удалённый товар «воскресает», если другая сторона его ещё видела — известная аномалия корзины Dynamo. Её лечит OR-Set (CRDT, который помнит удаления). Цена AP — короткие окна, когда стороны видят разное.',
      ],
      [
        'This is AP: under a partition you chose availability and got consistency later (eventual consistency). This is how Amazon’s Dynamo shopping cart works — the example from that very paper.',
        'The key is the merge strategy. Last write wins silently loses data. A plain set union loses nothing, but has the opposite problem: a removed item “comes back” if the other side still saw it, a known anomaly of the Dynamo cart. An OR-Set (a CRDT that remembers removals) fixes it. The price of AP is short windows when the sides see different data.',
      ],
      [
        '这就是 AP：在分区时你选择了可用性，一致性则稍后才达成（最终一致性，eventual consistency）。Amazon 基于 Dynamo 的购物车就是这样工作的，这正是那篇论文里的例子。',
        '关键在于合并策略。Last write wins 会悄无声息地丢数据。简单的集合并集什么都不丢，却有相反的问题：如果另一侧还看得到某件已删除的商品，它就会“复活”，这是 Dynamo 购物车的著名异常。OR-Set（一种会记住删除操作的 CRDT）可以解决这个问题。AP 的代价是：会有短暂的时间窗口，两侧看到的数据不一样。',
      ],
    ),
    solution: { n: 3, w: 2, r: 2, shortfall: 'sloppy', resolve: 'merge' },
  },
  {
    id: 'five-nodes',
    title: tr('Пять узлов, два падают', 'Five nodes, two go down', '五个节点，两个宕机'),
    brief: tr(
      [
        'Кластер из пяти реплик должен переживать падение двух любых узлов без отказов и без устаревших чтений. Упавшие узлы возвращаются со старыми данными, синхронизация отстаёт.',
        'Ещё ограничение: чтение и запись — не дольше 20 мс, то есть ждать больше трёх реплик нельзя.',
      ],
      [
        'A cluster of five replicas must survive the failure of any two nodes with no rejected requests and no stale reads. Failed nodes come back with stale data; synchronization lags behind.',
        'One more constraint: reads and writes take at most 20 ms, so you cannot wait for more than three replicas.',
      ],
      [
        '一个由五个副本组成的集群，必须在任意两个节点故障时既不拒绝请求，也不出现过期读取。故障节点恢复时带着旧数据，同步也跟不上。',
        '还有一个限制：读和写都不能超过 20 ms，也就是说最多只能等三个副本。',
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
      { text: tr('Ни одного отказа при двух упавших узлах', 'No rejected requests with two nodes down', '两个节点宕机时没有任何请求被拒绝'), check: (r) => sum(r.metrics.rejectedWrites) + sum(r.metrics.rejectedReads) === 0 },
      { text: tr('Ни одного устаревшего чтения', 'No stale reads', '没有任何过期读取'), check: noStale },
      { text: tr('Чтение и запись ≤ 20 мс', 'Reads and writes ≤ 20 ms', '读和写 ≤ 20 ms'), check: (r) => r.metrics.readLatency <= 20 && r.metrics.writeLatency <= 20 },
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
      [
        '两个节点宕机时，还有三个活着。写入最多能等几个副本？',
        '恢复的节点数据落后。读取必须询问足够多的副本，确保其中至少有一个是最新的。',
        'R + W > N：N = 5、W = 3 时，需要 R = 3。',
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
      [
        '经典的多数派法定人数：W = R = ⌈(N+1)/2⌉ = 3。它能承受 ⌊(N−1)/2⌋ = 2 个节点故障，并保证读取与最新写入有交集。',
        '用五个节点而不是三个，不是为了速度，而是为了能同时承受更多故障。',
      ],
    ),
    solution: { n: 5, w: 3, r: 3, shortfall: 'reject', resolve: 'lww' },
  },
  {
    id: 'fast-read',
    title: tr('Мгновенное чтение', 'Instant reads', '瞬时读取'),
    brief: tr(
      [
        'Каталог тарифов читают в тысячи раз чаще, чем меняют. Продукт требует, чтобы чтение отвечало за 2 мс — ждать одну реплику — и никогда не показывало устаревший тариф. Во время сбоя одного узла обновление тарифа может подождать.',
      ],
      [
        'The pricing plan catalog is read thousands of times more often than it changes. Product requires reads to answer in 2 ms — waiting for a single replica — and never show a stale plan. While one node is down, a plan update can wait.',
      ],
      [
        '资费套餐目录被读取的次数是修改次数的数千倍。产品要求读取在 2 ms 内返回（只等一个副本），并且永远不能显示过期的套餐。某个节点宕机期间，套餐更新可以等一等。',
      ],
    ),
    steps: [
      { t: 'write', client: 'A', item: tr('тариф v1', 'plan v1', '套餐 v1') },
      { t: 'down', node: 3 },
      { t: 'write', client: 'A', item: tr('тариф v2', 'plan v2', '套餐 v2'), note: tr('обновление во время сбоя', 'update during the outage', '故障期间的更新') },
      { t: 'up', node: 3 },
      { t: 'read', client: 'B' },
      { t: 'read', client: 'A' },
    ],
    fixed: { n: 3, resolve: 'lww' },
    start: { n: 3, w: 2, r: 2, shortfall: 'reject', resolve: 'lww' },
    goals: [
      { text: tr('Чтение ≤ 2 мс', 'Reads ≤ 2 ms', '读取 ≤ 2 ms'), check: (r) => r.metrics.readLatency <= 2 },
      { text: tr('Ни одного устаревшего чтения', 'No stale reads', '没有任何过期读取'), check: noStale },
      { text: tr('Чтение никогда не отказывает', 'Reads are never rejected', '读取从不被拒绝'), check: (r) => sum(r.metrics.rejectedReads) === 0 },
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
      [
        '2 ms 的读取意味着 R = 1。会询问哪个副本？任意一个，包括落后的那个。',
        '要让每个副本都是最新的，写入必须到达所有副本：W = N。',
        '代价是节点宕机期间写入会被拒绝。任务允许这样做。',
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
      [
        'R = 1、W = N 是读多写少的配置：读取快且总是最新的，但任何一个副本故障都会阻塞写入。反过来的 W = 1、R = N 则适合写入密集的数据流。',
        '这就是 PACELC：即使没有网络分区（Else），也必须在延迟（Latency）和一致性（Consistency）之间做选择。',
      ],
    ),
    solution: { n: 3, w: 3, r: 1, shortfall: 'reject', resolve: 'lww' },
  },
]
