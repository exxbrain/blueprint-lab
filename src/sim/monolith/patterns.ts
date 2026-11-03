/**
 * Каталог паттернов микросервисов (по мотивам microservices.io и паттернов устойчивости)
 * и стресс-тесты, которые проверяют, что паттерны действительно нужны.
 */

import { tr } from '../../i18n'

export type PatternId =
  | 'gateway'
  | 'acl'
  | 'bff'
  | 'accessToken'
  | 'rateLimiter'
  | 'kafka'
  | 'discovery'
  | 'mesh'
  | 'mtls'
  | 'outbox'
  | 'cdc'
  | 'idempotentConsumer'
  | 'sagaOrchestrator'
  | 'eventSourcing'
  | 'circuitBreakers'
  | 'retry'
  | 'bulkhead'
  | 'idempotencyKeys'
  | 'tracing'
  | 'logs'
  | 'metrics'
  | 'health'
  | 'auditLog'
  | 'containers'
  | 'canary'
  | 'config'
  | 'contracts'

export interface PatternInfo {
  title: string
  icon: string
  cost: number
  desc: string
}

export interface PatternGroup {
  title: string
  patterns: PatternId[]
  /** Паттерны группы, которые настраиваются не здесь, а на модулях и связях */
  elsewhere?: { title: string; where: string }[]
}

