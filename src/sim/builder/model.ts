/**
 * Модель конструктора: стационарный поток запросов по графу компонентов.
 * Поток несёт профиль нагрузки (транзакции, ключ-значение, поиск, аналитика, файлы),
 * и каждое хранилище обрабатывает разные профили с разной эффективностью.
 * Для каждого узла считаем входящий поток, долю отказов и латентность
 * (с поправкой на очередь: latency / (1 - загрузка)).
 */

export type Workload = 'oltp' | 'kv' | 'search' | 'analytics' | 'blob'

export const WORKLOADS: Record<Workload, { title: string; short: string }> = {
  oltp: { title: 'Транзакции (OLTP): заказы, счета, профили', short: 'OLTP' },
  kv: { title: 'Чтение и запись по ключу, огромный поток', short: 'ключ' },
  search: { title: 'Полнотекстовый поиск и подсказки', short: 'поиск' },
  analytics: { title: 'Аналитика: агрегаты по миллиардам строк', short: 'OLAP' },
  blob: { title: 'Файлы и медиа', short: 'файлы' },
}

export type NodeKind =
  | 'client'
  | 'lb'
  | 'gateway'
  | 'service'
  | 'cache'
  | 'cdn'
  | 'queue'
  | 'postgres'
  | 'cassandra'
  | 'mongo'
  | 'elastic'
  | 'clickhouse'
  | 's3'

export interface BNode {
  id: string
  kind: NodeKind
  label: string
  x: number
  y: number
  instances: number
  rps?: number // для client
  workload?: Workload // для client
  hitRatio?: number // для cache и cdn
  capacity?: number // для service — rps на экземпляр
  latency?: number // для service — мс
}

export interface BEdge {
  id: string
  from: string
  to: string
}

export interface KindSpec {
  title: string
  icon: string
  capacity: number // rps на экземпляр
  latency: number // мс
  cost: number // $ за экземпляр в месяц
  desc: string
  maxInstances: number
  group: 'Трафик' | 'Вычисления' | 'Хранилища'
  /** Для хранилищ: насколько эффективно обрабатывается профиль (1 — родной, 0 — не умеет) */
  fit?: Partial<Record<Workload, number>>
}

