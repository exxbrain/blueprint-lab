/**
 * Эмуляция живого трафика поверх модели конструктора: настоящие запросы, операции блоков
 * и настоящие ошибки — ровно там, где их предсказывает модель (перегрузка, тупик,
 * неподходящее хранилище, медленный запрос, отставание консьюмеров).
 */
import { tr } from '../../i18n'
import { KINDS, baseLatency, fitOf, isStorage, shardsOf, writeShareOf, type BEdge, type BNode, type Result, type Workload } from './model'

export type SpanStatus = 'ok' | 'hit' | 'miss' | 'slow' | 'error' | 'queued' | 'async'

export interface Span {
  nodeId: string
  op: string
  ms: number
  start: number
  status: SpanStatus
  depth: number
  /** Сообщение об ошибке или предупреждение в формате реальной системы */
  detail?: string
}

export interface Trace {
  id: number
  clientId: string
  request: string
  workload: Workload
  spans: Span[]
  /** Рёбра пути по порядку — для анимации */
  hops: { edgeId: string; depth: number; status: SpanStatus }[]
  status: 'ok' | 'error'
  totalMs: number
  httpStatus: number
}

// ---------- генераторы реалистичных данных ----------

let seed = 42
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2 ** 32
}
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1))
const code = () => Math.random().toString(36).slice(2, 7)

const WORDS = tr(
  ['наушники', 'кофемашина', 'кроссовки', 'iphone 15', 'диван', 'велосипед', 'погода', 'пицца рядом'],
  ['headphones', 'coffee machine', 'sneakers', 'iphone 15', 'sofa', 'bicycle', 'weather', 'pizza near me'],
  ['蓝牙耳机', '咖啡机', '运动鞋', 'iphone 15', '沙发', '自行车', '天气', '附近的披萨'],
)

type Domain =
  | 'product' | 'order' | 'profile' | 'post' | 'signup' | 'card'
  | 'link' | 'newlink' | 'sensor' | 'feed' | 'notify' | 'kv'
  | 'search' | 'suggest' | 'analytics' | 'trends'
  | 'image' | 'upload' | 'video' | 'doc'

interface Ctx {
  id: number
  word: string
  code: string
  user: number
  domain: Domain
  request: string
  /** Запрос клиента пишет данные (PUT/POST), а не читает */
  write: boolean
  /** Запрос прошёл через fan-out: в хранилище уходит столько записей */
  fanout?: number
}

const has = (label: string, re: RegExp) => re.test(label.toLowerCase())

/** Что именно делает клиент: определяется профилем нагрузки и названием блока (на любом из трёх языков) */
export function domainOf(client: BNode, w: Workload): Domain {
  const l = client.label
  if (w === 'oltp') {
    if (has(l, /заказ|order|брон|book|订单|预订/)) return 'order'
    if (has(l, /покупат|shopper|顾客/)) return 'product'
    if (has(l, /профил|profile|资料/)) return 'profile'
    if (has(l, /публик|post|发布|帖子/)) return 'post'
    if (has(l, /регистр|sign|注册/)) return 'signup'
    if (has(l, /карточ|card|卡片/)) return 'card'
    return rnd() < 0.15 ? 'order' : 'product'
  }
  if (w === 'kv') {
    if (has(l, /создан|creat|创建/)) return 'newlink'
    if (has(l, /переход|redirect|ссылк|link|跳转|链接/)) return 'link'
    if (has(l, /датчик|sensor|传感器/)) return 'sensor'
    if (has(l, /лент|feed|信息流/)) return 'feed'
    if (has(l, /отправ|notif|sender|发送|通知/)) return 'notify'
    return 'kv'
  }
  if (w === 'search') return has(l, /подсказ|suggest|补全|建议/) ? 'suggest' : 'search'
  if (w === 'analytics') return has(l, /тренд|trend|趋势/) ? 'trends' : 'analytics'
  if (has(l, /загруз|upload|上传/)) return 'upload'
  if (has(l, /просмотр|view|видео|video|观看|视频/)) return 'video'
  if (has(l, /файл|file|скан|scan|док|doc|文件|扫描|文档/)) return rnd() < 0.3 ? 'upload' : 'doc'
  return 'image'
}

