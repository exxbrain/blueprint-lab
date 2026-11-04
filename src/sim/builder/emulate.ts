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
/** Продавец и его категория расходов (агрегатор финансов): категорию операции определяет продавец */
const MERCHANTS: [merchant: string, category: string][] = [
  ['coffee-house', 'food'], ['city-market', 'groceries'], ['metro-transit', 'transport'], ['cinema-park', 'entertainment'], ['fuel-station', 'transport'],
]
const merchant = (c: { id: number }) => MERCHANTS[c.id % MERCHANTS.length]
/** Статьи бюджета и категории товаров (рейтинг продаж) */
const BUDGET = ['food', 'groceries', 'transport', 'entertainment', 'home']
const CATEGORIES = ['books', 'electronics', 'home', 'toys', 'sports']
const budgetCat = (c: { id: number }) => BUDGET[c.id % BUDGET.length]
const cat = (c: { id: number }) => CATEGORIES[c.id % CATEGORIES.length]
/** Сайт для обхода поисковым роботом */
const site = (c: { id: number }) => `site-${c.id % 977}.example`

type Domain =
  | 'product' | 'order' | 'profile' | 'post' | 'signup' | 'card'
  | 'txn' | 'budget' | 'rank'
  | 'link' | 'newlink' | 'sensor' | 'feed' | 'notify' | 'friends' | 'dedup' | 'kv'
  | 'search' | 'suggest' | 'crawl' | 'analytics' | 'trends' | 'spending' | 'ranking'
  | 'image' | 'upload' | 'video' | 'doc' | 'static'

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
  /** Числа из тела запроса — разыгрываются один раз, чтобы запрос и запись в базе совпадали */
  amount: number
  limit: number
  price: number
}

const has = (label: string, re: RegExp) => re.test(label.toLowerCase())