export const KINDS: Record<NodeKind, KindSpec> = {
  client: {
    title: 'Клиенты',
    icon: '👥',
    capacity: Infinity,
    latency: 0,
    cost: 0,
    desc: 'Источник нагрузки',
    maxInstances: 1,
    group: 'Трафик',
  },
  cdn: {
    title: 'CDN',
    icon: '🌍',
    capacity: 1_000_000,
    latency: 5,
    cost: 150,
    desc: 'Раздаёт файлы и медиа с серверов рядом с пользователем. Промахи идут дальше',
    maxInstances: 1,
    group: 'Трафик',
  },
  lb: {
    title: 'Load Balancer',
    icon: '⚖️',
    capacity: 20000,
    latency: 1,
    cost: 20,
    desc: 'Делит трафик поровну между потомками',
    maxInstances: 4,
    group: 'Трафик',
  },
  gateway: {
    title: 'API Gateway',
    icon: '🚪',
    capacity: 2500,
    latency: 3,
    cost: 60,
    desc: 'Единая точка входа, делит трафик между сервисами',
    maxInstances: 8,
    group: 'Трафик',
  },
  service: {
    title: 'Сервис',
    icon: '⚙️',
    capacity: 300,
    latency: 20,
    cost: 50,
    desc: 'Обрабатывает запрос и вызывает потомков. Каждый тип запроса уходит в самое подходящее из подключённых хранилищ',
    maxInstances: 40,
    group: 'Вычисления',
  },
  queue: {
    title: 'Очередь (Kafka)',
    icon: '📜',
    capacity: 50000,
    latency: 5,
    cost: 150,
    desc: 'Принимает сразу, потомки обрабатывают асинхронно в своём темпе',
    maxInstances: 3,
    group: 'Вычисления',
  },
  cache: {
    title: 'Кэш (Redis)',
    icon: '⚡',
    capacity: 40000,
    latency: 1,
    cost: 80,
    desc: 'Отвечает сам при попадании (OLTP, ключ, поиск), промахи передаёт дальше',
    maxInstances: 3,
    group: 'Хранилища',
  },
  postgres: {
    title: 'PostgreSQL',
    icon: '🐘',
    capacity: 1000,
    latency: 8,
    cost: 200,
    desc: 'Реляционная БД: транзакции, JOIN, строгая согласованность. Масштабируется репликами на чтение',
    maxInstances: 5,
    group: 'Хранилища',
    fit: { oltp: 1, kv: 0.8, search: 0.1, analytics: 0.05, blob: 0.02 },
  },
  cassandra: {
    title: 'Cassandra',
    icon: '👁️',
    capacity: 4000,
    latency: 5,
    cost: 250,
    desc: 'Wide-column: огромный поток записей по ключу, линейное масштабирование. Без транзакций и JOIN',
    maxInstances: 8,
    group: 'Хранилища',
    fit: { kv: 1, analytics: 0.05 },
  },
  mongo: {
    title: 'MongoDB',
    icon: '🍃',
    capacity: 1500,
    latency: 6,
    cost: 220,
    desc: 'Документная БД: гибкая схема, шардирование. Транзакции есть, но дороже, чем в PostgreSQL',
    maxInstances: 6,
    group: 'Хранилища',
    fit: { oltp: 0.6, kv: 0.8, search: 0.2, analytics: 0.02 },
  },
  elastic: {
    title: 'Elasticsearch',
    icon: '🔎',
    capacity: 2000,
    latency: 15,
    cost: 300,
    desc: 'Поисковый движок: полнотекстовый поиск, подсказки, фасеты. Не источник истины',
    maxInstances: 6,
    group: 'Хранилища',
    fit: { search: 1, analytics: 0.1, kv: 0.3 },
  },
  clickhouse: {
    title: 'ClickHouse',
    icon: '📊',
    capacity: 300,
    latency: 50,
    cost: 300,
    desc: 'Колоночная аналитическая БД: агрегаты по миллиардам строк за секунды. Не для точечных запросов',
    maxInstances: 6,
    group: 'Хранилища',
    fit: { analytics: 1, kv: 0.05 },
  },
  s3: {
    title: 'Объектное хранилище (S3)',
    icon: '🪣',
    capacity: 20000,
    latency: 40,
    cost: 100,
    desc: 'Файлы и медиа любого размера, дёшево и надёжно. Не база данных',
    maxInstances: 5,
    group: 'Хранилища',
    fit: { blob: 1 },
  },
}

/** Профили, которые кэш умеет закрывать попаданиями */
const CACHEABLE: Workload[] = ['oltp', 'kv', 'search']

export type Vec = Record<Workload, number>
const ZERO: Vec = { oltp: 0, kv: 0, search: 0, analytics: 0, blob: 0 }
const total = (v: Vec) => v.oltp + v.kv + v.search + v.analytics + v.blob
const scale = (v: Vec, k: number): Vec => ({
  oltp: v.oltp * k,
  kv: v.kv * k,
  search: v.search * k,
  analytics: v.analytics * k,
  blob: v.blob * k,
})
const add = (a: Vec, b: Vec): Vec => ({
  oltp: a.oltp + b.oltp,
  kv: a.kv + b.kv,
  search: a.search + b.search,
  analytics: a.analytics + b.analytics,
  blob: a.blob + b.blob,
})
const WL = Object.keys(ZERO) as Workload[]

export function isStorage(kind: NodeKind): boolean {
  return !!KINDS[kind].fit
}

export function fitOf(kind: NodeKind, w: Workload): number {
  return KINDS[kind].fit?.[w] ?? 0
}

export interface NodeStats {
  in: number
  vec: Vec
  capacity: number // эффективная ёмкость под текущий профиль
  util: number
  success: number // доля успешных синхронных ответов
  latency: number // мс, включая синхронных потомков
  backlogGrowth: number // для очереди: прирост бэклога, сообщ./с
  unsupported: number // доля запросов, которые хранилище не умеет обрабатывать
  /** Блоку некуда передать запросы: шлюз без сервисов, кэш без источника, очередь без потребителей */
  deadEnd: boolean
}