/** Запись того же сюжета: смотрят товар → оформляют заказ, переходят по ссылке → создают ссылку */
const WRITE_OF: Partial<Record<Domain, Domain>> = { product: 'order', link: 'newlink', image: 'upload', video: 'upload', doc: 'upload' }
const READ_OF: Partial<Record<Domain, Domain>> = { signup: 'profile', newlink: 'link', upload: 'doc' }

function makeCtx(client: BNode, w: Workload): Ctx {
  // доля записей — та же, что в модели: иначе живой трафик и цифры разойдутся
  const write = rnd() < writeShareOf(client)
  const base = domainOf(client, w)
  const domain = write ? (WRITE_OF[base] ?? base) : (READ_OF[base] ?? base)
  return {
    id: int(1000, 99999),
    word: pick(WORDS),
    code: code(),
    user: int(10000, 999999),
    domain,
    request: '',
    write,
  }
}

/** Запрос клиента — так, как он выглядел бы в access-логе */
function requestFor(c: Ctx): string {
  // чтения тех доменов, что обычно пишут, и записи тех, что обычно читают
  if (!c.write) {
    if (c.domain === 'order') return `GET /api/orders/${c.id}`
    if (c.domain === 'post') return `GET /api/posts/${c.id}`
    if (c.domain === 'sensor') return `GET /api/sensors/s-${c.id}/latest`
    if (c.domain === 'notify') return `GET /api/notifications/${c.id}`
  } else {
    if (c.domain === 'profile') return `PATCH /api/users/${c.user}/profile  {"city":"…"}`
    if (c.domain === 'card') return `PUT /api/cards/${c.id}  {"price":${int(500, 9000)}}`
    if (c.domain === 'kv') return `PUT /kv/${c.code}`
    if (c.domain === 'search') return `POST /items/_doc  {"title":"${c.word}"}`
    if (c.domain === 'analytics' || c.domain === 'trends') return `POST /events  {"type":"order_paid"}`
  }
  switch (c.domain) {
    case 'product': return `GET /api/products/${c.id}`
    case 'order': return `POST /api/orders  {"items":[{"sku":"SKU-${c.id % 7000}","qty":${int(1, 3)}}],"user":${c.user}}`
    case 'profile': return `GET /api/users/${c.user}/profile`
    case 'post': return `POST /api/posts  {"author":${c.user},"text":"…"}`
    case 'signup': return `POST /api/users  {"email":"user${c.user}@mail.ru"}`
    case 'card': return `GET /api/cards/${c.id}`
    case 'link': return `GET /r/${c.code}`
    case 'newlink': return `POST /api/links  {"url":"https://shop.example/p/${c.id}"}`
    case 'sensor': return `POST /ingest  {"sensor":"s-${c.id}","t":21.${int(0, 9)},"ts":${1793620800 + int(0, 9999)}}`
    case 'feed': return `GET /api/feed?user=${c.user}&limit=20`
    case 'notify': return `POST /notify  {"user":${c.user},"channel":"${pick(['push', 'email', 'sms'])}"}`
    case 'kv': return `GET /kv/${c.code}`
    case 'search': return `GET /search?q=${c.word}`
    case 'suggest': return `GET /suggest?prefix=${c.word.slice(0, 3)}`
    case 'analytics': return `GET /dashboards/revenue?groupBy=region&period=2026`
    case 'trends': return `GET /trends?metric=views&window=7d`
    case 'image': return `GET /img/sku-${c.id % 7000}/800.webp`
    case 'video': return `GET /video/${c.code}/720p/seg-${int(1, 300)}.ts`
    case 'upload': return `PUT /files/scan-${c.id}.pdf  (2.4 MB)`
    case 'doc': return `GET /files/scan-${c.id}.pdf`
  }
}

/** Таблица (коллекция, ключ) под домен запроса */
const TABLE: Record<Domain, string> = {
  product: 'products', order: 'orders', profile: 'users', post: 'posts', signup: 'users', card: 'cards',
  link: 'links', newlink: 'links', sensor: 'readings', feed: 'feed', notify: 'notifications', kv: 'kv',
  search: 'items', suggest: 'items', analytics: 'orders', trends: 'events', image: 'files', upload: 'files', video: 'files', doc: 'files',
}

