import { tr } from '../../i18n'

/**
 * Модель конструктора: стационарный поток запросов по графу компонентов.
 * Поток несёт профиль нагрузки (транзакции, ключ-значение, поиск, аналитика, файлы),
 * и каждое хранилище обрабатывает разные профили с разной эффективностью.
 * Для каждого узла считаем входящий поток, долю отказов и латентность
 * (с поправкой на очередь: latency / (1 - загрузка)).
 */

export type Workload = 'oltp' | 'kv' | 'search' | 'analytics' | 'blob'

export const WORKLOADS: Record<Workload, { title: string; short: string }> = {
  oltp: { title: tr('Транзакции (OLTP): заказы, счета, профили', 'Transactions (OLTP): orders, invoices, profiles', '事务（OLTP）：订单、账单、用户资料'), short: 'OLTP' },
  kv: { title: tr('Чтение и запись по ключу, огромный поток', 'Key-value reads and writes at huge volume', '按键读写，流量巨大'), short: tr('ключ', 'key-value', '键值') },
  search: { title: tr('Полнотекстовый поиск и подсказки', 'Full-text search and autocomplete', '全文搜索与自动补全'), short: tr('поиск', 'search', '搜索') },
  analytics: { title: tr('Аналитика: агрегаты по миллиардам строк', 'Analytics: aggregates over billions of rows', '分析：对数十亿行数据做聚合'), short: 'OLAP' },
  blob: { title: tr('Файлы и медиа', 'Files and media', '文件和媒体'), short: tr('файлы', 'files', '文件') },
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
  /** Для client: доля запросов-записей (0..1). Кэш их не закрывает, а реплики PostgreSQL не масштабируют */
  writeShare?: number
  /** Для client: каждый запрос (пост) надо разложить по стольким лентам подписчиков — fan-out on write */
  fanout?: number
  /** Вертикальное масштабирование: размер машины ×1, ×2, ×4 (потолок — самая большая машина) */
  size?: number
  /** Шардирование PostgreSQL/MongoDB: данные и запись делятся между шардами, у каждого свой primary и реплики */
  shards?: number
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
  /** Запись масштабируется экземплярами (шарды). Иначе вся запись идёт в один primary, а экземпляры — реплики для чтения */
  writeScales?: boolean
  /** Можно взять машину крупнее (вертикальное масштабирование) */
  vertical?: boolean
  /** Можно шардировать вручную (PostgreSQL через Citus или ключ шардирования, MongoDB — нативно): максимум шардов */
  maxShards?: number
  /** Что значит «экземпляр» для этого блока: подписи в интерфейсе */
  unit: 'instances' | 'replicas' | 'nodes' | 'brokers' | 'partitions'
}

/** Размеры машины при вертикальном масштабировании: дальше ×4 растить некуда */
export const SIZES = [1, 2, 4] as const

/** Доля записей по умолчанию, если у клиента она не задана */
export const DEFAULT_WRITE: Record<Workload, number> = { oltp: 0.2, kv: 0.3, search: 0, analytics: 0, blob: 0.05 }
export function writeShareOf(n: BNode): number {
  return n.writeShare ?? DEFAULT_WRITE[n.workload ?? 'oltp']
}