export interface EdgeStats {
  rps: number
  async: boolean
}

export interface Result {
  nodes: Record<string, NodeStats>
  edges: Record<string, EdgeStats>
  clientSuccess: number
  clientLatency: number
  totalRps: number
  cost: number
  backlogGrowth: number
  cycle: boolean
  /** Доходят ли запросы клиента до хранилища, которое умеет их профиль */
  persisted: Record<string, boolean>
}

export function baseCapacity(n: BNode): number {
  const spec = KINDS[n.kind]
  return (n.kind === 'service' ? (n.capacity ?? spec.capacity) : spec.capacity) * n.instances
}

export function baseLatency(n: BNode): number {
  return n.kind === 'service' ? (n.latency ?? KINDS.service.latency) : KINDS[n.kind].latency
}

export function costOf(nodes: BNode[]): number {
  return nodes.reduce((s, n) => s + KINDS[n.kind].cost * n.instances, 0)
}

/** Загрузка узла и множитель латентности под конкретный профиль потока */
function load(n: BNode, v: Vec): { util: number; cap: number; latMul: number; unsupported: number } {
  const t = total(v)
  const cap = baseCapacity(n)
  if (!isStorage(n.kind)) return { util: t / cap, cap, latMul: 1, unsupported: 0 }
  let util = 0
  let latMul = 0
  let unsupported = 0
  for (const w of WL) {
    if (!v[w]) continue
    const f = fitOf(n.kind, w)
    if (f === 0) {
      unsupported += v[w]
      continue
    }
    util += v[w] / (cap * f)
    latMul += (v[w] / t) / Math.sqrt(f)
  }
  const supported = t - unsupported
  return {
    util,
    cap: util > 0 ? supported / util : cap,
    latMul: supported > 0 ? latMul * (t / supported) : 1,
    unsupported: t > 0 ? unsupported / t : 0,
  }
}

/** Топологическая сортировка; null, если есть цикл */
function topo(nodes: BNode[], edges: BEdge[]): string[] | null {
  const indeg: Record<string, number> = {}
  nodes.forEach((n) => (indeg[n.id] = 0))
  edges.forEach((e) => indeg[e.to]++)
  const q = nodes.filter((n) => indeg[n.id] === 0).map((n) => n.id)
  const out: string[] = []
  while (q.length) {
    const id = q.shift()!
    out.push(id)
    for (const e of edges) if (e.from === id && --indeg[e.to] === 0) q.push(e.to)
  }
  return out.length === nodes.length ? out : null
}

/** Есть ли путь по связям от from до to */
export function reaches(edges: BEdge[], from: string, to: string): boolean {
  const seen = new Set<string>()
  const stack = [from]
  while (stack.length) {
    const id = stack.pop()!
    if (id === to) return true
    if (seen.has(id)) continue
    seen.add(id)
    for (const e of edges) if (e.from === id) stack.push(e.to)
  }
  return false
}

/** Цепочка блоков от from до to (BFS) — чтобы показать, какой цикл получился бы */
export function pathBetween(edges: BEdge[], from: string, to: string): string[] | null {
  const prev = new Map<string, string>()
  const queue = [from]
  const seen = new Set([from])
  while (queue.length) {
    const id = queue.shift()!
    if (id === to) {
      const path = [to]
      while (path[0] !== from) path.unshift(prev.get(path[0])!)
      return path
    }
    for (const e of edges)
      if (e.from === id && !seen.has(e.to)) {
        seen.add(e.to)
        prev.set(e.to, id)
        queue.push(e.to)
      }
  }
  return null
}

export function wouldCycle(nodes: BNode[], edges: BEdge[], from: string, to: string): boolean {
  return topo(nodes, [...edges, { id: '_', from, to }]) === null
}