const cacheKey = (c: Ctx) =>
  c.domain === 'search' || c.domain === 'suggest' ? `q:${c.word}` : c.domain === 'link' ? `link:${c.code}` : c.domain === 'feed' ? `feed:${c.user}` : c.domain === 'profile' ? `user:${c.user}` : `${TABLE[c.domain].replace(/s$/, '')}:${c.id}`

function sqlFor(c: Ctx, dialect: 'pg' | 'cql'): string {
  const t = TABLE[c.domain]
  if (!c.write) {
    if (c.domain === 'order') return `SELECT status, total FROM orders WHERE id = ${c.id}`
    if (c.domain === 'post') return `SELECT * FROM posts WHERE id = ${c.id}`
    if (c.domain === 'sensor') return `SELECT value, ts FROM readings WHERE sensor_id = 's-${c.id}' ORDER BY ts DESC LIMIT 1`
    if (c.domain === 'notify') return `SELECT status FROM notifications WHERE id = ${c.id}`
  } else {
    if (c.domain === 'profile') return `UPDATE users SET city = '…' WHERE id = ${c.user}`
    if (c.domain === 'card') return `UPDATE cards SET price = ${int(500, 9000)} WHERE id = ${c.id}`
    if (c.domain === 'kv') return dialect === 'pg' ? `INSERT INTO kv VALUES ('${c.code}', …) ON CONFLICT DO UPDATE …` : `INSERT INTO kv (k, v) VALUES ('${c.code}', …)`
    if (c.domain === 'analytics' || c.domain === 'trends') return `INSERT INTO events (type, ts) VALUES ('order_paid', now())`
  }
  switch (c.domain) {
    case 'order':
      return dialect === 'pg'
        ? `BEGIN; UPDATE stock SET qty = qty - 1 WHERE sku = 'SKU-${c.id % 7000}'; INSERT INTO orders … ; COMMIT`
        : `BEGIN BATCH UPDATE stock … ; INSERT INTO orders … APPLY BATCH`
    case 'post': return `INSERT INTO posts (author_id, text) VALUES (${c.user}, '…')`
    case 'signup': return `INSERT INTO users (email) VALUES ('user${c.user}@mail.ru')`
    case 'profile': return `SELECT * FROM users WHERE id = ${c.user}`
    case 'link': return `SELECT url FROM links WHERE code = '${c.code}'`
    case 'newlink': return `INSERT INTO links (code, url) VALUES ('${c.code}', 'https://shop.example/p/${c.id}')`
    case 'sensor': return `INSERT INTO readings (sensor_id, ts, value) VALUES ('s-${c.id}', ${dialect === 'pg' ? 'now()' : 'toTimestamp(now())'}, 21.4)`
    case 'feed':
      return dialect === 'pg'
        ? `SELECT p.* FROM posts p JOIN follows f ON f.author_id = p.author_id WHERE f.user_id = ${c.user} ORDER BY p.created_at DESC LIMIT 20`
        : `SELECT * FROM feed WHERE user_id = ${c.user} LIMIT 20`
    case 'notify': return `INSERT INTO notifications (user_id, channel, status) VALUES (${c.user}, 'push', 'queued')`
    case 'search':
    case 'suggest': return `SELECT * FROM items WHERE title ILIKE '%${c.word}%' LIMIT 20`
    case 'analytics': return `SELECT region, sum(total) FROM orders WHERE created_at >= '2026-01-01' GROUP BY region`
    case 'trends': return `SELECT date_trunc('hour', ts), count(*) FROM events WHERE ts > now() - interval '7 days' GROUP BY 1`
    case 'upload': return `INSERT INTO files (name, data) VALUES ('scan-${c.id}.pdf', '\\x255044462d…')  -- 2.4 MB`
    case 'image':
    case 'video':
    case 'doc': return `SELECT data FROM files WHERE id = ${c.id}  -- 2.4 MB bytea`
    default: return `SELECT * FROM ${t} WHERE id = ${c.id}`
  }
}

function topicFor(c: Ctx): string {
  const m: Partial<Record<Domain, string>> = {
    order: 'orders.created', signup: 'users.registered', post: 'posts.published', notify: 'notifications.requested',
    upload: 'files.uploaded', sensor: 'readings.raw', newlink: 'links.created',
  }
  return m[c.domain] ?? `${TABLE[c.domain]}.events`
}

type Phase = 'set' | 'del' | 'consume'