export const PATTERNS: Record<PatternId, PatternInfo> = {
  gateway: {
    title: 'Strangler Fig / API Gateway',
    icon: '🚪',
    cost: 2,
    desc: tr('Клиенты ходят в одну точку, а фасад решает, что отправить в монолит, а что в новый сервис. С него начинается любой распил.', 'Clients call a single entry point, and the facade decides what goes to the monolith and what goes to the new service. Every decomposition starts here.', '客户端只访问一个入口，由门面决定哪些请求发给单体、哪些发给新服务。任何拆分都从这里开始。'),
  },
  acl: {
    title: 'Anti-corruption layer',
    icon: '🧱',
    cost: 1,
    desc: tr('Слой-переводчик между новым сервисом и монолитом: модель легаси не протекает в новый код, а изменения монолита ломают только переводчик.', 'A translation layer between the new service and the monolith: the legacy model does not leak into new code, and monolith changes break only the translator.', '新服务与单体之间的翻译层：遗留系统的模型不会渗入新代码，单体的改动也只会影响到这个翻译层。'),
  },
  bff: {
    title: 'Backend for Frontend',
    icon: '📱',
    cost: 2,
    desc: tr('Отдельный бэкенд под каждый клиент (мобильное, веб): собирает данные из нескольких сервисов в один ответ под экран.', 'A dedicated backend per client (mobile, web): it aggregates data from several services into one response per screen.', '为每种客户端（移动端、Web）提供专属后端：把多个服务的数据聚合成一个适配页面的响应。'),
  },
  accessToken: {
    title: 'Access token (JWT)',
    icon: '🎫',
    cost: 1,
    desc: tr('Шлюз проверяет пользователя и передаёт сервисам подписанный токен с его правами. Сервисы не ходят в монолит за сессией.', 'The gateway authenticates the user and passes services a signed token with their permissions. Services do not call the monolith for the session.', '网关验证用户身份，并把带有其权限的签名令牌传给各个服务。服务不必再去单体那里查会话。'),
  },
  rateLimiter: {
    title: 'Rate limiter',
    icon: '🚧',
    cost: 1,
    desc: tr('Ограничивает число запросов от клиента или в целом. Лишнее отбрасывается сразу, а не роняет систему.', 'Limits the number of requests per client or overall. Excess load is rejected immediately instead of bringing the system down.', '限制单个客户端或整体的请求数。超出的请求会被立即拒绝，而不会把系统压垮。'),
  },
  kafka: {
    title: tr('Брокер сообщений (Kafka)', 'Message broker (Kafka)', '消息 Broker（Kafka）'),
    icon: '📜',
    cost: 4,
    desc: tr('Основа асинхронного обмена: доменные события, саги, реплики данных.', 'The backbone of asynchronous messaging: domain events, sagas, data replicas.', '异步通信的基础：领域事件、Saga、数据副本。'),
  },
  discovery: {
    title: 'Service discovery',
    icon: '🧭',
    cost: 1,
    desc: tr('Реестр, где сервисы находят друг друга. Без него адреса зашиты в конфиги и ломаются при каждом перезапуске и масштабировании.', 'A registry where services find each other. Without it, addresses are hard-coded in configs and break on every restart and scale-out.', '服务之间互相查找的注册中心。没有它，地址就得硬编码在配置里，每次重启和扩容都会失效。'),
  },
  mesh: {
    title: 'Service mesh (sidecar)',
    icon: '🕸️',
    cost: 4,
    desc: tr('Прокси рядом с каждым сервисом берут на себя mTLS, ретраи, таймауты и circuit breaker без изменения кода. Добавляет пару миллисекунд на каждый вызов.', 'Proxies next to each service handle mTLS, retries, timeouts and circuit breaking without code changes. Adds a couple of milliseconds to every call.', '每个服务旁边的代理负责 mTLS、重试、超时和熔断，无需修改代码。每次调用会多出几毫秒。'),
  },
  mtls: {
    title: tr('mTLS между сервисами', 'mTLS between services', '服务间 mTLS'),
    icon: '🔐',
    cost: 1,
    desc: tr('Сервисы проверяют сертификаты друг друга: взломанный сервис не может притвориться другим.', 'Services verify each other\'s certificates: a compromised service cannot impersonate another.', '服务之间互相校验证书：被攻破的服务无法冒充其他服务。'),
  },
  outbox: {
    title: 'Transactional Outbox',
    icon: '📮',
    cost: 1,
    desc: tr('Событие пишется в таблицу outbox в той же транзакции, что и данные, а затем публикуется. Решает проблему dual write.', 'The event is written to an outbox table in the same transaction as the data and published afterwards. Solves the dual-write problem.', '事件与数据在同一个事务中写入 outbox 表，之后再发布出去。解决了 dual write（双写）问题。'),
  },
  cdc: {
    title: 'CDC (transaction log tailing)',
    icon: '🪵',
    cost: 2,
    desc: tr('Debezium читает журнал транзакций БД и публикует изменения в брокер. Тоже решает dual write и работает даже с легаси-монолитом без правок кода.', 'Debezium reads the database transaction log and publishes changes to the broker. Also solves dual write and works even with a legacy monolith without code changes.', 'Debezium 读取数据库的事务日志，把变更发布到 Broker。同样能解决 dual write，而且即使是遗留单体也无需修改代码就能用。'),
  },
  idempotentConsumer: {
    title: 'Idempotent consumer',
    icon: '♻️',
    cost: 1,
    desc: tr('Получатель запоминает id обработанных сообщений и пропускает повторы. Брокеры гарантируют at-least-once, так что дубли будут.', 'The consumer remembers the ids of processed messages and skips repeats. Brokers guarantee at-least-once delivery, so duplicates will happen.', '消费者记住已处理消息的 id，跳过重复的消息。Broker 只保证 at-least-once 投递，所以重复消息一定会出现。'),
  },
  sagaOrchestrator: {
    title: tr('Оркестратор саг', 'Saga orchestrator', 'Saga 编排器'),
    icon: '🎼',
    cost: 2,
    desc: tr('Сага как явный процесс (Temporal, Camunda): видно, на каком шаге она остановилась, компенсации запускаются централизованно. Альтернатива — хореография на событиях.', 'A saga as an explicit process (Temporal, Camunda): you can see which step it stopped at, and compensations run centrally. The alternative is event-based choreography.', '把 Saga 做成显式的流程（Temporal、Camunda）：能看到它停在了哪一步，补偿操作集中触发。另一种做法是基于事件的编舞（choreography）。'),
  },
  eventSourcing: {
    title: 'Event sourcing',
    icon: '📚',
    cost: 3,
    desc: tr('Состояние хранится как последовательность событий. Полная история изменений бесплатно, но запросы к текущему состоянию нужны через проекции.', 'State is stored as a sequence of events. Full change history for free, but queries on current state require projections.', '状态以事件序列的形式存储。完整的变更历史“免费”附带，但查询当前状态需要借助投影。'),
  },
  circuitBreakers: {
    title: tr('Circuit breaker + таймауты', 'Circuit breaker + timeouts', 'Circuit breaker + 超时'),
    icon: '🔌',
    cost: 1,
    desc: tr('После серии ошибок вызовы к зависимости сразу возвращают ошибку или fallback, не ожидая таймаута. Некритичная зависимость больше не роняет вызывающего.', 'After a series of errors, calls to the dependency immediately return an error or fallback without waiting for a timeout. A non-critical dependency no longer takes down the caller.', '连续出错之后，对该依赖的调用会立即返回错误或 fallback，而不必等到超时。非关键依赖不会再拖垮调用方。'),
  },
  retry: {
    title: tr('Retry с backoff и jitter', 'Retry with backoff and jitter', '带 backoff 和 jitter 的重试'),
    icon: '🔁',
    cost: 1,
    desc: tr('Повтор при кратковременных сбоях с растущей случайной паузой. Без идемпотентности повтор может выполнить операцию дважды.', 'Retries on transient failures with a growing randomized delay. Without idempotency, a retry may execute the operation twice.', '遇到短暂故障时重试，间隔逐渐增大并带有随机性。没有幂等性的话，重试可能让操作执行两次。'),
  },
  bulkhead: {
    title: 'Bulkhead',
    icon: '🚢',
    cost: 1,
    desc: tr('Отдельные пулы потоков и соединений на каждую зависимость: зависшая внешняя система съедает только свой пул.', 'Separate thread and connection pools per dependency: a hung external system exhausts only its own pool.', '为每个依赖分配独立的线程池和连接池：卡住的外部系统只会耗尽它自己的那一份。'),
  },
  idempotencyKeys: {
    title: 'Idempotency key',
    icon: '🔑',
    cost: 1,
    desc: tr('Клиент передаёт уникальный ключ операции, сервер не выполняет её повторно. Обязателен для ретраев денежных операций.', 'The client sends a unique operation key, and the server does not execute it twice. Mandatory for retrying money operations.', '客户端传入唯一的操作键，服务器不会重复执行同一操作。对资金操作做重试时必不可少。'),
  },
  tracing: {
    title: 'Distributed tracing',
    icon: '🔭',
    cost: 1,
    desc: tr('Сквозной trace id через все сервисы: видно, где запрос провёл время.', 'An end-to-end trace id across all services: you can see where a request spent its time.', '贯穿所有服务的端到端 trace id：可以看到请求把时间花在了哪里。'),
  },
  logs: {
    title: 'Log aggregation',
    icon: '🧾',
    cost: 1,
    desc: tr('Логи всех сервисов в одном месте с поиском по trace id.', 'Logs from all services in one place, searchable by trace id.', '所有服务的日志集中在一处，可以按 trace id 搜索。'),
  },
  metrics: {
    title: tr('Application metrics + алерты', 'Application metrics + alerts', '应用指标 + 告警'),
    icon: '📈',
    cost: 1,
    desc: tr('RED/USE-метрики каждого сервиса и алерты на них: узнаёте о проблеме раньше клиентов.', 'RED/USE metrics for every service with alerts on them: you learn about a problem before your customers do.', '每个服务都有 RED/USE 指标，并配有告警：在客户发现问题之前，你就能知道。'),
  },
  health: {
    title: 'Health check API',
    icon: '❤️',
    cost: 1,
    desc: tr('Эндпоинт, по которому балансировщик и оркестратор понимают, что экземпляр жив и готов принимать трафик.', 'An endpoint that tells the load balancer and orchestrator the instance is alive and ready for traffic.', '一个 endpoint，负载均衡器和编排器通过它判断实例是否存活、是否已准备好接收流量。'),
  },
  auditLog: {
    title: 'Audit logging',
    icon: '🗂️',
    cost: 1,
    desc: tr('Журнал действий пользователей и изменений данных в отдельном хранилище.', 'A log of user actions and data changes in a separate store.', '把用户操作和数据变更记录到独立存储中的日志。'),
  },
  containers: {
    title: tr('Контейнеры + оркестратор (k8s)', 'Containers + orchestrator (k8s)', '容器 + 编排器（k8s）'),
    icon: '☸️',
    cost: 3,
    desc: tr('Каждый сервис — контейнер, Kubernetes перезапускает, масштабирует (HPA) и даёт встроенный discovery через DNS.', 'Every service is a container; Kubernetes restarts and scales it (HPA) and provides built-in discovery via DNS.', '每个服务都是一个容器；Kubernetes 负责重启和扩展它（HPA），并通过 DNS 提供内置的服务发现。'),
  },
  canary: {
    title: tr('Canary / blue-green релизы', 'Canary / blue-green releases', '金丝雀 / 蓝绿发布'),
    icon: '🐤',
    cost: 2,
    desc: tr('Новая версия сначала получает 5% трафика. Если метрики хуже — автоматический откат.', 'A new version first gets 5% of traffic. If metrics get worse, it rolls back automatically.', '新版本先只接收 5% 的流量。如果指标变差，就自动回滚。'),
  },
  config: {
    title: 'Externalized configuration',
    icon: '⚙️',
    cost: 1,
    desc: tr('Настройки и адреса вынесены из сборки в конфиг-сервер или переменные окружения: меняются без релиза.', 'Settings and addresses live outside the build in a config server or environment variables: they change without a release.', '配置和地址不打包进构建产物，而是放在配置服务器或环境变量中：修改它们无需发布。'),
  },
  contracts: {
    title: 'Consumer-driven contracts',
    icon: '🤝',
    cost: 1,
    desc: tr('Потребители описывают, что они ждут от API, и эти контракты проверяются в CI поставщика (Pact).', 'Consumers describe what they expect from an API, and these contracts are verified in the provider\'s CI (Pact).', '消费方描述自己对 API 的期望，这些契约会在提供方的 CI 中得到验证（Pact）。'),
  },
}