/** Что именно делает клиент: определяется профилем нагрузки и названием блока (на любом из трёх языков) */
/** roll — розыгрыш для клиентов без ключевых слов; check подставляет крайние значения, чтобы сравнить правила между языками */
export function domainOf(client: BNode, w: Workload, roll: () => number = rnd): Domain {
  const l = client.label
  if (w === 'oltp') {
    if (has(l, /заказ|order|брон|book|订单|预订/)) return 'order'
    if (has(l, /покупат|shopper|顾客/)) return 'product'
    if (has(l, /профил|profile|资料/)) return 'profile'
    if (has(l, /публик|post|发布|帖子/)) return 'post'
    if (has(l, /регистр|sign|注册/)) return 'signup'
    if (has(l, /карточ|card|卡片/)) return 'card'
    if (has(l, /операц|транзакц|transaction|交易/)) return 'txn'
    if (has(l, /бюджет|budget|预算/)) return 'budget'
    if (has(l, /рейтинг|rank|排行/)) return 'rank'
    return roll() < 0.15 ? 'order' : 'product'
  }
  if (w === 'kv') {
    if (has(l, /создан|creat|创建/)) return 'newlink'
    if (has(l, /переход|redirect|ссылк|link|跳转|链接/)) return 'link'
    if (has(l, /датчик|sensor|传感器/)) return 'sensor'
    if (has(l, /лент|feed|信息流/)) return 'feed'
    if (has(l, /отправ|notif|sender|发送|通知/)) return 'notify'
    if (has(l, /друз|дружб|friend|好友/)) return 'friends'
    if (has(l, /дубл|duplicate|重复/)) return 'dedup'
    if (has(l, /рейтинг|rank|排行/)) return 'rank'
    return 'kv'
  }
  if (w === 'search') return has(l, /подсказ|suggest|补全|建议/) ? 'suggest' : has(l, /обход|crawl|抓取/) ? 'crawl' : 'search'
  if (w === 'analytics') {
    if (has(l, /тренд|trend|趋势/)) return 'trends'
    if (has(l, /расход|spending|支出/)) return 'spending'
    if (has(l, /рейтинг|rank|排行/)) return 'ranking'
    return 'analytics'
  }
  if (has(l, /загруз|upload|上传/)) return 'upload'
  if (has(l, /статик|static|静态/)) return 'static'
  if (has(l, /просмотр|view|видео|video|观看|视频/)) return 'video'
  if (has(l, /файл|file|скан|scan|док|doc|文件|扫描|文档/)) return roll() < 0.3 ? 'upload' : 'doc'
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
    amount: int(100, 9000),
    limit: int(5, 50) * 1000,
    price: int(500, 9000),
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
    if (c.domain === 'crawl') return `GET /frontier/next?worker=${int(1, 40)}`
  } else {
    // пользователь загружает картинку (в свободном режиме у клиента «файлы» по умолчанию есть доля записи)
    if (c.domain === 'static') return `PUT /static/uploads/${c.code}.png  (300 KB)`
    if (c.domain === 'profile') return `PATCH /api/users/${c.user}/profile  {"city":"…"}`
    if (c.domain === 'card') return `PUT /api/cards/${c.id}  {"price":${c.price}}`
    if (c.domain === 'kv') return `PUT /kv/${c.code}`
    if (c.domain === 'search') return `POST /items/_doc  {"title":"${c.word}"}`
    if (c.domain === 'analytics' || c.domain === 'trends' || c.domain === 'ranking') return `POST /events  {"type":"order_paid"}`
    if (c.domain === 'spending') return `POST /events  {"type":"card_payment","amount":-${c.amount}}`
    if (c.domain === 'txn') return `POST /api/transactions  {"account":"acc-${c.id}","amount":-${c.amount},"merchant":"${merchant(c)[0]}"}`
    if (c.domain === 'budget') return `PUT /api/budgets/${c.user}  {"category":"${budgetCat(c)}","limit":${c.limit}}`
    if (c.domain === 'friends') return `POST /api/friendships  {"a":${c.user},"b":${c.id}}`
    if (c.domain === 'dedup') return `PUT /seen/${c.code}${c.code}  {"url":"https://${site(c)}/"}`
    if (c.domain === 'rank') return `PUT /api/rank/${cat(c)}  {"top":[…100]}`
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
    case 'txn': return `GET /api/accounts/acc-${c.id}/transactions?limit=50`
    case 'budget': return `GET /api/budgets/${c.user}?month=2026-11`
    case 'rank': return `GET /api/rank/${cat(c)}?top=100`
    case 'friends': return `GET /api/users/${c.user}/friends`
    case 'dedup': return `GET /seen/${c.code}${c.code}`
    case 'search': return `GET /search?q=${c.word}`
    case 'suggest': return `GET /suggest?prefix=${c.word.slice(0, 3)}`
    case 'crawl': return `POST /frontier  {"url":"https://${site(c)}/page/${c.id}"}`
    case 'analytics': return `GET /dashboards/revenue?groupBy=region&period=2026`
    case 'trends': return `GET /trends?metric=views&window=7d`
    case 'spending': return `GET /reports/spending?user=${c.user}&groupBy=category&month=2026-10`
    case 'ranking': return `GET /internal/sales-rank/recalculate?window=7d`
    case 'static': return `GET /static/${pick([`js/app.${c.code}.js`, `css/main.${c.code}.css`, `img/logo.${c.code}.png`])}`
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
  txn: 'transactions', budget: 'budgets', rank: 'sales_rank', friends: 'friendships', dedup: 'seen_pages', crawl: 'pages',
  spending: 'transactions', ranking: 'orders', static: 'files',
}

const cacheKey = (c: Ctx) =>
  c.domain === 'search' || c.domain === 'suggest' ? `q:${c.word}` : c.domain === 'link' ? `link:${c.code}` : c.domain === 'feed' ? `feed:${c.user}` : c.domain === 'profile' ? `user:${c.user}` : CACHE_KEY[c.domain]?.(c) ?? `${TABLE[c.domain].replace(/s$/, '')}:${c.id}`

/** Ключи кэша новых доменов: по пользователю, категории, отпечатку страницы */
const CACHE_KEY: Partial<Record<Domain, (c: Ctx) => string>> = {
  txn: (c) => `txn:acc-${c.id}`,
  budget: (c) => `budget:${c.user}:2026-11`,
  rank: (c) => `rank:${cat(c)}`,
  friends: (c) => `friends:${c.user}`,
  dedup: (c) => `seen:${c.code}${c.code}`,
}

