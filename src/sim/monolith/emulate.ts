/**
 * Живой трафик распила: запрос клиента проходит по реальным связям проекта в текущем состоянии —
 * вызовы внутри процесса, REST между сервисами, события через брокер, саги, реплики, SQL в чужую БД.
 * Проблемы появляются там же, где их видит модель: нет фасада, нет брокера, таблицы переехали,
 * dual write без outbox, каскадный отказ без circuit breaker, общая БД под тяжёлым отчётом.
 */
import { tr } from '../../i18n'
import type { Span, SpanStatus, Trace } from '../builder/emulate'
import { dbOf, modeOf, unitOf, type Dep, type Metrics, type Project, type State } from './model'
import { has } from './patterns'

let seed = 7
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2 ** 32
}
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1))
const jitter = (ms: number) => ms * (0.75 + rnd() * 0.5)

/** Узлы трассы: модуль, его БД, общая БД, брокер, фасад */
export const MONO_DB = 'monolith-db'
export const KAFKA = 'kafka'
export const GATEWAY = 'gateway'
export const CLIENT = 'client'
export const dbNode = (s: State, m: string) => (dbOf(s, m) === 'monolith-db' ? MONO_DB : `${m}-db`)

/** Ребро анимации: связь проекта, вход клиента в модуль или поход модуля в свою БД */
export const entryEdge = (m: string) => `entry:${m}`
export const dbEdge = (m: string) => `db:${m}`

let traceId = 0

