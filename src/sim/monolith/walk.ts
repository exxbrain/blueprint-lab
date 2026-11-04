import { tr } from '../../i18n'
import type { Span, Trace } from '../builder/emulate'
import { CLIENT, GATEWAY, KAFKA, MONO_DB, dbNode } from './emulate'
import { modeOf, type Project, type State } from './model'
import { has, type PatternId } from './patterns'

/**
 * Путь запроса по шагам: из трассы, которую строит эмуляция (emulateMono), — что происходит на каждом шаге
 * и что здесь делают включённые паттерны (или что ломается без них). Шаг подсвечивает на схеме узлы и связи.
 */
export interface WalkStep {
  title: string
  lines: string[]
  tone: 'ok' | 'warn' | 'bad'
  focus: {
    /** client, gateway, kafka, monolith-db, id модуля, `${id}-db` */
    nodes: string[]
    /** entry:<id>, db:<id> или id связи модулей */
    edges: string[]
    /** Узлы платформы (сборщик трейсов и т. п.) */
    platform: PatternId[]
  }
}

export function walkSteps(t: Trace, p: Project, s: State): WalkStep[] {
  const byId = Object.fromEntries(p.modules.map((m) => [m.id, m]))
  const P = (k: PatternId) => has(s.infra, k)
  const name = (m: string) => byId[m]?.title ?? m
  const method = t.request.split('  ')[0]
  const isWrite = method.startsWith('POST')
  const steps: WalkStep[] = []
  const toneOf = (sp: Span): WalkStep['tone'] => (sp.status === 'error' ? 'bad' : sp.status === 'slow' || sp.status === 'miss' ? 'warn' : 'ok')

  // каждому спану — связь, по которой к нему пришли (первая ещё не использованная с тем же адресатом)
  const used = new Set<number>()
  const target = (edgeId: string): string => {
    if (edgeId.startsWith('entry:')) return edgeId.slice(6)
    if (edgeId.startsWith('db:')) return dbNode(s, edgeId.slice(3))
    const d = p.deps.find((x) => x.id === edgeId)
    if (!d) return ''
    const mode = modeOf(s, d)
    if (mode === 'async' || mode === 'saga') return KAFKA
    if (mode === 'direct') return dbNode(s, d.to)
    if (mode === null && d.kind === 'read') return dbNode(s, d.from)
    return d.to
  }
  const edgeTo = (node: string): string[] => {
    const i = t.hops.findIndex((h, k) => !used.has(k) && target(h.edgeId) === node)
    if (i < 0) return []
    used.add(i)
    return [t.hops[i].edgeId]
  }

  // 1. клиент
  {
    const lines = [tr(`Клиент отправляет ${method}.`, `The client sends ${method}.`, `客户端发送 ${method}。`)]
    if (P('accessToken')) lines.push(tr('🎫 В заголовке — токен (JWT), который клиент получил у сервера авторизации при входе.', '🎫 The header carries a token (JWT) the client got from the auth server at sign-in.', '🎫 请求头里带着令牌（JWT），是客户端登录时从授权服务器拿到的。'))
    if (P('rateLimiter')) lines.push(tr('🚧 Rate limiter на входе считает запросы клиента: в пределах лимита пропускает, сверх лимита сразу отвечает 429.', '🚧 The rate limiter at the entry counts the client’s requests: within the limit it lets them through, above it replies 429 at once.', '🚧 入口的限流器统计客户端请求：限额内放行，超出立即返回 429。'))
    steps.push({ title: tr('Клиент', 'Client', '客户端'), lines, tone: 'ok', focus: { nodes: ['client'], edges: [], platform: P('accessToken') ? ['accessToken'] : [] } })
  }

  for (const sp of t.spans) {
    const detail = sp.detail ? [sp.detail] : []
    if (sp.nodeId === CLIENT) {
      steps.push({ title: tr('Ошибка на входе', 'Error at the entry', '入口出错'), lines: [sp.op, ...detail], tone: 'bad', focus: { nodes: ['client'], edges: edgeTo(t.hops[0] ? target(t.hops[0].edgeId) : ''), platform: [] } })
      continue
    }
    if (sp.nodeId === GATEWAY) {
      const lines = [tr(`Strangler-фасад принимает запрос и решает, куда его отправить: ${sp.op}.`, `The strangler facade takes the request and decides where to send it: ${sp.op}.`, `Strangler 门面接收请求并决定转发去向：${sp.op}。`)]
      if (P('accessToken')) lines.push(tr('🎫 Проверяет подпись токена сам — без похода к серверу авторизации; без токена или с чужим — 401.', '🎫 Verifies the token signature itself, without calling the auth server; a missing or forged token means 401.', '🎫 自己校验令牌签名，无需访问授权服务器；没有令牌或伪造令牌则返回 401。'))
      if (P('bff')) lines.push(tr('📱 Для мобильного приложения ответ собирает BFF — под его экраны.', '📱 For the mobile app, the BFF assembles the response for its screens.', '📱 移动应用的响应由 BFF 按其界面组装。'))
      steps.push({ title: tr('Шлюз', 'Gateway', '网关'), lines, tone: toneOf(sp), focus: { nodes: ['gateway'], edges: [], platform: [] } })
      continue
    }
    if (sp.nodeId === KAFKA) {
      const lines = [tr(`Событие публикуется в Kafka: ${sp.op}.`, `The event is published to Kafka: ${sp.op}.`, `事件发布到 Kafka：${sp.op}。`)]
      if (P('outbox') || P('cdc'))
        lines.push(tr('📮 Сюда событие перенёс ретранслятор из таблицы outbox: оно записано в той же транзакции, что и данные, и не потеряется, даже если сервис упадёт сразу после записи.', '📮 A relay moved the event here from the outbox table: it was written in the same transaction as the data and will not be lost even if the service crashes right after.', '📮 中继把事件从 outbox 表搬到了这里：它与数据在同一事务中写入，即使服务写完就崩溃也不会丢失。'))
      else lines.push(tr('⚠ Dual write: сервис пишет в БД и публикует событие отдельно — сбой между этими шагами теряет событие.', '⚠ Dual write: the service writes to the DB and publishes the event separately; a failure in between loses the event.', '⚠ 双写：服务分别写数据库和发布事件，两步之间出错就会丢事件。'))
      lines.push(tr('Отправитель не ждёт получателя: ответ клиенту не задерживается.', 'The sender does not wait for the receiver, so the client’s response is not delayed.', '发送方不等待接收方，客户端的响应不会被拖慢。'))
      steps.push({ title: 'Kafka', lines: [...lines, ...detail], tone: toneOf(sp), focus: { nodes: ['kafka'], edges: edgeTo(KAFKA), platform: [] } })
      continue
    }
    if (sp.nodeId === MONO_DB || sp.nodeId.endsWith('-db')) {
      const own = sp.nodeId !== MONO_DB
      const lines = [sp.op]
      lines.push(
        own
          ? tr('Своя БД сервиса: её схему меняет только эта команда.', 'The service’s own DB: only this team changes its schema.', '服务自己的数据库：只有这个团队能改它的结构。')
          : tr('Общая БД монолита: эти таблицы читают и меняют все модули, любая миграция задевает всех.', 'The monolith’s shared DB: every module reads and changes these tables, any migration affects everyone.', '单体的共享数据库：所有模块都读写这些表，任何迁移都会影响所有人。'),
      )
      if (own && P('kafka') && P('outbox') && /INSERT|UPDATE/.test(sp.op))
        lines.push(tr('📮 В той же транзакции в таблицу outbox записано событие — его заберёт ретранслятор.', '📮 In the same transaction an event is written to the outbox table for the relay to pick up.', '📮 在同一事务中把事件写入 outbox 表，由中继取走。'))
      if (own && P('containers')) lines.push(tr('💾 Данные лежат на томе Kubernetes и переживают перезапуск пода.', '💾 The data lives on a Kubernetes volume and survives pod restarts.', '💾 数据存放在 Kubernetes 卷上，Pod 重启后依然保留。'))
      steps.push({ title: own ? tr('База сервиса', 'Service database', '服务数据库') : tr('Общая БД', 'Shared database', '共享数据库'), lines: [...lines, ...detail], tone: toneOf(sp), focus: { nodes: [sp.nodeId === MONO_DB ? 'monolith-db' : sp.nodeId], edges: edgeTo(sp.nodeId), platform: [] } })
      continue
    }
    const m = sp.nodeId
    const ext = s.extracted[m]
    // обработчик события или шаг саги
    if (sp.status === 'async') {
      const lines = [sp.op]
      if (P('idempotentConsumer')) lines.push(tr('♻️ Id события сверяется с таблицей обработанных: повторная доставка не выполнится второй раз.', '♻️ The event id is checked against the processed table, so a redelivery is not executed twice.', '♻️ 事件 id 会与已处理表核对，重复投递不会再执行一次。'))
      else lines.push(tr('⚠ Kafka может доставить событие повторно — без идемпотентного потребителя оно обработается дважды.', '⚠ Kafka may redeliver an event; without an idempotent consumer it is processed twice.', '⚠ Kafka 可能重复投递事件；没有幂等消费者就会被处理两次。'))
      if (P('sagaOrchestrator') && /саг|saga|Saga/.test(sp.op)) lines.push(tr('🎼 Шаги саги ведёт оркестратор: знает, что уже сделано и что откатывать при сбое.', '🎼 The orchestrator drives the saga steps: it knows what is done and what to undo on failure.', '🎼 编排器驱动 Saga 步骤：知道哪些已完成、失败时要回滚什么。'))
      steps.push({ title: tr(`«${name(m)}» получает событие`, `“${name(m)}” receives the event`, `“${name(m)}”收到事件`), lines: [...lines, ...detail], tone: sp.detail ? 'bad' : 'ok', focus: { nodes: [m, 'kafka'], edges: [], platform: P('sagaOrchestrator') ? ['sagaOrchestrator'] : [] } })
      continue
    }
    // сетевой вызов другого сервиса
    if (/^(GET|POST) http:\/\//.test(sp.op)) {
      const edges = edgeTo(m)
      const d = p.deps.find((x) => x.id === edges[0])
      const lines = [sp.op]
      if (s.infra.discovery) lines.push(tr('🧭 Адрес сервиса взят из реестра: экземпляры приходят и уходят, реестр знает живые.', '🧭 The service address comes from the registry, which knows the live instances as they come and go.', '🧭 服务地址来自注册中心：实例来来去去，注册中心知道哪些还活着。'))
      else if (P('discovery')) lines.push(tr('🧭 Адрес сервиса даёт Kubernetes (Service и DNS): живые поды он знает сам.', '🧭 Kubernetes provides the service address (Service and DNS); it knows the live pods itself.', '🧭 服务地址由 Kubernetes 提供（Service 和 DNS）：它自己知道哪些 Pod 还活着。'))
      if (P('mesh')) lines.push(tr('🕸 Вызов уходит через sidecar-прокси пода — шифрование, повторы и предохранитель делает он, а не код сервиса.', '🕸 The call goes through the pod’s sidecar proxy, which handles encryption, retries and the circuit breaker instead of service code.', '🕸 调用经由 Pod 的 sidecar 代理发出：加密、重试和熔断由它负责，而不是服务代码。'))
      if (P('mtls')) lines.push(tr('🔒 Соединение зашифровано, и стороны проверили сертификаты друг друга.', '🔒 The connection is encrypted and both sides checked each other’s certificates.', '🔒 连接已加密，双方互相校验了证书。'))
      if (P('accessToken')) lines.push(tr('🎫 Токен пользователя передан дальше — сервис знает, от чьего имени вызов.', '🎫 The user token is passed along, so the service knows on whose behalf the call is made.', '🎫 用户令牌被继续传递，服务知道是代表谁调用的。'))
      if (d && !d.critical) {
        if (sp.status === 'miss') lines.push(tr('⚡ Предохранитель открыт: сервис не отвечал, ответ не ждали — отдан запасной.', '⚡ The circuit breaker is open: the service was not responding, so no waiting; a fallback was returned.', '⚡ 熔断器已打开：服务无响应，不再等待，返回了降级结果。'))
        else if (P('circuitBreakers')) lines.push(tr('⚡ Предохранитель закрыт: ошибок мало, вызов пропущен. Если сервис начнёт падать — вызовы оборвутся сразу.', '⚡ The circuit breaker is closed: few errors, so the call goes through. If the service starts failing, calls will be cut off at once.', '⚡ 熔断器闭合：错误很少，调用放行。若服务开始故障，调用会立即被切断。'))
        else lines.push(tr('⚠ Связь некритичная, но без предохранителя зависший сервис задержит и уронит весь запрос.', '⚠ A non-critical link, but without a circuit breaker a hung service delays and fails the whole request.', '⚠ 这是非关键依赖，但没有熔断器，卡住的服务会拖慢并拖垮整个请求。'))
      }
      if (P('retry')) lines.push(tr('↻ При таймауте вызов повторится с паузой.', '↻ On a timeout the call is retried after a pause.', '↻ 超时后会间隔一段时间重试。'))
      if (P('idempotencyKeys') && sp.op.startsWith('POST')) lines.push(tr('🔑 Idempotency-Key: повтор этого запроса не выполнит действие второй раз.', '🔑 Idempotency-Key: retrying this request does not repeat the action.', '🔑 Idempotency-Key：重试这个请求不会重复执行操作。'))
      if (P('contracts')) lines.push(tr('🤝 Формат вызова проверен контрактом ещё в CI поставщика — несовместимый релиз сюда не попал бы.', '🤝 The call format was verified by a contract in the provider’s CI, so an incompatible release could not get here.', '🤝 调用格式已在提供方 CI 中用契约验证过，不兼容的版本到不了这里。'))
      steps.push({ title: tr(`Вызов «${name(m)}» по сети`, `Network call to “${name(m)}”`, `通过网络调用“${name(m)}”`), lines: [...lines, ...detail], tone: toneOf(sp), focus: { nodes: [m], edges, platform: s.infra.discovery ? ['discovery'] : [] } })
      continue
    }
    // вызов внутри процесса монолита
    if (sp.op.includes('()') && !ext && steps.length > 1 && !sp.op.startsWith('Monolith')) {
      steps.push({ title: tr('Вызов внутри монолита', 'Call inside the monolith', '单体内部调用'), lines: [sp.op, tr('Один процесс и одна транзакция — сеть не нужна, но и выпустить модули по отдельности нельзя.', 'One process and one transaction: no network needed, but the modules cannot be released separately.', '同一进程、同一事务：不需要网络，但模块也无法单独发布。'), ...detail], tone: toneOf(sp), focus: { nodes: [m], edges: edgeTo(m), platform: [] } })
      continue
    }
    // обработчик запроса в сервисе или модуле монолита
    const lines = [sp.op]
    if (ext) {
      if (P('containers')) lines.push(tr('☸ Запрос попал в один из подов сервиса; упавший под Kubernetes перезапустит, под нагрузкой добавит новые.', '☸ The request landed in one of the service’s pods; Kubernetes restarts a failed pod and adds more under load.', '☸ 请求落到该服务的某个 Pod；Pod 挂了 Kubernetes 会重启它，负载上来会再加。'))
      if (P('health')) lines.push(tr('❤ В под без пройденной пробы готовности трафик не пошёл бы.', '❤ A pod that failed its readiness probe would not get traffic.', '❤ 没通过就绪探针的 Pod 不会收到流量。'))
      if (P('canary')) lines.push(tr('🐤 5% таких запросов обслуживает новая версия v2 — если её метрики хуже, она откатится сама.', '🐤 5% of such requests are served by the new v2; if its metrics are worse, it rolls back automatically.', '🐤 这类请求有 5% 由新版本 v2 处理；指标变差就自动回滚。'))
      if (P('config')) lines.push(tr('⚙️ Настройки и адреса сервис получил из конфиг-сервера при старте.', '⚙️ The service got its settings and addresses from the config server at startup.', '⚙️ 服务启动时从配置服务器拿到了配置和地址。'))
      if (P('bulkhead')) lines.push(tr('🚢 Вызовы зависимостей идут из отдельных пулов потоков — зависшая не займёт все.', '🚢 Dependency calls use separate thread pools, so a hung one cannot take them all.', '🚢 依赖调用使用独立线程池，卡住的那个占不满全部线程。'))
    } else lines.push(tr('Модуль работает внутри монолита: один процесс, один релиз на всех.', 'The module runs inside the monolith: one process, one release for everyone.', '模块运行在单体内部：一个进程，所有人共用一次发布。'))
    const fromEdge = edgeTo(m)
    steps.push({ title: ext ? tr(`Сервис «${name(m)}»`, `“${name(m)}” service`, `“${name(m)}”服务`) : tr(`Монолит: модуль «${name(m)}»`, `Monolith: “${name(m)}” module`, `单体：“${name(m)}”模块`), lines: [...lines, ...detail], tone: toneOf(sp), focus: { nodes: [m], edges: fromEdge, platform: P('config') && ext ? ['config'] : [] } })
  }

  // финал: ответ клиенту и что осталось после запроса
  {
    const ok = t.status === 'ok'
    const code = t.httpStatus === 201 ? '201 Created' : t.httpStatus === 200 ? '200 OK' : String(t.httpStatus)
    const lines = [
      ok
        ? tr(`Клиент получил ${code} за ${Math.round(t.totalMs)} мс.`, `The client got ${code} in ${Math.round(t.totalMs)} ms.`, `客户端在 ${Math.round(t.totalMs)} ms 内收到 ${code}。`)
        : tr(`Клиент получил ошибку ${code} — причина в шаге с красной отметкой.`, `The client got error ${code}; the cause is in the step marked red.`, `客户端收到错误 ${code}，原因在标红的那一步。`),
    ]
    const platform: PatternId[] = []
    if (P('tracing')) {
      lines.push(tr('🔭 Все спаны этого запроса с одним trace id собраны в сборщике трейсов — путь выше можно открыть целиком.', '🔭 All spans of this request share one trace id and are gathered in the trace collector, so the path above can be opened in full.', '🔭 这个请求的所有 span 共用一个 trace id，汇集在链路收集器里，上面的路径可以完整查看。'))
      platform.push('tracing')
    } else if (p.modules.filter((x) => s.extracted[x.id]).length >= 2)
      lines.push(tr('⚠ Без трассировки этот путь в проде не собрать: каждый сервис видит только свой кусок.', '⚠ Without tracing this path cannot be reassembled in production: each service sees only its own piece.', '⚠ 没有链路追踪，在生产环境拼不出这条路径：每个服务只看得到自己那一段。'))
    if (P('logs')) {
      lines.push(tr('🪵 Логи всех шагов — в одном хранилище, с поиском по trace id.', '🪵 Logs of every step are in one store, searchable by trace id.', '🪵 每一步的日志都在同一个存储里，可按 trace id 检索。'))
      platform.push('logs')
    }
    if (P('metrics')) {
      lines.push(tr('📈 Задержка и код ответа попали в метрики — Prometheus заберёт их при опросе и поднимет тревогу при отклонениях.', '📈 Latency and the status code went into metrics; Prometheus scrapes them and alerts on anomalies.', '📈 延迟和响应码已记入指标；Prometheus 拉取后发现异常会告警。'))
      platform.push('metrics')
    }
    if (P('auditLog') && isWrite) {
      lines.push(tr('🧾 Запись о действии ушла в журнал аудита: кто, что и когда.', '🧾 A record of the action went to the audit log: who, what and when.', '🧾 操作记录写入了审计日志：谁、做了什么、何时。'))
      platform.push('auditLog')
    }
    steps.push({ title: tr('Ответ клиенту', 'Response to the client', '返回客户端'), lines, tone: ok ? 'ok' : 'bad', focus: { nodes: ['client'], edges: [], platform } })
  }
  // подсвечиваем только узлы платформы, которые есть на схеме (включены явно, а не покрыты другим паттерном)
  for (const st of steps) st.focus.platform = st.focus.platform.filter((k) => s.infra[k])
  return steps
}