function sqlFor(c: Ctx, dialect: 'pg' | 'cql'): string {
  const t = TABLE[c.domain]
  if (!c.write) {
    if (c.domain === 'order') return `SELECT status, total FROM orders WHERE id = ${c.id}`
    if (c.domain === 'post') return `SELECT * FROM posts WHERE id = ${c.id}`
    if (c.domain === 'sensor') return `SELECT value, ts FROM readings WHERE sensor_id = 's-${c.id}' ORDER BY ts DESC LIMIT 1`
    if (c.domain === 'notify') return `SELECT status FROM notifications WHERE id = ${c.id}`
    if (c.domain === 'crawl') return `SELECT url FROM frontier ORDER BY priority DESC LIMIT 1 FOR UPDATE SKIP LOCKED`
  } else {
    if (c.domain === 'profile') return `UPDATE users SET city = '…' WHERE id = ${c.user}`
    if (c.domain === 'card') return `UPDATE cards SET price = ${c.price} WHERE id = ${c.id}`
    if (c.domain === 'kv') return dialect === 'pg' ? `INSERT INTO kv VALUES ('${c.code}', …) ON CONFLICT DO UPDATE …` : `INSERT INTO kv (k, v) VALUES ('${c.code}', …)`
    if (c.domain === 'analytics' || c.domain === 'trends' || c.domain === 'spending' || c.domain === 'ranking') return `INSERT INTO events (type, ts) VALUES ('order_paid', now())`
    if (c.domain === 'txn')
      return dialect === 'pg'
        ? `INSERT INTO transactions (account_id, amount, merchant, category) VALUES ('acc-${c.id}', -${c.amount}, '${merchant(c)[0]}', '${merchant(c)[1]}')`
        : `INSERT INTO transactions (account_id, ts, amount) VALUES ('acc-${c.id}', toTimestamp(now()), -${c.amount})`
    if (c.domain === 'budget') return `UPDATE budgets SET amount_limit = ${c.limit} WHERE user_id = ${c.user} AND category = '${budgetCat(c)}'`
    if (c.domain === 'rank') return `INSERT INTO sales_rank (category, product_id, rank) VALUES ('${cat(c)}', ${c.id}, …)`
    if (c.domain === 'friends') return `INSERT INTO friendships (user_id, friend_id) VALUES (${c.user}, ${c.id}), (${c.id}, ${c.user})`
    if (c.domain === 'dedup')
      return dialect === 'pg'
        ? `INSERT INTO seen_pages (signature, url) VALUES ('${c.code}${c.code}', 'https://${site(c)}/') ON CONFLICT DO NOTHING`
        : `INSERT INTO seen_pages (signature, url) VALUES ('${c.code}${c.code}', 'https://${site(c)}/') IF NOT EXISTS`
    if (c.domain === 'crawl') return `INSERT INTO pages (url, body) VALUES ('https://${site(c)}/page/${c.id}', '…')  -- 500 KB`
    if (c.domain === 'static') return `INSERT INTO files (name, data) VALUES ('uploads/${c.code}.png', '\\x89504e47…')  -- 300 KB`
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
    case 'txn': return `SELECT * FROM transactions WHERE account_id = 'acc-${c.id}' ORDER BY created_at DESC LIMIT 50`
    case 'budget': return `SELECT category, amount_limit, spent FROM budgets WHERE user_id = ${c.user} AND month = '2026-11'`
    case 'rank': return `SELECT product_id, rank FROM sales_rank WHERE category = '${cat(c)}' ORDER BY rank LIMIT 100`
    case 'friends': return `SELECT friend_id FROM friendships WHERE user_id = ${c.user}`
    case 'dedup': return `SELECT url FROM seen_pages WHERE signature = '${c.code}${c.code}'`
    case 'spending': return `SELECT category, sum(amount) FROM transactions WHERE user_id = ${c.user} AND created_at >= '2026-10-01' GROUP BY category`
    case 'ranking': return `SELECT category, product_id, sum(qty) FROM orders WHERE created_at > now() - interval '7 days' GROUP BY 1, 2 ORDER BY 3 DESC`
    case 'upload': return `INSERT INTO files (name, data) VALUES ('scan-${c.id}.pdf', '\\x255044462d…')  -- 2.4 MB`
    case 'image':
    case 'video':
    case 'static':
    case 'doc': return `SELECT data FROM files WHERE id = ${c.id}  -- 2.4 MB bytea`
    default: return `SELECT * FROM ${t} WHERE id = ${c.id}`
  }
}