export function emulateMono(p: Project, s: State, metrics: Metrics): Trace {
  const spans: Span[] = []
  const hops: Trace['hops'] = []
  const byId = Object.fromEntries(p.modules.map((m) => [m.id, m]))
  const anyExtracted = p.modules.some((m) => s.extracted[m.id])
  const kafka = has(s.infra, 'kafka')
  const outbox = has(s.infra, 'outbox') || has(s.infra, 'cdc')
  const cb = has(s.infra, 'circuitBreakers')
  const retry = has(s.infra, 'retry')
  const sharedDbHot = metrics.heavyLeft.length > 0
  let failed = false
  let httpStatus = 200
  const id = ++traceId

  // ключевой сценарий чаще, остальное — обычные запросы к модулям
  const flow = rnd() < 0.55
  const start = flow ? p.entry : p.modules[int(0, p.modules.length - 1)].id
  const objId = int(1000, 99999)
  const request = flow
    ? `POST /api/${start}  (${p.entryLabel})`
    : `GET /api/${start}/${objId}`

  const push = (sp: Omit<Span, 'start'> & { start?: number }) => {
    const span = { start: 0, ...sp } as Span
    spans.push(span)
    return span
  }
  const hop = (edgeId: string, depth: number, status: SpanStatus) => hops.push({ edgeId, depth, status })

  // вход: фасад или прямо в монолит
  let t = 0
  if (anyExtracted && has(s.infra, 'gateway')) {
    push({ nodeId: GATEWAY, op: tr(`маршрут ${request.split('  ')[0]} → ${s.extracted[start] ? `${start}-service` : 'monolith'}`, `route ${request.split('  ')[0]} → ${s.extracted[start] ? `${start}-service` : 'monolith'}`, `路由 ${request.split('  ')[0]} → ${s.extracted[start] ? `${start}-service` : 'monolith'}`), ms: jitter(4), status: 'ok', depth: 1, start: t })
    t += 4
  } else if (s.extracted[start]) {
    // модуль вынесен, а клиенты по-прежнему ходят в монолит
    push({
      nodeId: CLIENT,
      op: request.split('  ')[0],
      ms: jitter(6),
      status: 'error',
      depth: 1,
      detail: tr(
        `404 Not Found: монолит больше не обслуживает /api/${start} — модуль вынесен, а фасада, который перенаправит запрос, нет`,
        `404 Not Found: the monolith no longer serves /api/${start}; the module was extracted and there is no facade to route the request`,
        `404 Not Found：单体不再处理 /api/${start}——模块已经拆出，却没有门面把请求转发过去`,
      ),
    })
    hop(entryEdge(start), 0, 'error')
    return finish(404)
  }

  const visited = new Set<string>()
  const visit = (m: string, depth: number, at: number, viaNet: boolean): number => {
    visited.add(m)
    const mod = byId[m]
    const ext = s.extracted[m]
    let cur = at
    const own = push({
      nodeId: m,
      op: ext
        ? `${m}-service: ${viaNet ? tr('обработчик', 'handler', '处理器') : request.split('  ')[0]} (${tr('под', 'pod', 'Pod')} #${int(1, 3)})`
        : `Monolith → ${mod.title}${tr('Service', 'Service', 'Service')}.handle()`,
      ms: jitter(ext ? 8 : 4),
      status: 'ok',
      depth,
      start: cur,
    })
    cur += own.ms

    // свои таблицы
    const db = dbNode(s, m)
    const dbSpan = push({
      nodeId: db,
      op: flow && m === start ? `INSERT INTO ${m} … RETURNING id` : `SELECT * FROM ${m} WHERE id = ${objId}`,
      ms: jitter(db === MONO_DB ? 6 : 3),
      status: 'ok',
      depth: depth + 1,
      start: cur,
    })
    hop(dbEdge(m), depth, 'ok')
    if (db === MONO_DB && sharedDbHot && rnd() < 0.18) {
      dbSpan.status = 'slow'
      dbSpan.ms = jitter(1800)
      dbSpan.detail = tr(
        'медленно: тяжёлый отчёт гоняет агрегаты по общей БД, запрос ждёт блокировки',
        'slow: a heavy report runs aggregates on the shared DB, the query waits for locks',
        '慢：一个繁重的报表正在共享数据库上跑聚合，查询在等待锁',
      )
    }
    cur += dbSpan.ms

    // зависимости модуля — как в модели: в ключевом сценарии все, в обычном запросе только чтения
    const deps = p.deps.filter((d) => d.from === m && (flow || d.kind === 'read'))
    for (const d of deps) {
      if (failed) break
      cur += step(d, depth + 1, cur)
    }
    own.ms = cur - at
    return cur - at
  }

  /** Один шаг по связи; возвращает, сколько ждал вызывающий */
  const step = (d: Dep, depth: number, at: number): number => {
    const mode = modeOf(s, d)
    const to = byId[d.to]
    const label = d.label
    // внутри одного процесса
    if (mode === null) {
      if (d.kind === 'read') {
        const sp = push({ nodeId: dbNode(s, d.from), op: `SELECT … JOIN ${d.to} … — ${label}`, ms: jitter(4), status: 'ok', depth, start: at })
        hop(d.id, depth - 1, 'ok')
        return sp.ms
      }
      if (visited.has(d.to)) return 0
      hop(d.id, depth - 1, 'ok')
      const sp = push({ nodeId: d.to, op: tr(`вызов в процессе: ${to.title}.${d.kind === 'tx' ? 'update' : 'call'}() — ${label}`, `in-process call: ${to.title}.${d.kind === 'tx' ? 'update' : 'call'}() — ${label}`, `进程内调用：${to.title}.${d.kind === 'tx' ? 'update' : 'call'}() — ${label}`), ms: jitter(1), status: 'ok', depth, start: at })
      if (d.kind === 'tx') sp.op += tr(' (та же транзакция БД)', ' (same DB transaction)', '（同一个数据库事务）')
      return sp.ms
    }

    if (mode === 'direct') {
      const db = dbNode(s, d.to)
      const broken = dbOf(s, d.to) !== 'monolith-db' && dbOf(s, d.to) !== dbOf(s, d.from)
      const sp = push({ nodeId: db, op: `SELECT … FROM ${d.to}.${d.to}_data — ${label}`, ms: jitter(5), status: broken ? 'error' : 'ok', depth, start: at })
      hop(d.id, depth - 1, sp.status)
      if (broken) {
        sp.detail = `ERROR: relation "${d.to}.${d.to}_data" does not exist — ${tr('таблицы переехали в отдельную БД', 'the tables moved to a separate DB', '这些表已迁到独立的数据库')}`
        if (d.critical) fail(500)
      }
      return sp.ms
    }

    if (mode === 'replica') {
      const sp = push({
        nodeId: dbNode(s, d.from),
        op: tr(`SELECT из своей копии данных «${to.title}» — ${label}`, `SELECT from own copy of “${to.title}” data — ${label}`, `从自己保存的“${to.title}”数据副本中 SELECT — ${label}`),
        ms: jitter(2),
        status: 'ok',
        depth,
        start: at,
        detail: tr(`копия отстаёт на ~${int(100, 900)} мс — это нормально для eventual consistency`, `the copy lags by ~${int(100, 900)} ms, which is normal for eventual consistency`, `副本落后约 ${int(100, 900)} ms，这对最终一致性来说很正常`),
      })
      return sp.ms
    }

    if (mode === 'async' || mode === 'saga') {
      if (!kafka) {
        const sp = push({ nodeId: d.from, op: `publish ${d.to}.${d.id}`, ms: jitter(2), status: 'error', depth, start: at, detail: tr('NoBrokersAvailable: выбран обмен событиями, но брокер не развёрнут', 'NoBrokersAvailable: event messaging is selected, but no broker is deployed', 'NoBrokersAvailable：选择了事件消息通信，但没有部署 Broker') })
        hop(d.id, depth - 1, 'error')
        if (d.critical) fail(500)
        return sp.ms
      }
      const pub = push({ nodeId: KAFKA, op: `produce ${d.from}.${d.id} key=${objId}${outbox ? ' (outbox)' : ''}`, ms: jitter(3), status: 'queued', depth, start: at })
      hop(d.id, depth - 1, 'queued')
      if (!outbox && rnd() < 0.06) {
        pub.status = 'error'
        pub.detail = tr(
          'событие потеряно: запись в БД прошла, а публикация упала (dual write без outbox) — «' + to.title + '» об этом не узнает',
          'event lost: the DB write succeeded but publishing failed (dual write without an outbox); “' + to.title + '” will never know',
          '事件丢失：数据库写入成功了，发布却失败了（没有 Outbox 的 dual write，即双写）——“' + to.title + '”永远不会知道这件事',
        )
        return pub.ms
      }
      const consumer = push({
        nodeId: d.to,
        op: mode === 'saga' ? tr(`шаг саги: ${label}`, `saga step: ${label}`, `Saga 步骤：${label}`) : tr(`обработчик события: ${label}`, `event handler: ${label}`, `事件处理器：${label}`),
        ms: jitter(s.extracted[d.to] ? 10 : 5),
        status: 'async',
        depth: depth + 1,
        start: at + pub.ms + jitter(40),
      })
      if (mode === 'saga' && rnd() < 0.08) {
        consumer.status = 'error'
        consumer.detail = tr(`шаг не удался — запущена компенсация: отмена «${label}» у «${byId[d.from].title}»`, `the step failed; compensation started: undo “${label}” in “${byId[d.from].title}”`, `该步骤失败，已启动补偿：撤销“${byId[d.from].title}”中的“${label}”`)
        push({ nodeId: d.from, op: tr(`компенсация: откат «${label}»`, `compensation: roll back “${label}”`, `补偿：回滚“${label}”`), ms: jitter(6), status: 'async', depth: depth + 1, start: consumer.start + consumer.ms })
      }
      return pub.ms
    }

    // sync / api: сетевой вызов
    const verb = mode === 'api' || d.kind === 'read' ? 'GET' : 'POST'
    const call = push({
      nodeId: d.to,
      op: `${verb} http://${d.to}-service/api/${d.id} — ${label}`,
      ms: jitter(15),
      status: 'ok',
      depth,
      start: at,
    })
    hop(d.id, depth - 1, 'ok')
    const remote = unitOf(s, d.to) !== unitOf(s, d.from)
    const pFail = remote ? (retry ? 0.006 : 0.03) : 0
    const down = rnd() < pFail
    if (!down && retry && remote && rnd() < 0.05) call.detail = tr('первая попытка — таймаут, ретрай №1 → 200', 'first attempt timed out, retry #1 → 200', '第一次尝试超时，重试 #1 → 200')
    if (down) {
      call.ms = jitter(retry ? 3000 : 1000)
      if (cb && !d.critical) {
        call.status = 'miss'
        call.detail = tr('сервис не отвечает → circuit breaker открыт, отдан запасной ответ', 'the service is not responding → circuit breaker open, fallback returned', '服务无响应 → 熔断器（circuit breaker）打开，返回了降级响应')
        call.ms = jitter(2)
        hops[hops.length - 1].status = 'miss'
        return call.ms
      }
      call.status = 'error'
      call.detail = `504 Gateway Timeout: ${d.to}-service ${tr('не ответил', 'did not respond', '没有响应')}${d.critical ? '' : tr(' — некритичная связь, но без circuit breaker падает весь запрос', '; a non-critical link, but without a circuit breaker the whole request fails', '；这是非关键依赖，但没有熔断器（circuit breaker），整个请求都会失败')}`
      hops[hops.length - 1].status = 'error'
      fail(504)
      return call.ms
    }
    // распределённая «транзакция» из двух вызовов
    if (d.kind === 'tx' && mode === 'sync' && rnd() < 0.04) {
      call.status = 'error'
      call.detail = tr(
        `первая часть записана, второй вызов упал — данные записаны наполовину (${label})`,
        `the first part is written, the second call failed; data is half-written (${label})`,
        `第一部分已写入，第二次调用失败——数据只写了一半（${label}）`,
      )
      hops[hops.length - 1].status = 'error'
      fail(500)
      return call.ms
    }
    if (!visited.has(d.to)) call.ms += visit(d.to, depth + 1, at + call.ms, true)
    return call.ms
  }

  function fail(code: number) {
    if (!failed) httpStatus = code
    failed = true
  }

  hop(entryEdge(start), 0, 'ok')
  visit(start, 1, t, false)
  if (!failed && flow) httpStatus = 201
  return finish(httpStatus)

  function finish(code: number): Trace {
    const total = Math.max(0, ...spans.filter((x) => x.status !== 'async' && x.status !== 'queued').map((x) => x.start + x.ms))
    return {
      id,
      clientId: CLIENT,
      request,
      workload: 'oltp',
      spans,
      hops,
      status: code >= 400 ? 'error' : 'ok',
      totalMs: total,
      httpStatus: code,
    }
  }
}