/** Куда попал запрос в базе с репликами и шардами: запись — только в primary, чтение — на любую реплику */
function whereRuns(n: BNode, c: Ctx): string {
  const shards = shardsOf(n)
  const shard = shards > 1 ? ` [shard ${(c.id % shards) + 1}/${shards}]` : ''
  if (c.write) return `${shard} (primary)`
  return n.instances > 1 ? `${shard} (replica #${int(1, n.instances - 1)})` : `${shard} (primary)`
}

/** Операция, которую выполняет блок над этим запросом */
function opFor(n: BNode, c: Ctx, phase?: Phase): string {
  switch (n.kind) {
    case 'client':
      return c.request.split('  ')[0]
    case 'lb':
      return tr(`проксирует → экземпляр #${int(1, Math.max(1, n.instances * 2))}`, `proxy → instance #${int(1, Math.max(1, n.instances * 2))}`, `代理 → 实例 #${int(1, Math.max(1, n.instances * 2))}`)
    case 'gateway':
      return tr(`маршрут, проверка JWT, лимиты`, `route, JWT check, rate limits`, `路由、JWT 校验、限流`)
    case 'service':
      if (phase === 'consume') return `consume ${topicFor(c)} → ${tr('обработка', 'handle', '处理')} (${tr('под', 'pod', 'Pod')} #${int(1, n.instances)})`
      return `${c.request.split('  ')[0]} (${tr('под', 'pod', 'Pod')} #${int(1, n.instances)})`
    case 'cache':
      if (phase === 'del') return `DEL ${cacheKey(c)}`
      if (phase === 'set') return `SET ${cacheKey(c)} EX 60`
      return `GET ${cacheKey(c)}`
    case 'cdn':
      return `${c.request.split('  ')[0]} @ edge-${pick(['msk', 'spb', 'ekb', 'nsk'])}-${int(1, 4)}`
    case 'queue':
      return `produce ${topicFor(c)} key=${c.domain === 'order' ? 'ORD-' + (100000 + c.id) : c.id}`
    case 'postgres':
      return sqlFor(c, 'pg') + whereRuns(n, c)
    case 'cassandra':
      if (c.fanout) return tr(`BATCH INSERT INTO feed (user_id, post_id, ts) … ×${c.fanout} — пост в ленту каждого подписчика`, `BATCH INSERT INTO feed (user_id, post_id, ts) … ×${c.fanout}: the post into every follower’s feed`, `BATCH INSERT INTO feed (user_id, post_id, ts) … ×${c.fanout}：把帖子写进每位关注者的信息流`)
      return sqlFor(c, 'cql')
    case 'mongo':
      return (c.write ? `db.${TABLE[c.domain]}.insertOne({ … })` : `db.${TABLE[c.domain]}.find({ _id: ${c.id} })`) + whereRuns(n, c)
    case 'elastic':
      if (c.domain === 'analytics' || c.domain === 'trends') return `POST /${TABLE[c.domain]}/_search {"size":0,"aggs":{"by":{"terms":{"field":"region"}}}}`
      if (c.domain === 'suggest') return `POST /items/_search {"suggest":{"s":{"prefix":"${c.word.slice(0, 3)}","completion":{"field":"title.suggest"}}}}`
      if (c.write) return `POST /${TABLE[c.domain]}/_doc {…}`
      return `POST /items/_search {"query":{"match":{"title":"${c.word}"}}}`
    case 'clickhouse':
      if (c.domain === 'trends') return `SELECT toStartOfHour(ts), count() FROM events WHERE ts > now() - INTERVAL 7 DAY GROUP BY 1`
      if (c.write) return `INSERT INTO ${TABLE[c.domain]} VALUES (…)`
      return `SELECT region, sum(total) FROM orders WHERE toYear(created_at) = 2026 GROUP BY region`
    case 's3':
      if (c.domain === 'upload') return `PUT s3://docs/scan-${c.id}.pdf (2.4 MB)`
      if (c.domain === 'video') return `GET s3://video/${c.code}/720p/seg.ts`
      if (c.domain === 'doc') return `GET s3://docs/scan-${c.id}.pdf`
      if (c.domain === 'image') return `GET s3://media/sku-${c.id % 7000}/800.webp`
      return c.write ? `PUT s3://data/${TABLE[c.domain]}/${c.id}.json` : `GET s3://data/${TABLE[c.domain]}/${c.id}.json`
    default:
      return ''
  }
}