function topicFor(c: Ctx): string {
  const m: Partial<Record<Domain, string>> = {
    order: 'orders.created', signup: 'users.registered', post: 'posts.published', notify: 'notifications.requested',
    upload: 'files.uploaded', sensor: 'readings.raw', newlink: 'links.created',
    crawl: 'links.to_crawl', txn: 'transactions.imported', friends: 'friendships.changed', dedup: 'pages.seen',
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

/** Операция, которую выполняет блок над этим запросом; async — блок обрабатывает запрос в фоне, за очередью (например, пишет результат обработки загруженного файла) */
function opFor(n: BNode, c: Ctx, phase?: Phase, async = false): string {
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
      if (c.domain === 'analytics' || c.domain === 'trends' || c.domain === 'spending' || c.domain === 'ranking')
        return `POST /${TABLE[c.domain]}/_search {"size":0,"aggs":{"by":{"terms":{"field":"${c.domain === 'spending' ? 'category' : c.domain === 'ranking' ? 'product_id' : 'region'}"}}}}`
      if (c.domain === 'crawl' && c.write) return `POST /pages/_doc {"url":"https://${site(c)}/page/${c.id}","title":"…","body":"…"}`
      if (c.domain === 'crawl') return `POST /frontier/_search {"query":{"term":{"status":"queued"}},"sort":[{"priority":"desc"}],"size":1}`
      if (c.domain === 'suggest') return `POST /items/_search {"suggest":{"s":{"prefix":"${c.word.slice(0, 3)}","completion":{"field":"title.suggest"}}}}`
      if (c.write) return `POST /${TABLE[c.domain]}/_doc {…}`
      return `POST /items/_search {"query":{"match":{"title":"${c.word}"}}}`
    case 'clickhouse':
      if (c.domain === 'trends') return `SELECT toStartOfHour(ts), count() FROM events WHERE ts > now() - INTERVAL 7 DAY GROUP BY 1`
      if (c.domain === 'spending' && !c.write) return `SELECT category, sum(amount) FROM transactions WHERE user_id = ${c.user} AND toYYYYMM(ts) = 202610 GROUP BY category`
      if (c.domain === 'ranking' && !c.write) return `SELECT category, product_id, sum(qty) AS sold FROM orders WHERE ts > now() - INTERVAL 7 DAY GROUP BY category, product_id ORDER BY sold DESC LIMIT 100 BY category`
      if (c.write) return `INSERT INTO ${TABLE[c.domain]} VALUES (…)`
      return `SELECT region, sum(total) FROM orders WHERE toYear(created_at) = 2026 GROUP BY region`
    case 's3':
      // за очередью пишется результат обработки (превью, перекодированный файл), а не сам загруженный файл
      if (c.domain === 'upload') return async ? `PUT s3://derived/scan-${c.id}/…` : `PUT s3://docs/scan-${c.id}.pdf (2.4 MB)`
      if (c.domain === 'video') return `GET s3://video/${c.code}/720p/seg.ts`
      if (c.domain === 'doc') return `GET s3://docs/scan-${c.id}.pdf`
      if (c.domain === 'image') return `GET s3://media/sku-${c.id % 7000}/800.webp`
      if (c.domain === 'static')
        return c.write ? `PUT s3://static/uploads/${c.code}.png (300 KB)` : `GET s3://static/${c.request.split(' ')[1].replace('/static/', '')}`
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
    const span: Span = { nodeId: id, op: opFor(n, c, phase, async), ms, start, status, depth, detail }
    spans.push(span)
    if ((n.kind === 'cache' || n.kind === 'cdn') && st?.deadEnd) {
      // источника данных нет: кэш никто не наполнял
      span.status = 'error'
      span.detail =
        n.kind === 'cdn'
          ? tr('MISS, и origin не подключён: 502 — файлам неоткуда взяться', 'MISS and no origin is connected: 502, the files have nowhere to come from', 'MISS，且没有连接源站（origin）：502，文件无从获取')
          : c.write
          ? tr('запись некуда сохранить: у сервиса нет базы, а кэш — не хранилище', 'nowhere to persist the write: the service has no database, and a cache is not a store', '写入无处持久化：服务没有连接数据库，而缓存并不是存储')
          : tr(
              `(nil) — кэш пуст: его наполняет сервис из базы, а базы у сервиса нет`,
              `(nil): the cache is empty; the service fills it from a database, and the service has none`,
              `(nil)：缓存是空的——它由服务从数据库读取后填充，可服务并没有连接数据库`,
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
        // промах CDN идёт к источнику; у кэша потомков нет — при промахе в базу идёт сервис-родитель (cache-aside)
        if (out.length) wait = go(pick(out), t, async)
        break
      }
      case 'queue': {
        span.status = async ? 'async' : 'queued'
        span.op += tr(' (подтверждено, обработка позже)', ' (acked, processed later)', '（已确认，稍后处理）')
        const lag = st?.backlogGrowth ?? 0
        if (lag >= 1) span.detail = tr(`consumer lag растёт на ${Math.round(lag)} сообщ./с`, `consumer lag grows by ${Math.round(lag)} msg/s`, `消费者积压（consumer lag）每秒增加 ${Math.round(lag)} 条消息`)
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
        if (cacheKid && CACHEABLE.includes(w)) {
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
        if (cacheKid && CACHEABLE.includes(w) && !hit && !failed) cur += go(cacheKid.e, cur, async, c.write ? 'del' : 'set')
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