export function simulate(nodes: BNode[], edges: BEdge[]): Result {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]))
  const children = (id: string) => edges.filter((e) => e.from === id)
  const order = topo(nodes, edges)
  const res: Result = {
    nodes: {},
    edges: {},
    clientSuccess: 1,
    clientLatency: 0,
    totalRps: 0,
    cost: costOf(nodes),
    backlogGrowth: 0,
    cycle: order === null,
    persisted: {},
  }
  if (!order) return res

  const inflow: Record<string, Vec> = {}
  nodes.forEach((n) => (inflow[n.id] = n.kind === 'client' ? { ...ZERO, [n.workload ?? 'oltp']: n.rps ?? 0 } : { ...ZERO }))
  const admitShare: Record<string, number> = {}

  // 1. Прямой проход: потоки
  for (const id of order) {
    const n = byId[id]
    const v = inflow[id]
    const l = n.kind === 'client' ? { util: 0 } : load(n, v)
    const a = l.util > 1 ? 1 / l.util : 1
    admitShare[id] = a
    const admitted = scale(v, a)
    const kids = children(id)
    for (const e of kids) {
      const child = byId[e.to]
      let out: Vec = { ...ZERO }
      switch (n.kind) {
        case 'client':
        case 'lb':
        case 'gateway':
          out = scale(admitted, 1 / kids.length)
          break
        case 'service': {
          // cache-aside: если сервис сам ходит в кэш, в хранилища идут только промахи
          const asideHit = Math.max(0, ...kids.map((k) => byId[k.to]).filter((c) => c.kind === 'cache').map((c) => c.hitRatio ?? 0.8))
          // запрос уходит в самое подходящее из хранилищ сервиса: поиск — в поисковый движок, а не в PostgreSQL
          const stores = kids.map((k) => byId[k.to]).filter((c) => isStorage(c.kind))
          const best = (w: Workload) => Math.max(0, ...stores.map((c) => fitOf(c.kind, w)))
          out = isStorage(child.kind)
            ? (Object.fromEntries(
                WL.map((w) => {
                  const f = fitOf(child.kind, w)
                  return [w, f > 0 && f === best(w) ? admitted[w] * (CACHEABLE.includes(w) ? 1 - asideHit : 1) : 0]
                }),
              ) as Vec)
            : admitted
          break
        }
        case 'queue':
          out = admitted
          break
        case 'cache':
          out = Object.fromEntries(
            WL.map((w) => [w, CACHEABLE.includes(w) ? admitted[w] * (1 - (n.hitRatio ?? 0.8)) : admitted[w]]),
          ) as Vec
          break
        case 'cdn':
          out = { ...admitted, blob: admitted.blob * (1 - (n.hitRatio ?? 0.9)) }
          break
        default:
          out = { ...ZERO } // хранилища никого не вызывают
      }
      res.edges[e.id] = { rps: total(out), async: n.kind === 'queue' }
      inflow[e.to] = add(inflow[e.to], out)
    }
  }

  // 2. Обратный проход: успех и латентность (потомки раньше родителей)
  for (const id of [...order].reverse()) {
    const n = byId[id]
    const v = inflow[id]
    const inp = total(v)
    const l = n.kind === 'client' ? { util: 0, cap: Infinity, latMul: 1, unsupported: 0 } : load(n, v)
    const own = (baseLatency(n) * l.latMul) / (1 - Math.min(l.util, 0.95))
    const kidEdges = children(id)
    const kids = kidEdges.map((e) => res.nodes[e.to])
    let success = admitShare[id] * (1 - l.unsupported)
    let latency = own
    let backlog = 0
    let deadEnd = false
    if (!kids.length && inp > 0) {
      const admitted = inp * admitShare[id]
      switch (n.kind) {
        case 'lb':
        case 'gateway':
          // маршрутизатору некуда отправить запрос — клиент получает 502
          success = 0
          deadEnd = true
          break
        case 'cache':
        case 'cdn': {
          // cache-aside: промахи обрабатывает сам сервис, когда идёт в своё хранилище — это не тупик
          const parents = edges.filter((e) => e.to === id).map((e) => byId[e.from])
          const aside =
            n.kind === 'cache' &&
            parents.length > 0 &&
            parents.every((pn) => pn.kind === 'service' && children(pn.id).some((e) => isStorage(byId[e.to].kind)))
          if (aside) break
          // отвечают только попадания, промахам идти некуда
          const hit = n.hitRatio ?? (n.kind === 'cdn' ? 0.9 : 0.8)
          const served = n.kind === 'cdn' ? v.blob * hit : WL.reduce((s, w) => s + (CACHEABLE.includes(w) ? v[w] * hit : 0), 0)
          success *= served / inp
          deadEnd = true
          break
        }
        case 'queue':
          // никто не читает — всё принятое копится
          backlog = admitted
          deadEnd = true
          break
      }
    }
    if (kids.length) {
      const avgS = kids.reduce((s, k) => s + k.success, 0) / kids.length
      const avgL = kids.reduce((s, k) => s + k.latency, 0) / kids.length
      switch (n.kind) {
        case 'client':
        case 'lb':
        case 'gateway':
          success *= avgS
          latency += avgL
          break
        case 'service': {
          // вклад потомка — пропорционально доле запросов, которые до него доходят
          // (хранилище за кэшем в cache-aside видит только промахи)
          const admitted = inp * admitShare[id]
          kidEdges.forEach((e, i) => {
            const share = admitted > 0 ? Math.min(1, res.edges[e.id].rps / admitted) : 1
            success *= 1 - share + share * kids[i].success
            latency += share * kids[i].latency
          })
          // запросы, для которых среди потомков-хранилищ нет подходящего, падают
          const stores = kidEdges.map((e) => byId[e.to]).filter((c) => isStorage(c.kind))
          if (stores.length && inp > 0) {
            const orphan = WL.reduce((s, w) => s + (stores.some((c) => fitOf(c.kind, w) > 0) ? 0 : v[w]), 0)
            success *= 1 - orphan / inp
          }
          break
        }
        case 'cache':
        case 'cdn': {
          // доля промахов среди принятых запросов: только они идут дальше
          const passed = kidEdges.reduce((s, e) => s + res.edges[e.id].rps, 0) / kidEdges.length
          const admitted = inp * admitShare[id]
          const miss = admitted > 0 ? Math.min(1, passed / admitted) : 0
          success *= 1 - miss + miss * avgS
          latency += miss * avgL
          break
        }
        case 'queue': {
          // асинхронно: клиент не ждёт потомков, но бэклог растёт, если они не успевают
          const admitted = inp * admitShare[id]
          for (const e of kidEdges) {
            const k = res.nodes[e.to]
            const share = k.in > 0 ? admitted / k.in : 0
            backlog += Math.max(0, admitted - k.capacity * share)
          }
          break
        }
      }
    }
    res.nodes[id] = {
      in: inp,
      vec: v,
      capacity: l.cap,
      util: l.util,
      success,
      latency,
      backlogGrowth: backlog,
      unsupported: l.unsupported,
      deadEnd,
    }
    res.backlogGrowth += backlog
  }

  // Итог для клиентов — взвешенно по нагрузке
  const clients = nodes.filter((n) => n.kind === 'client')
  const sum = clients.reduce((s, c) => s + (c.rps ?? 0), 0)
  res.totalRps = sum
  for (const c of clients) {
    if (children(c.id).length === 0 && (c.rps ?? 0) > 0) res.nodes[c.id].success = 0
    res.persisted[c.id] = persists(c, byId, children)
  }
  if (sum > 0) {
    res.clientSuccess = clients.reduce((s, c) => s + (c.rps ?? 0) * res.nodes[c.id].success, 0) / sum
    res.clientLatency = clients.reduce((s, c) => s + (c.rps ?? 0) * res.nodes[c.id].latency, 0) / sum
  }
  return res
}

/** Доходит ли поток клиента до хранилища, умеющего его профиль */
function persists(c: BNode, byId: Record<string, BNode>, children: (id: string) => BEdge[]): boolean {
  const w = c.workload ?? 'oltp'
  const seen = new Set<string>()
  const stack = [c.id]
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    const n = byId[id]
    if (isStorage(n.kind) && n.kind !== 'cache' && fitOf(n.kind, w) > 0) return true
    for (const e of children(id)) stack.push(e.to)
  }
  return false
}