export const PATTERN_GROUPS: PatternGroup[] = [
  {
    title: tr('Декомпозиция', 'Decomposition', '拆分'),
    patterns: ['gateway', 'acl'],
    elsewhere: [
      { title: 'Decompose by business capability', where: tr('кнопка «Вынести в сервис»', '“Extract into a service” button', '“拆成服务”按钮') },
      { title: 'Database per service', where: tr('кнопка «Своя БД»', '“Own database” button', '“独立数据库”按钮') },
    ],
  },
  { title: tr('Внешний API', 'External API', '对外 API'), patterns: ['bff', 'accessToken', 'rateLimiter'] },
  {
    title: tr('Коммуникация', 'Communication', '通信'),
    patterns: ['kafka', 'discovery', 'mesh', 'mtls'],
    elsewhere: [
      { title: 'Remote procedure invocation', where: tr('режим связи «REST»', '“REST” link mode', '“REST”连接方式') },
      { title: 'Domain events', where: tr('режим связи «событие»', '“event” link mode', '“事件”连接方式') },
    ],
  },
  {
    title: tr('Данные', 'Data', '数据'),
    patterns: ['outbox', 'cdc', 'idempotentConsumer', 'sagaOrchestrator', 'eventSourcing'],
    elsewhere: [
      { title: 'Saga', where: tr('режим связи «сага»', '“saga” link mode', '“Saga”连接方式') },
      { title: 'CQRS / event-carried state', where: tr('режим связи «реплика»', '“replica” link mode', '“副本”连接方式') },
      { title: 'API composition', where: tr('режим связи «API»', '“API” link mode', '“API”连接方式') },
      { title: tr('Shared database (антипаттерн)', 'Shared database (anti-pattern)', 'Shared database（反模式）'), where: tr('режим «SQL в чужую БД»', '“SQL into another DB” mode', '“用 SQL 访问他人数据库”方式') },
    ],
  },
  { title: tr('Устойчивость', 'Resilience', '韧性'), patterns: ['circuitBreakers', 'retry', 'bulkhead', 'idempotencyKeys'] },
  { title: tr('Наблюдаемость', 'Observability', '可观测性'), patterns: ['tracing', 'logs', 'metrics', 'health', 'auditLog'] },
  { title: tr('Деплой и конфигурация', 'Deployment and configuration', '部署与配置'), patterns: ['containers', 'canary', 'config'] },
  { title: tr('Тестирование', 'Testing', '测试'), patterns: ['contracts'] },
]