export const KINDS: Record<NodeKind, KindSpec> = {
  client: {
    unit: 'instances',
    title: tr('Клиенты', 'Clients', '客户端'),
    icon: '👥',
    capacity: Infinity,
    latency: 0,
    cost: 0,
    desc: tr('Источник нагрузки', 'Source of load', '负载来源'),
    maxInstances: 1,
    group: 'Трафик',
  },
  cdn: {
    unit: 'instances',
    title: 'CDN',
    icon: '🌍',
    capacity: 1_000_000,
    latency: 5,
    cost: 150,
    desc: tr('Раздаёт файлы и медиа с серверов рядом с пользователем. Промахи идут дальше', 'Serves files and media from servers close to the user. Misses go further downstream', '从离用户最近的服务器分发文件和媒体。未命中的请求继续发往下游'),
    maxInstances: 1,
    group: 'Трафик',
  },
  lb: {
    unit: 'instances',
    title: 'Load Balancer',
    icon: '⚖️',
    capacity: 20000,
    latency: 1,
    cost: 20,
    desc: tr('Делит трафик поровну между потомками', 'Splits traffic evenly between downstream nodes', '把流量平均分给下游节点'),
    maxInstances: 4,
    group: 'Трафик',
  },
  gateway: {
    unit: 'instances',
    title: 'API Gateway',
    icon: '🚪',
    capacity: 2500,
    latency: 3,
    cost: 60,
    desc: tr('Единая точка входа, делит трафик между сервисами', 'Single entry point, splits traffic between services', '统一入口，在各个服务之间分配流量'),
    maxInstances: 8,
    group: 'Трафик',
  },
  service: {
    unit: 'instances',
    title: tr('Сервис', 'Service', '服务'),
    icon: '⚙️',
    capacity: 300,
    latency: 20,
    cost: 50,
    desc: tr('Обрабатывает запрос и вызывает потомков. Каждый тип запроса уходит в самое подходящее из подключённых хранилищ', 'Handles the request and calls downstream nodes. Each request type goes to the best-suited connected storage', '处理请求并调用下游节点。每种类型的请求都会发往已连接的存储中最合适的那个'),
    maxInstances: 40,
    group: 'Вычисления',
  },
  queue: {
    unit: 'brokers',
    title: tr('Очередь (Kafka)', 'Queue (Kafka)', '队列（Kafka）'),
    icon: '📜',
    capacity: 50000,
    latency: 5,
    cost: 150,
    desc: tr('Принимает сразу, потомки обрабатывают асинхронно в своём темпе', 'Accepts immediately; consumers process asynchronously at their own pace', '立即接收；消费者按自己的节奏异步处理'),
    maxInstances: 3,
    group: 'Вычисления',
  },
  cache: {
    unit: 'nodes',
    title: tr('Кэш (Redis)', 'Cache (Redis)', '缓存（Redis）'),
    icon: '⚡',
    capacity: 40000,
    latency: 1,
    cost: 80,
    desc: tr('Отвечает сам при попадании (OLTP, ключ, поиск), промахи передаёт дальше', 'Answers on a hit (OLTP, key-value, search), passes misses downstream', '命中时直接应答（OLTP、键值、搜索），未命中的请求转发到下游'),
    maxInstances: 3,
    group: 'Хранилища',
  },
  postgres: {
    unit: 'replicas',
    title: 'PostgreSQL',
    icon: '🐘',
    capacity: 1000,
    latency: 8,
    cost: 200,
    desc: tr('Реляционная БД: транзакции, JOIN, строгая согласованность. Экземпляры сверх первого — реплики для чтения: запись идёт только в primary', 'Relational DB: transactions, JOINs, strong consistency. Instances beyond the first are read replicas: writes go only to the primary', '关系型数据库：事务、JOIN、强一致性。第一个之外的实例都是只读副本：写入只进入 primary'),
    maxInstances: 5,
    group: 'Хранилища',
    fit: { oltp: 1, kv: 0.8, search: 0.1, analytics: 0.05, blob: 0.02 },
    vertical: true,
    maxShards: 8,
  },
  cassandra: {
    unit: 'nodes',
    title: 'Cassandra',
    icon: '👁️',
    capacity: 4000,
    latency: 5,
    cost: 250,
    desc: tr('Wide-column: огромный поток записей по ключу, линейное масштабирование. Без транзакций и JOIN', 'Wide-column: huge volume of key-based writes, linear scaling. No transactions or JOINs', '宽列存储：海量按键写入，线性扩展。没有事务，也没有 JOIN'),
    maxInstances: 8,
    group: 'Хранилища',
    fit: { kv: 1, analytics: 0.05 },
    writeScales: true,
  },
  mongo: {
    unit: 'replicas',
    title: 'MongoDB',
    icon: '🍃',
    capacity: 1500,
    latency: 6,
    cost: 220,
    desc: tr('Документная БД: гибкая схема. Экземпляры — реплики (запись в primary); транзакции есть, но дороже, чем в PostgreSQL', 'Document DB: flexible schema. Instances are replicas (writes go to the primary); transactions exist but cost more than in PostgreSQL', '文档数据库：schema 灵活。实例都是副本（写入进入 primary）；支持事务，但开销比 PostgreSQL 大'),
    maxInstances: 6,
    group: 'Хранилища',
    fit: { oltp: 0.6, kv: 0.8, search: 0.2, analytics: 0.02 },
    vertical: true,
    maxShards: 8,
  },
  elastic: {
    unit: 'nodes',
    title: 'Elasticsearch',
    icon: '🔎',
    capacity: 2000,
    latency: 15,
    cost: 300,
    desc: tr('Поисковый движок: полнотекстовый поиск, подсказки, фасеты. Не источник истины', 'Search engine: full-text search, autocomplete, facets. Not a source of truth', '搜索引擎：全文搜索、自动补全、分面筛选。不能作为数据的权威来源（source of truth）'),
    maxInstances: 6,
    group: 'Хранилища',
    fit: { search: 1, analytics: 0.1, kv: 0.3 },
    writeScales: true,
  },
  clickhouse: {
    unit: 'nodes',
    title: 'ClickHouse',
    icon: '📊',
    capacity: 300,
    latency: 50,
    cost: 300,
    desc: tr('Колоночная аналитическая БД: агрегаты по миллиардам строк за секунды. Не для точечных запросов', 'Columnar analytical DB: aggregates over billions of rows in seconds. Not for point lookups', '列式分析数据库：几秒内完成数十亿行的聚合。不适合按键点查'),
    maxInstances: 6,
    group: 'Хранилища',
    fit: { analytics: 1, kv: 0.05 },
    writeScales: true,
    vertical: true,
  },
  s3: {
    unit: 'partitions',
    title: tr('Объектное хранилище (S3)', 'Object storage (S3)', '对象存储（S3）'),
    icon: '🪣',
    capacity: 20000,
    latency: 40,
    cost: 100,
    desc: tr('Файлы и медиа любого размера, дёшево и надёжно. Не база данных', 'Files and media of any size, cheap and durable. Not a database', '任意大小的文件和媒体，便宜又可靠。不是数据库'),
    maxInstances: 5,
    group: 'Хранилища',
    fit: { blob: 1 },
    writeScales: true,
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
  /** Из входящего потока — записи, rps */
  writes: number
  /** Шардов у хранилища (1 — без шардирования) */
  shards: number
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
  /** Посты разложены по лентам подписчиков (fan-out дошёл до хранилища лент) */
  fanoutDelivered: boolean
  /** Если не разложены — где теряется больше всего постов: на перегруженном блоке или там, где путь поста кончается */
  fanoutLossAt?: { nodeId: string; overload: boolean }
}

/** Ёмкость одной машины с учётом её размера */
function perMachine(n: BNode): number {
  const spec = KINDS[n.kind]
  return (n.kind === 'service' ? (n.capacity ?? spec.capacity) : spec.capacity) * (spec.vertical ? (n.size ?? 1) : 1)
}

/** Ёмкость на чтение: все машины всех шардов */
export function baseCapacity(n: BNode): number {
  return perMachine(n) * n.instances * shardsOf(n)
}

/** Ёмкость на запись: шардированные по природе хранилища — все узлы, остальные — только primary каждого шарда */
export function writeCapacity(n: BNode): number {
  return KINDS[n.kind].writeScales ? baseCapacity(n) : perMachine(n) * shardsOf(n)
}

export function shardsOf(n: BNode): number {
  return KINDS[n.kind].maxShards ? Math.max(1, n.shards ?? 1) : 1
}

/** Цена блока: размер машины × машины × шарды */
export function nodeCost(n: BNode): number {
  const spec = KINDS[n.kind]
  return spec.cost * (spec.vertical ? (n.size ?? 1) : 1) * n.instances * shardsOf(n)
}

/** Коротко о масштабе блока: ×3 · размер ×2 · 4 шард. */
export function scaleText(n: BNode): string {
  const parts = [`×${n.instances}`]
  if ((n.size ?? 1) > 1) parts.push(tr(`размер ×${n.size}`, `size ×${n.size}`, `规格 ×${n.size}`))
  if (shardsOf(n) > 1) parts.push(tr(`${shardsOf(n)} шард.`, `${shardsOf(n)} shards`, `${shardsOf(n)} 个分片`))
  return parts.join(' · ')
}

/** Эффективность хранилища для профиля с учётом шардирования: транзакции и агрегаты через шарды дороже */
export function fitOfNode(n: BNode, w: Workload): number {
  const f = fitOf(n.kind, w)
  if (shardsOf(n) <= 1) return f
  if (w === 'oltp') return f * 0.8
  if (w === 'analytics') return f * 0.5
  return f
}

export function baseLatency(n: BNode): number {
  return n.kind === 'service' ? (n.latency ?? KINDS.service.latency) : KINDS[n.kind].latency
}

/** Профиль «внешний API» (платёжный шлюз, почтовый провайдер): данные у него свои, хранилище ему не нужно */
export const EXTERNAL_API = { capacity: 100, latency: 300 }
export function isExternalApi(n: BNode): boolean {
  return n.kind === 'service' && n.capacity === EXTERNAL_API.capacity && n.latency === EXTERNAL_API.latency
}

export function costOf(nodes: BNode[]): number {
  return nodes.reduce((s, n) => s + nodeCost(n), 0)
}

/** Загрузка узла и множитель латентности под конкретный профиль потока */
function load(n: BNode, v: Vec, wv: Vec = ZERO): { util: number; cap: number; latMul: number; unsupported: number } {
  const t = total(v)
  const cap = baseCapacity(n)
  if (!isStorage(n.kind)) return { util: t / cap, cap, latMul: 1, unsupported: 0 }
  // запись: шардированные по природе хранилища масштабируют её узлами, остальные — только primary каждого шарда
  const capW = writeCapacity(n)
  // узкое место — либо все узлы на весь поток, либо primary на запись (реплики запись не принимают)
  let utilAll = 0
  let utilW = 0
  let latMul = 0
  let unsupported = 0
  for (const w of WL) {
    if (!v[w]) continue
    const f = fitOfNode(n, w)
    if (f === 0) {
      unsupported += v[w]
      continue
    }
    utilAll += v[w] / (cap * f)
    utilW += Math.min(wv[w], v[w]) / (capW * f)
    latMul += (v[w] / t) / Math.sqrt(f)
  }
  const util = Math.max(utilAll, utilW)
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
    fanoutDelivered: true,
  }
  if (!order) return res

  const inflow: Record<string, Vec> = {}
  /** Та часть потока, что является записью: кэш её не закрывает, реплики не масштабируют */
  const inflowW: Record<string, Vec> = {}
  /** Посты, которые ещё предстоит разложить по лентам, и множитель fan-out */
  const inflowF: Record<string, number> = {}
  const FAN = Math.max(0, ...nodes.filter((n) => n.kind === 'client').map((n) => n.fanout ?? 0))
  /** Сколько записей в ленты сделал каждый сервис — синхронный fan-out задерживает ответ */
  const fanWrites: Record<string, number> = {}
  /** Посты, отброшенные перегруженным блоком, и посты, чей путь кончился, не дойдя до хранилища лент */
  const fanDrop: Record<string, number> = {}
  const fanLost: Record<string, number> = {}
  // пост несут дальше сервисы, очереди, балансировщики и шлюзы; кэш и CDN только отдают прочитанное
  const carries = (k: NodeKind) => !isStorage(k) && k !== 'cache' && k !== 'cdn'
  nodes.forEach((n) => {
    inflowF[n.id] = n.kind === 'client' && n.fanout ? (n.rps ?? 0) : 0
    inflow[n.id] = n.kind === 'client' ? { ...ZERO, [n.workload ?? 'oltp']: n.rps ?? 0 } : { ...ZERO }
    inflowW[n.id] = n.kind === 'client' ? { ...ZERO, [n.workload ?? 'oltp']: (n.rps ?? 0) * writeShareOf(n) } : { ...ZERO }
  })
  const admitShare: Record<string, number> = {}

  // 1. Прямой проход: потоки
  for (const id of order) {
    const n = byId[id]
    const v = inflow[id]
    const l = n.kind === 'client' ? { util: 0 } : load(n, v, inflowW[id])
    const a = l.util > 1 ? 1 / l.util : 1
    admitShare[id] = a
    const admitted = scale(v, a)
    const admittedW = scale(inflowW[id], a)
    const reads = (w: Workload) => Math.max(0, admitted[w] - admittedW[w])
    const admittedF = inflowF[id] * a
    const kids = children(id)
    // хранилище, куда этот сервис раскладывает посты по лентам: лучшее для «ключ-значение» среди его хранилищ
    // раскладывает тот сервис, на котором путь поста кончается: у него нет дальше очереди или другого сервиса
    const carryKids = kids.filter((k) => carries(byId[k.to].kind))
    const passesOn = carryKids.length > 0
    const feedStore =
      n.kind === 'service' && admittedF > 0 && !passesOn
        ? kids
            .map((k) => byId[k.to])
            .filter((c) => isStorage(c.kind) && fitOf(c.kind, 'kv') > 0)
            .sort((x, y) => fitOf(y.kind, 'kv') - fitOf(x.kind, 'kv'))[0]
        : undefined
    if (feedStore) fanWrites[id] = admittedF * FAN
    fanDrop[id] = inflowF[id] - admittedF
    if (admittedF > 0 && !feedStore && !passesOn) fanLost[id] = admittedF
    for (const e of kids) {
      const child = byId[e.to]
      let out: Vec = { ...ZERO }
      let outW: Vec = { ...ZERO }
      // пост, ещё не разложенный по лентам, идёт дальше по синхронным и асинхронным связям, пока не встретит хранилище лент
      const outF = !carries(child.kind) ? 0 : n.kind === 'client' || n.kind === 'lb' || n.kind === 'gateway' ? admittedF / carryKids.length : feedStore ? 0 : admittedF
      switch (n.kind) {
        case 'client':
        case 'lb':
        case 'gateway':
          out = scale(admitted, 1 / kids.length)
          outW = scale(admittedW, 1 / kids.length)
          break
        case 'service': {
          // cache-aside: если сервис сам ходит в кэш, в хранилища идут только промахи
          const asideHit = Math.max(0, ...kids.map((k) => byId[k.to]).filter((c) => c.kind === 'cache').map((c) => c.hitRatio ?? 0.8))
          // запрос уходит в самое подходящее из хранилищ сервиса: поиск — в поисковый движок, а не в PostgreSQL
          const stores = kids.map((k) => byId[k.to]).filter((c) => isStorage(c.kind))
          const best = (w: Workload) => Math.max(0, ...stores.map((c) => fitOf(c.kind, w)))
          if (isStorage(child.kind)) {
            const goes = (w: Workload) => {
              const f = fitOf(child.kind, w)
              return f > 0 && f === best(w)
            }
            // в хранилище идут промахи чтения и все записи
            out = Object.fromEntries(WL.map((w) => [w, goes(w) ? reads(w) * (CACHEABLE.includes(w) ? 1 - asideHit : 1) + admittedW[w] : 0])) as Vec
            outW = Object.fromEntries(WL.map((w) => [w, goes(w) ? admittedW[w] : 0])) as Vec
          } else {
            out = admitted
            outW = admittedW
          }
          // fan-out on write: каждый пост — запись в ленту каждого подписчика
          if (child === feedStore) {
            out = { ...out, kv: out.kv + fanWrites[id] }
            outW = { ...outW, kv: outW.kv + fanWrites[id] }
          }
          break
        }
        case 'queue':
          out = admitted
          outW = admittedW
          break
        case 'cache':
          // попадания закрывают только чтения; записи идут дальше в хранилище
          out = Object.fromEntries(WL.map((w) => [w, CACHEABLE.includes(w) ? reads(w) * (1 - (n.hitRatio ?? 0.8)) + admittedW[w] : admitted[w]])) as Vec
          outW = admittedW
          break
        case 'cdn':
          out = { ...admitted, blob: reads('blob') * (1 - (n.hitRatio ?? 0.9)) + admittedW.blob }
          outW = admittedW
          break
        default:
          out = { ...ZERO } // хранилища никого не вызывают
      }
      res.edges[e.id] = { rps: total(out), async: n.kind === 'queue' }
      inflow[e.to] = add(inflow[e.to], out)
      inflowW[e.to] = add(inflowW[e.to], outW)
      inflowF[e.to] += outF
    }
  }

  // 2. Обратный проход: успех и латентность (потомки раньше родителей)
  for (const id of [...order].reverse()) {
    const n = byId[id]
    const v = inflow[id]
    const inp = total(v)
    const l = n.kind === 'client' ? { util: 0, cap: Infinity, latMul: 1, unsupported: 0 } : load(n, v, inflowW[id])
    // раскладка поста по лентам подписчиков: ~0,5 мс на ленту — синхронно это заметно
    const own = (baseLatency(n) * l.latMul) / (1 - Math.min(l.util, 0.95)) + (fanWrites[id] ? FAN * 0.5 : 0)
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
          // кэш наполняется только из источника данных; источника нет — кэш пуст, попаданий не бывает
          success = 0
          deadEnd = true
          break
        }
        case 'service':
          // сервису неоткуда взять данные и некуда их сохранить (кроме внешнего API со своими данными)
          if (!isExternalApi(n)) {
            success = 0
            deadEnd = true
          }
          break
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
      writes: total(inflowW[id]),
      shards: shardsOf(n),
    }
    res.backlogGrowth += backlog
  }

  // fan-out дошёл до лент: записей в ленты сделано почти столько, сколько постов × подписчиков
  const fanNeed = nodes.filter((n) => n.kind === 'client' && n.fanout).reduce((s0, n) => s0 + (n.rps ?? 0) * (n.fanout ?? 0), 0)
  if (fanNeed > 0) res.fanoutDelivered = Object.values(fanWrites).reduce((a0, b0) => a0 + b0, 0) >= fanNeed * 0.99
  if (!res.fanoutDelivered) {
    const worst = (m: Record<string, number>) => Object.entries(m).sort((x, y) => y[1] - x[1])[0]
    const drop = worst(fanDrop)
    const lost = worst(fanLost)
    if (drop && drop[1] > 0 && drop[1] > (lost?.[1] ?? 0)) res.fanoutLossAt = { nodeId: drop[0], overload: true }
    else if (lost) res.fanoutLossAt = { nodeId: lost[0], overload: false }
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