/** Реальная ошибка для перегруженного или неподходящего блока */
function errorFor(n: BNode, reason: 'overload' | 'unsupported' | 'deadend'): string {
  if (reason === 'deadend')
    return n.kind === 'cache'
      ? tr('MISS, а дальше идти некуда: 502 no upstream', 'MISS and nowhere to go next: 502 no upstream', 'MISS，而且后面无处可去：502 no upstream')
      : '502 Bad Gateway: no healthy upstream'
  if (reason === 'unsupported') {
    if (n.kind === 'cassandra') return 'InvalidRequest: cross-partition transactions and JOINs are not supported'
    if (n.kind === 's3') return tr('S3 — не база данных: нет запросов по полям и транзакций', 'S3 is not a database: no field queries or transactions', 'S3 不是数据库：不支持按字段查询，也不支持事务')
    if (n.kind === 'clickhouse') return 'Code: 48. DB::Exception: point updates are not supported efficiently (MergeTree)'
    if (n.kind === 'elastic') return tr('Elasticsearch не источник истины: транзакции не поддерживаются', 'Elasticsearch is not a source of truth: transactions are not supported', 'Elasticsearch 不是可信数据源（source of truth）：不支持事务')
    return tr(`${KINDS[n.kind].title} не умеет такие запросы`, `${KINDS[n.kind].title} cannot handle this request`, `${KINDS[n.kind].title} 处理不了这种请求`)
  }
  switch (n.kind) {
    case 'postgres':
      return pick(['FATAL: sorry, too many clients already', 'ERROR: canceling statement due to statement timeout'])
    case 'cassandra':
      return 'WriteTimeoutException: Cassandra timeout during write query at consistency QUORUM'
    case 'elastic':
      return 'es_rejected_execution_exception: rejected execution of search (queue capacity 1000)'
    case 'clickhouse':
      return 'Code: 202. DB::Exception: Too many simultaneous queries. Maximum: 100'
    case 's3':
      return '503 SlowDown: Please reduce your request rate'
    case 'mongo':
      return 'MongoServerSelectionError: connection pool exhausted'
    case 'cache':
      return 'ERR max number of clients reached'
    case 'queue':
      return 'KafkaTimeoutException: Failed to update metadata after 60000 ms'
    case 'lb':
    case 'gateway':
      return '503 Service Unavailable: upstream connect error or disconnect/reset before headers'
    default:
      return pick(['503 Service Unavailable: request queue is full', 'java.util.concurrent.TimeoutException: 3000 ms'])
  }
}

// ---------- проход запроса по графу ----------

const CACHEABLE: Workload[] = ['oltp', 'kv', 'search']
let traceId = 0