export type Patterns = Record<PatternId, boolean>

export function noPatterns(): Patterns {
  return Object.fromEntries(Object.keys(PATTERNS).map((k) => [k, false])) as Patterns
}

/** Паттерн включён сам или его покрывает другой (mesh даёт mTLS, ретраи, CB; k8s даёт discovery) */
export function has(p: Patterns, id: PatternId): boolean {
  if (p[id]) return true
  if (p.mesh && (id === 'mtls' || id === 'retry' || id === 'circuitBreakers' || id === 'discovery')) return true
  if (p.containers && id === 'discovery') return true
  return false
}

export function patternsCost(p: Patterns): number {
  return (Object.keys(PATTERNS) as PatternId[]).reduce((s, k) => s + (p[k] ? PATTERNS[k].cost : 0), 0)
}

// ---------------- стресс-тесты ----------------

export interface StressContext {
  has: (id: PatternId) => boolean
  services: number // вынесенных сервисов
  syncCrossing: boolean // есть сетевые синхронные вызовы
  criticalSyncCrossing: boolean // ...среди них критичные (деньги, заказы)
  eventCrossing: boolean // есть обмен событиями
  sagas: boolean
  monolithCrossing: boolean // новый сервис разговаривает с монолитом
  heavyReads: boolean // в системе есть тяжёлые некритичные чтения
  heavyReadsIsolated: boolean // ...и все они вынесены в реплики
  external: string // самая медленная внешняя зависимость
}

export interface StressTest {
  id: string
  title: (c: StressContext) => string
  applies: (c: StressContext) => boolean
  ok: (c: StressContext) => boolean
  /** Что спасает: id паттернов или текст */
  fix: (PatternId | string)[]
  fail: string
  /** Что система должна уметь, чтобы пройти учения — без названий паттернов */
  need: string
}

export const STRESS_TESTS: StressTest[] = [
  {
    id: 'peak',
    title: () => tr('Пик нагрузки ×5', 'Load peak ×5', '负载峰值 ×5'),
    applies: () => true,
    ok: (c) => c.has('rateLimiter') && c.has('containers'),
    fix: ['rateLimiter', 'containers'],
    need: tr('Отбрасывать лишние запросы на входе, а не захлёбываться ими, и автоматически добавлять экземпляры под нагрузку', 'Turn away excess requests at the door instead of drowning in them, and add instances automatically under load', '在入口处就把多余的请求挡回去，而不是被它们淹没；负载上来时自动增加实例'),
    fail: tr('Очередь запросов растёт, таймауты, затем каскадное падение', 'The request queue grows, timeouts follow, then a cascading failure', '请求队列不断变长，接着出现超时，然后是级联故障'),
  },
  {
    id: 'slow-dep',
    title: (c) => tr(`${c.external} отвечает 30 секунд`, `${c.external} takes 30 seconds to respond`, `${c.external} 需要 30 秒才响应`),
    applies: () => true,
    ok: (c) => c.has('circuitBreakers') && c.has('bulkhead'),
    fix: ['circuitBreakers', 'bulkhead'],
    need: tr('Через пару секунд перестать ждать зависшую систему и не давать ей занять все потоки и соединения сервиса', 'Stop waiting for a hung system after a couple of seconds and keep it from tying up all of the service’s threads and connections', '几秒之后就不再等待卡住的系统，也不让它占满服务的所有线程和连接'),
    fail: tr('Все потоки ждут ответа, приложение не отвечает даже на то, что с этой системой не связано', 'All threads wait for a response; the app stops responding even to requests unrelated to that system', '所有线程都在等待响应；应用连与该系统无关的请求也不再响应'),
  },
  {
    id: 'flaky',
    title: () => tr('1% сетевых вызовов падает', '1% of network calls fail', '1% 的网络调用失败'),
    applies: (c) => c.syncCrossing,
    ok: (c) => c.has('retry'),
    fix: ['retry'],
    need: tr('Сам повторять запрос, если он упал из-за кратковременного сбоя сети, — с паузой, чтобы не добить сервис', 'Retry a request that failed due to a brief network glitch on its own — with a pause, so as not to finish off the service', '请求因短暂的网络抖动失败时，自己重新发送——并留出间隔，免得把服务彻底压垮'),
    fail: tr('Каждая сотая операция завершается ошибкой у клиента', 'One in a hundred operations fails for the customer', '每一百次操作就有一次在客户那里失败'),
  },
  {
    id: 'double',
    title: () => tr('Ретрай повторил денежную операцию', 'A retry repeated a money operation', '一次重试重复执行了资金操作'),
    applies: (c) => c.has('retry') && c.criticalSyncCrossing,
    ok: (c) => c.has('idempotencyKeys'),
    fix: ['idempotencyKeys'],
    need: tr('Узнавать повтор той же денежной операции и не выполнять её второй раз', 'Recognize a repeat of the same money operation and not execute it twice', '识别出同一笔资金操作的重复请求，不执行第二次'),
    fail: tr('Ответ потерялся по сети, клиент повторил, деньги списаны дважды', 'The response was lost in the network, the client retried, and the money was debited twice', '响应在网络中丢失，客户端重试，钱被扣了两次'),
  },
  {
    id: 'dup-events',
    title: () => tr('Брокер доставил событие дважды', 'The broker delivered an event twice', 'Broker 把一个事件投递了两次'),
    applies: (c) => c.eventCrossing,
    ok: (c) => c.has('idempotentConsumer'),
    fix: ['idempotentConsumer'],
    need: tr('Получать одно и то же сообщение дважды без удвоения результата', 'Receive the same message twice without doubling the result', '同一条消息收到两次，结果也不会翻倍'),
    fail: tr('После ребалансировки событие обработано повторно', 'After a rebalance, the event was processed again', '重平衡之后，事件又被处理了一遍'),
  },
  {
    id: 'bad-deploy',
    title: () => tr('Релиз с ошибкой', 'A buggy release', '带 bug 的版本发布'),
    applies: () => true,
    // откатывать автоматически можно только по метрикам: доля ошибок и задержки новой версии против старой
    ok: (c) => c.has('canary') && c.has('health') && c.has('metrics'),
    fix: ['canary', 'health', 'metrics'],
    need: tr('Выкатывать новую версию сначала на малую долю пользователей, сравнивать ошибки и откатывать автоматически; понимать, какой экземпляр жив и готов к трафику', 'Roll out a new version to a small share of users first, compare errors and roll back automatically; know which instance is alive and ready for traffic', '先把新版本发布给一小部分用户，对比错误并自动回滚；知道哪个实例存活、已准备好接收流量'),
    fail: tr('Ошибку увидели все клиенты сразу, откат вручную ночью', 'All customers saw the bug at once; manual rollback at night', '所有客户同时遇到了 bug；深夜手动回滚'),
  },
  {
    id: 'debug',
    title: () => tr('Ночной инцидент: где тормозит?', 'Night-time incident: where is it slow?', '深夜事故：哪里变慢了？'),
    applies: (c) => c.services >= 2,
    ok: (c) => c.has('tracing') && c.has('logs') && c.has('metrics'),
    fix: ['tracing', 'logs', 'metrics'],
    need: tr('Видеть путь одного запроса через все сервисы с таймингами, а его логи и метрики — в одном месте', 'See the path of a single request through every service with timings, and its logs and metrics in one place', '看到单个请求穿过所有服务的路径和各段耗时，并在同一处查看它的日志和指标'),
    fail: tr('Пять команд четыре часа ищут, чей сервис виноват', 'Five teams spend four hours figuring out whose service is to blame', '五个团队花了四个小时查到底是谁的服务出了问题'),
  },
  {
    id: 'contract',
    title: () => tr('Команда-поставщик поменяла API', 'The provider team changed its API', '提供方团队修改了 API'),
    applies: (c) => c.syncCrossing,
    ok: (c) => c.has('contracts'),
    fix: ['contracts'],
    need: tr('Ловить ломающие изменения API ещё в сборке поставщика, до того как их увидят потребители', 'Catch breaking API changes in the provider’s build, before consumers see them', '在提供方构建时就发现破坏性的 API 变更，赶在消费方看到之前'),
    fail: tr('Потребитель узнал об изменении из ошибок в проде', 'The consumer found out about the change from production errors', '消费方是从生产环境的报错中得知这次变更的'),
  },
  {
    id: 'legacy-model',
    title: () => tr('Монолит переименовал поля', 'The monolith renamed fields', '单体重命名了字段'),
    applies: (c) => c.monolithCrossing,
    ok: (c) => c.has('acl'),
    fix: ['acl'],
    need: tr('Переводить модель данных монолита на границе, чтобы она не расползалась по коду новых сервисов', 'Translate the monolith’s data model at the boundary so it does not spread through the new services’ code', '在边界上转换单体的数据模型，不让它蔓延到新服务的代码中'),
    fail: tr('Модель легаси протекла в новые сервисы, правки расползлись по всем', 'The legacy model leaked into the new services, and the changes spread to all of them', '遗留模型渗入了新服务，改动波及所有服务'),
  },
  {
    id: 'scale-out',
    title: () => tr('Автоскейлинг поднял 10 экземпляров', 'Autoscaling spun up 10 instances', '自动扩展拉起了 10 个实例'),
    applies: (c) => c.services >= 2,
    ok: (c) => c.has('discovery'),
    fix: ['discovery', 'containers'],
    need: tr('Находить живые экземпляры сервисов по имени, а не по адресам, зашитым в конфиг', 'Find live service instances by name rather than by addresses baked into config', '按名称找到存活的服务实例，而不是依赖写死在配置里的地址'),
    fail: tr('Новые экземпляры никто не видит, старые адреса в конфигах', 'Nobody sees the new instances; configs still have the old addresses', '没人看得到新实例；配置里还是旧地址'),
  },
  {
    id: 'security',
    title: () => tr('Взломан один сервис во внутренней сети', 'One service on the internal network is compromised', '内网中的一个服务被攻破'),
    applies: (c) => c.services >= 1,
    ok: (c) => c.has('mtls') && c.has('accessToken'),
    fix: ['mtls', 'accessToken'],
    need: tr('Проверять, какой именно сервис звонит и от имени какого пользователя он действует', 'Verify exactly which service is calling and on behalf of which user it acts', '验证到底是哪个服务在调用，以及它代表哪个用户在操作'),
    fail: tr('Злоумышленник вызывает любые сервисы от имени любого пользователя', 'The attacker calls any service on behalf of any user', '攻击者能以任意用户的身份调用任意服务'),
  },
  {
    id: 'mobile',
    title: () => tr('Мобильному экрану нужно 6 запросов', 'A mobile screen needs 6 requests', '移动端一个页面需要 6 个请求'),
    applies: (c) => c.services >= 2,
    ok: (c) => c.has('bff'),
    fix: ['bff'],
    need: tr('Отдавать мобильному экрану все нужные ему данные одним ответом', 'Give the mobile screen all the data it needs in a single response', '用一个响应把移动端页面需要的所有数据一次性交给它'),
    fail: tr('На мобильном интернете главный экран грузится 4 секунды', 'On mobile data, the home screen takes 4 seconds to load', '在移动网络下，首页要 4 秒才能加载完'),
  },
  {
    id: 'audit',
    title: () => tr('Регулятор просит историю изменений за год', 'The regulator asks for a year of change history', '监管机构要求提供一年的变更历史'),
    applies: () => true,
    ok: (c) => c.has('auditLog') || c.has('eventSourcing'),
    fix: ['auditLog', 'eventSourcing'],
    need: tr('Хранить неизменяемую историю изменений: кто, что и когда сделал', 'Keep an immutable history of changes: who did what and when', '保存不可变的变更历史：谁、在什么时候、做了什么'),
    fail: tr('Историю восстанавливают по бэкапам две недели', 'Reconstructing the history from backups takes two weeks', '从备份中恢复历史要花两周'),
  },
  {
    id: 'config',
    title: (c) => tr(`Сменить адрес: ${c.external} без релиза`, `Change the address of ${c.external} without a release`, `不发布就修改 ${c.external} 的地址`),
    applies: () => true,
    ok: (c) => c.has('config'),
    fix: ['config'],
    need: tr('Менять адреса и настройки без пересборки и релиза', 'Change addresses and settings without rebuilding and releasing', '修改地址和配置时无需重新构建和发布'),
    fail: tr('Адрес зашит в сборку: внеплановый релиз всех сервисов', 'The address is baked into the build: an unplanned release of every service', '地址写死在构建产物里：所有服务都得临时发布一次'),
  },
  {
    id: 'saga-stuck',
    title: () => tr('Сага зависла на полпути', 'A saga got stuck halfway', 'Saga 卡在了半路'),
    applies: (c) => c.sagas,
    ok: (c) => c.has('sagaOrchestrator') || (c.has('tracing') && c.has('logs')),
    fix: ['sagaOrchestrator', 'tracing + logs'],
    need: tr('Видеть, на каком шаге остановилась многошаговая операция в нескольких сервисах, и уметь довести её до конца или откатить', 'See at which step a multi-step operation across several services stopped, and be able to finish it or roll it back', '看到跨多个服务的多步操作停在了哪一步，并能把它继续执行完或回滚'),
    fail: tr('Деньги списаны, заказ не создан, и никто не знает, на каком шаге всё остановилось', 'Money debited, order not created, and nobody knows at which step everything stopped', '钱已扣，订单没创建，也没人知道流程停在了哪一步'),
  },
  {
    id: 'heavy-read',
    title: () => tr('Тяжёлый отчёт в разгар дня', 'A heavy report at peak hours', '高峰时段的一份重型报表'),
    applies: (c) => c.heavyReads,
    ok: (c) => c.heavyReadsIsolated,
    fix: [tr('реплики (CQRS) на всех тяжёлых чтениях — отчётах, выгрузках, агрегатах', 'replicas (CQRS) for all heavy reads — reports, exports, aggregates', '在所有重型读取上使用副本（CQRS）——报表、导出、聚合')],
    need: tr('Дать тяжёлым отчётам и выгрузкам свою копию данных, чтобы они не читали боевую базу', 'Give heavy reports and exports their own copy of the data so they do not read the production database', '给重型报表和导出单独一份数据副本，让它们不去读生产数据库'),
    fail: tr('Отчёт сделал full scan по основной БД, и встали все', 'The report did a full scan of the main database, and everything ground to a halt', '报表对主数据库做了全表扫描（full scan），整个系统都卡住了'),
  },
]