export function emulateRequest(nodes: BNode[], edges: BEdge[], r: Result, clientId: string): Trace | null {
  const byId = Object.fromEntries(nodes.map((x) => [x.id, x]))
  const client = byId[clientId]
  if (!client) return null
  const w = client.workload ?? 'oltp'
  const c = makeCtx(client, w)
  const request = requestFor(c)
  c.request = request
  const kids = (id: string) => edges.filter((e) => e.from === id)
  const spans: Span[] = []
  const hops: Trace['hops'] = []
  let failed = false

  /** Собственное время блока: базовая латентность с поправкой на загрузку и профиль */
  const ownMs = (n: BNode) => {
    const st = r.nodes[n.id]
    const util = st?.util ?? 0
    const f = isStorage(n.kind) ? Math.max(fitOf(n.kind, w), 0.01) : 1
    const base = (baseLatency(n) / Math.sqrt(f)) / (1 - Math.min(util, 0.95))
    return Math.max(0.3, base * (0.75 + rnd() * 0.5))
  }

  /** Возвращает время ответа поддерева (синхронно ждут его) */
  const visit = (id: string, depth: number, at: number, async: boolean, phase?: Phase): number => {
    const n = byId[id]
    const st = r.nodes[id]
    const util = st?.util ?? 0
    const start = at
    let status: SpanStatus = async ? 'async' : 'ok'
    let detail: string | undefined
    let ms = ownMs(n)
    // перегрузка: часть запросов отбрасывается, остальные ждут в очереди
    if (util > 1 && async) {
      detail = tr(
        `загрузка ${Math.round(util * 100)}%: обработчики не успевают, сообщения копятся в очереди`,
        `${Math.round(util * 100)}% utilization: consumers cannot keep up, messages pile up in the queue`,
        `负载 ${Math.round(util * 100)}%：消费者处理不过来，消息在队列中堆积`,
      )
    } else if (util > 1 && rnd() > 1 / util) {
      status = 'error'
      detail = errorFor(n, 'overload')
      ms = n.kind === 'service' ? 3000 : ms * 4
    } else if (util > 0.85) {
      status = async ? 'async' : 'slow'
      detail = tr(`загрузка ${Math.round(util * 100)}%: запросы ждут в очереди обработчиков`, `${Math.round(util * 100)}% utilization: requests wait in the worker queue`, `负载 ${Math.round(util * 100)}%：请求在工作线程队列中等待`)
    }
    if (isStorage(n.kind) && fitOf(n.kind, w) === 0) {
      status = 'error'
      detail = errorFor(n, 'unsupported')
    } else if (isStorage(n.kind) && fitOf(n.kind, w) < 0.2 && status !== 'error') {
      status = 'slow'
      detail =
        n.kind === 'postgres' && w === 'search'
          ? `Seq Scan on items (rows=2 400 000) — ${Math.round(ms)} ms`
          : tr(`неэффективно для этого типа запросов (×${fitOf(n.kind, w)})`, `inefficient for this request type (×${fitOf(n.kind, w)})`, `处理这类请求效率低（×${fitOf(n.kind, w)}）`)
    }
    const span: Span = { nodeId: id, op: opFor(n, c, phase), ms, start, status, depth, detail }
    spans.push(span)
    if ((n.kind === 'cache' || n.kind === 'cdn') && st?.deadEnd) {
      // источника данных нет: кэш никто не наполнял
      span.status = 'error'
      span.detail =
        n.kind === 'cdn'
          ? tr('MISS, и origin не подключён: 502 — файлам неоткуда взяться', 'MISS and no origin is connected: 502, the files have nowhere to come from', 'MISS，且没有连接源站（origin）：502，文件无从获取')
          : c.write
          ? tr('запись некуда сохранить: за кэшем нет базы, а кэш — не хранилище', 'nowhere to persist the write: there is no database behind the cache, and a cache is not a store', '写入无处持久化：缓存后面没有数据库，而缓存并不是存储')
          : tr(
              `(nil) — кэш пуст: его наполняют из базы, а базы за ним нет`,
              `(nil): the cache is empty; it is filled from a database, and there is none behind it`,
              `(nil)：缓存是空的——它要从数据库填充，可它后面并没有数据库`,
            )
      if (!async) failed = true
      return ms
    }
    if (status === 'error') {
      if (!async) failed = true
      return ms
    }
    if (phase === 'set' || (phase === 'del' && !kids(id).length)) return ms

    const out = kids(id)
    const t = start + ms
    let wait = 0
    const go = (e: BEdge, from: number, asyncChild: boolean, ph?: Phase) => {
      const hop: Trace['hops'][number] = { edgeId: e.id, depth, status: 'ok' }
      hops.push(hop)
      const before = spans.length
      const took = visit(e.to, depth + 1, from, asyncChild, ph)
      hop.status = spans[before]?.status ?? 'ok'
      return took
    }

    switch (n.kind) {
      case 'client':
      case 'lb':
      case 'gateway': {
        if (!out.length) {
          span.status = 'error'
          span.detail = n.kind === 'client' ? tr('connect ECONNREFUSED: клиенту не к кому подключиться', 'connect ECONNREFUSED: the client has nothing to connect to', 'connect ECONNREFUSED：客户端没有可连接的对象') : errorFor(n, 'deadend')
          failed = !async
          break
        }
        wait = go(pick(out), t, async)
        break
      }
      case 'cdn':
      case 'cache': {
        const hitRatio = n.hitRatio ?? (n.kind === 'cdn' ? 0.9 : 0.8)
        const cacheable = n.kind === 'cdn' ? w === 'blob' && !c.write : CACHEABLE.includes(w) && !c.write
        if (cacheable && rnd() < hitRatio) {
          span.status = 'hit'
          break
        }
        if (cacheable) {
          span.status = 'miss'
        }
        // read-through: промах идёт дальше; cache-aside: решает сервис-родитель
        if (out.length) wait = go(pick(out), t, async)
        break
      }
      case 'queue': {
        span.status = async ? 'async' : 'queued'
        span.op += tr(' (подтверждено, обработка позже)', ' (acked, processed later)', '（已确认，稍后处理）')
        const lag = st?.backlogGrowth ?? 0
        if (lag >= 1) span.detail = tr(`consumer lag растёт на ${Math.round(lag)} сообщ./с`, `consumer lag grows by ${Math.round(lag)} msg/s`, `消费积压（consumer lag）每秒增加 ${Math.round(lag)} 条消息`)
        for (const e of out) go(e, t + 5, true, 'consume')
        break
      }
      case 'service': {
        // пост раскладывается по лентам тем сервисом, у которого есть хранилище «ключ-значение»
        if (client.fanout && out.some((e) => isStorage(byId[e.to].kind) && fitOf(byId[e.to].kind, 'kv') > 0)) c.fanout = client.fanout
        if (st?.deadEnd) {
          span.status = 'error'
          span.detail = c.write
            ? tr('500: сохранить некуда — к сервису не подключено хранилище', '500: nowhere to save; no storage is connected to the service', '500：无处保存——服务没有连接任何存储')
            : tr('500: данных нет — к сервису не подключено хранилище', '500: no data; no storage is connected to the service', '500：没有数据——服务没有连接任何存储')
          failed = !async
          break
        }
        const children = out.map((e) => ({ e, n: byId[e.to] }))
        const stores = children.filter((x) => isStorage(x.n.kind))
        const best = Math.max(0, ...stores.map((x) => fitOf(x.n.kind, w)))
        const cacheKid = children.find((x) => x.n.kind === 'cache')
        let cur = t
        let hit = false
        // cache-aside: сначала кэш
        const readThrough = !!cacheKid && kids(cacheKid.n.id).length > 0
        if (cacheKid && (CACHEABLE.includes(w) || readThrough)) {
          const before = spans.length
          cur += go(cacheKid.e, cur, async, c.write ? 'del' : undefined)
          hit = spans[before]?.status === 'hit'
        }
        for (const x of children) {
          if (x === cacheKid) continue
          if (isStorage(x.n.kind)) {
            const f = fitOf(x.n.kind, w)
            if (stores.length > 1 && (f === 0 || f < best)) continue // запрос уходит в самое подходящее хранилище
            if (hit && CACHEABLE.includes(w)) continue
            cur += go(x.e, cur, async)
          } else if (x.n.kind === 'queue') {
            cur += go(x.e, cur, async)
          } else {
            cur += go(x.e, cur, async)
          }
          if (failed) break
        }
        // после промаха — положить ответ в кэш
        if (cacheKid && CACHEABLE.includes(w) && !readThrough && !hit && !failed) cur += go(cacheKid.e, cur, async, c.write ? 'del' : 'set')
        wait = cur - t
        break
      }
      default:
        break
    }
    return ms + wait
  }

  const total = visit(clientId, 0, 0, false)
  const id = ++traceId
  const errDetail = spans.find((s) => s.status === 'error')?.detail ?? ''
  const httpStatus = !failed
    ? c.write ? 201 : 200
    : errDetail.startsWith('connect') ? 0
    : errDetail.includes('502') ? 502
    : errDetail.startsWith('500') ? 500
    : /Timeout|timeout/.test(errDetail) ? 504
    : 503
  return {
    id,
    clientId,
    request,
    workload: w,
    spans: spans.filter((x) => x.nodeId !== clientId || x.status === 'error'), // сам клиент — спан только при ошибке
    hops,
    status: failed ? 'error' : 'ok',
    totalMs: total,
    httpStatus,
  }
}

/** Выбрать клиента пропорционально его нагрузке */
export function pickClient(nodes: BNode[]): BNode | null {
  const cs = nodes.filter((x) => x.kind === 'client' && (x.rps ?? 0) > 0)
  const sum = cs.reduce((s, x) => s + (x.rps ?? 0), 0)
  if (!sum) return null
  let r = Math.random() * sum
  for (const x of cs) {
    r -= x.rps ?? 0
    if (r <= 0) return x
  }
  return cs[cs.length - 1]
}