// ---------------- лишние паттерны ----------------

/**
 * Паттерн лишний, если в текущей архитектуре он ничего не решает
 * или дублирует другой включённый паттерн. Оверинжиниринг — тоже проблема:
 * каждый паттерн надо поддерживать, мониторить и объяснять новичкам.
 */
export function excessPatterns(p: Patterns, c: StressContext): { id: PatternId; reason: string }[] {
  const out: { id: PatternId; reason: string }[] = []
  const flag = (id: PatternId, reason: string) => {
    if (p[id] && !out.some((o) => o.id === id)) out.push({ id, reason })
  }
  const dup = (id: PatternId, by: PatternId) => flag(id, tr(`уже даёт «${PATTERNS[by].title}»`, `already provided by “${PATTERNS[by].title}”`, `已由“${PATTERNS[by].title}”提供`))

  if (!c.eventCrossing) {
    flag('kafka', tr('нет ни одной связи на событиях', 'no event-based links at all', '没有任何基于事件的连接'))
    flag('outbox', tr('нечего публиковать: событий нет', 'nothing to publish: there are no events', '没有可发布的内容：没有事件'))
    flag('cdc', tr('нечего публиковать: событий нет', 'nothing to publish: there are no events', '没有可发布的内容：没有事件'))
    flag('idempotentConsumer', tr('нет получателей событий', 'no event consumers', '没有事件消费者'))
  } else if (p.outbox) {
    flag(
      'cdc',
      tr(
        'dual write уже решён через Outbox. CDC имеет смысл как способ доставки outbox-таблицы в брокер (Debezium Outbox Router), но в этой схеме он не нужен: события уже публикуются',
        'dual write is already solved by Outbox. CDC makes sense as a way to ship the outbox table to the broker (Debezium Outbox Router), but here it is not needed: events are already published',
        'dual write 已经由 Outbox 解决。CDC 可以用来把 outbox 表投递到 Broker（Debezium Outbox Router），但在这个方案里并不需要：事件已经在发布了',
      ),
    )
  }
  if (!c.sagas) flag('sagaOrchestrator', tr('нет ни одной саги', 'no sagas at all', '一个 Saga 都没有'))
  if (p.auditLog) flag('eventSourcing', tr('история для регулятора уже есть в Audit logging, а event sourcing втрое дороже', 'Audit logging already provides history for the regulator, and event sourcing costs three times as much', 'Audit logging 已经能为监管机构提供历史，而 event sourcing 的成本是它的三倍'))
  if (!c.syncCrossing) {
    flag('retry', tr('нет сетевых вызовов между сервисами', 'no network calls between services', '服务之间没有网络调用'))
    flag('contracts', tr('нет API между сервисами — проверять нечего', 'no APIs between services — nothing to verify', '服务之间没有 API——没有什么需要验证'))
  }
  if (!(p.retry || p.mesh) || !c.criticalSyncCrossing) flag('idempotencyKeys', tr('нет ретраев денежных операций', 'no retries of money operations', '没有对资金操作的重试'))
  if (!c.monolithCrossing) flag('acl', tr('новые сервисы не общаются с монолитом', 'the new services do not talk to the monolith', '新服务不和单体通信'))
  if (c.services < 1) {
    flag('mtls', tr('сервисов нет — шифровать нечего', 'no services — nothing to encrypt', '没有服务——没有需要加密的内容'))
    flag('accessToken', tr('сервисов нет — токен передавать некому', 'no services — nobody to pass a token to', '没有服务——令牌无处可传'))
    flag('mesh', tr('сервисов нет — sidecar ставить некуда', 'no services — nowhere to put a sidecar', '没有服务——sidecar 无处可放'))
  }
  if (c.services < 2) {
    flag('bff', tr('пока один бэкенд — собирать ответ не из чего', 'only one backend so far — nothing to aggregate', '目前只有一个后端——没有可聚合的东西'))
    flag('discovery', tr('меньше двух сервисов — искать некого', 'fewer than two services — nothing to discover', '服务少于两个——没有需要发现的对象'))
    // метрики лишними не бывают: без них не видно ни нагрузки, ни деградации
    if (!(c.sagas && !p.sagaOrchestrator)) {
      flag('tracing', tr('трассировать нечего: запрос не покидает процесс', 'nothing to trace: requests never leave the process', '没有可追踪的内容：请求从未离开进程'))
      // много экземпляров в контейнерах — логи уже разбросаны по машинам, сборщик нужен
      if (!p.containers) flag('logs', tr('все логи и так в одном месте', 'all logs are already in one place', '所有日志本来就在一处'))
    }
  }
  if (p.mesh) {
    dup('circuitBreakers', 'mesh')
    dup('retry', 'mesh')
    dup('mtls', 'mesh')
    flag('discovery', tr('service mesh опирается на реестр сервисов платформы — отдельный discovery не нужен', 'the service mesh relies on the platform’s service registry, so a separate discovery is not needed', 'service mesh 依赖平台的服务注册中心，因此不需要单独的服务发现'))
  } else if (p.containers) {
    dup('discovery', 'containers')
  }
  return out
}
