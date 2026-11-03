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
    desc: tr('Клиенты ходят в одну точку, а фасад решает, что отправить в монолит, а что в новый сервис. С него начинается любой распил.', 'Clients call a single entry point, and the facade decides what goes to the monolith and what goes to the new service. Every decomposition starts here.'),
  },
  acl: {
    title: 'Anti-corruption layer',
    icon: '🧱',
    cost: 1,
    desc: tr('Слой-переводчик между новым сервисом и монолитом: модель легаси не протекает в новый код, а изменения монолита ломают только переводчик.', 'A translation layer between the new service and the monolith: the legacy model does not leak into new code, and monolith changes break only the translator.'),
  },
  bff: {
    title: 'Backend for Frontend',
    icon: '📱',
    cost: 2,
    desc: tr('Отдельный бэкенд под каждый клиент (мобильное, веб): собирает данные из нескольких сервисов в один ответ под экран.', 'A dedicated backend per client (mobile, web): it aggregates data from several services into one response per screen.'),
  },
  accessToken: {
    title: 'Access token (JWT)',
    icon: '🎫',
    cost: 1,
    desc: tr('Шлюз проверяет пользователя и передаёт сервисам подписанный токен с его правами. Сервисы не ходят в монолит за сессией.', 'The gateway authenticates the user and passes services a signed token with their permissions. Services do not call the monolith for the session.'),
  },
  rateLimiter: {
    title: 'Rate limiter',
    icon: '🚧',
    cost: 1,
    desc: tr('Ограничивает число запросов от клиента или в целом. Лишнее отбрасывается сразу, а не роняет систему.', 'Limits the number of requests per client or overall. Excess load is rejected immediately instead of bringing the system down.'),
  },
  kafka: {
    title: tr('Брокер сообщений (Kafka)', 'Message broker (Kafka)'),
    icon: '📜',
    cost: 4,
    desc: tr('Основа асинхронного обмена: доменные события, саги, реплики данных.', 'The backbone of asynchronous messaging: domain events, sagas, data replicas.'),
  },
  discovery: {
    title: 'Service discovery',
    icon: '🧭',
    cost: 1,
    desc: tr('Реестр, где сервисы находят друг друга. Без него адреса зашиты в конфиги и ломаются при каждом перезапуске и масштабировании.', 'A registry where services find each other. Without it, addresses are hard-coded in configs and break on every restart and scale-out.'),
  },
  mesh: {
    title: 'Service mesh (sidecar)',
    icon: '🕸️',
    cost: 4,
    desc: tr('Прокси рядом с каждым сервисом берут на себя mTLS, ретраи, таймауты и circuit breaker без изменения кода. Добавляет пару миллисекунд на каждый вызов.', 'Proxies next to each service handle mTLS, retries, timeouts and circuit breaking without code changes. Adds a couple of milliseconds to every call.'),
  },
  mtls: {
    title: tr('mTLS между сервисами', 'mTLS between services'),
    icon: '🔐',
    cost: 1,
    desc: tr('Сервисы проверяют сертификаты друг друга: взломанный сервис не может притвориться другим.', 'Services verify each other\'s certificates: a compromised service cannot impersonate another.'),
  },
  outbox: {
    title: 'Transactional Outbox',
    icon: '📮',
    cost: 1,
    desc: tr('Событие пишется в таблицу outbox в той же транзакции, что и данные, а затем публикуется. Решает проблему dual write.', 'The event is written to an outbox table in the same transaction as the data and published afterwards. Solves the dual-write problem.'),
  },
  cdc: {
    title: 'CDC (transaction log tailing)',
    icon: '🪵',
    cost: 2,
    desc: tr('Debezium читает журнал транзакций БД и публикует изменения в брокер. Тоже решает dual write и работает даже с легаси-монолитом без правок кода.', 'Debezium reads the database transaction log and publishes changes to the broker. Also solves dual write and works even with a legacy monolith without code changes.'),
  },
  idempotentConsumer: {
    title: 'Idempotent consumer',
    icon: '♻️',
    cost: 1,
    desc: tr('Получатель запоминает id обработанных сообщений и пропускает повторы. Брокеры гарантируют at-least-once, так что дубли будут.', 'The consumer remembers the ids of processed messages and skips repeats. Brokers guarantee at-least-once delivery, so duplicates will happen.'),
  },
  sagaOrchestrator: {
    title: tr('Оркестратор саг', 'Saga orchestrator'),
    icon: '🎼',
    cost: 2,
    desc: tr('Сага как явный процесс (Temporal, Camunda): видно, на каком шаге она остановилась, компенсации запускаются централизованно. Альтернатива — хореография на событиях.', 'A saga as an explicit process (Temporal, Camunda): you can see which step it stopped at, and compensations run centrally. The alternative is event-based choreography.'),
  },
  eventSourcing: {
    title: 'Event sourcing',
    icon: '📚',
    cost: 3,
    desc: tr('Состояние хранится как последовательность событий. Полная история изменений бесплатно, но запросы к текущему состоянию нужны через проекции.', 'State is stored as a sequence of events. Full change history for free, but queries on current state require projections.'),
  },
  circuitBreakers: {
    title: tr('Circuit breaker + таймауты', 'Circuit breaker + timeouts'),
    icon: '🔌',
    cost: 1,
    desc: tr('После серии ошибок вызовы к зависимости сразу возвращают ошибку или fallback, не ожидая таймаута. Некритичная зависимость больше не роняет вызывающего.', 'After a series of errors, calls to the dependency immediately return an error or fallback without waiting for a timeout. A non-critical dependency no longer takes down the caller.'),
  },
  retry: {
    title: tr('Retry с backoff и jitter', 'Retry with backoff and jitter'),
    icon: '🔁',
    cost: 1,
    desc: tr('Повтор при кратковременных сбоях с растущей случайной паузой. Без идемпотентности повтор может выполнить операцию дважды.', 'Retries on transient failures with a growing randomized delay. Without idempotency, a retry may execute the operation twice.'),
  },
  bulkhead: {
    title: 'Bulkhead',
    icon: '🚢',
    cost: 1,
    desc: tr('Отдельные пулы потоков и соединений на каждую зависимость: зависшая внешняя система съедает только свой пул.', 'Separate thread and connection pools per dependency: a hung external system exhausts only its own pool.'),
  },
  idempotencyKeys: {
    title: 'Idempotency key',
    icon: '🔑',
    cost: 1,
    desc: tr('Клиент передаёт уникальный ключ операции, сервер не выполняет её повторно. Обязателен для ретраев денежных операций.', 'The client sends a unique operation key, and the server does not execute it twice. Mandatory for retrying money operations.'),
  },
  tracing: {
    title: 'Distributed tracing',
    icon: '🔭',
    cost: 1,
    desc: tr('Сквозной trace id через все сервисы: видно, где запрос провёл время.', 'An end-to-end trace id across all services: you can see where a request spent its time.'),
  },
  logs: {
    title: 'Log aggregation',
    icon: '🧾',
    cost: 1,
    desc: tr('Логи всех сервисов в одном месте с поиском по trace id.', 'Logs from all services in one place, searchable by trace id.'),
  },
  metrics: {
    title: tr('Application metrics + алерты', 'Application metrics + alerts'),
    icon: '📈',
    cost: 1,
    desc: tr('RED/USE-метрики каждого сервиса и алерты на них: узнаёте о проблеме раньше клиентов.', 'RED/USE metrics for every service with alerts on them: you learn about a problem before your customers do.'),
  },
  health: {
    title: 'Health check API',
    icon: '❤️',
    cost: 1,
    desc: tr('Эндпоинт, по которому балансировщик и оркестратор понимают, что экземпляр жив и готов принимать трафик.', 'An endpoint that tells the load balancer and orchestrator the instance is alive and ready for traffic.'),
  },
  auditLog: {
    title: 'Audit logging',
    icon: '🗂️',
    cost: 1,
    desc: tr('Журнал действий пользователей и изменений данных в отдельном хранилище.', 'A log of user actions and data changes in a separate store.'),
  },
  containers: {
    title: tr('Контейнеры + оркестратор (k8s)', 'Containers + orchestrator (k8s)'),
    icon: '☸️',
    cost: 3,
    desc: tr('Каждый сервис — контейнер, Kubernetes перезапускает, масштабирует (HPA) и даёт встроенный discovery через DNS.', 'Every service is a container; Kubernetes restarts and scales it (HPA) and provides built-in discovery via DNS.'),
  },
  canary: {
    title: tr('Canary / blue-green релизы', 'Canary / blue-green releases'),
    icon: '🐤',
    cost: 2,
    desc: tr('Новая версия сначала получает 5% трафика. Если метрики хуже — автоматический откат.', 'A new version first gets 5% of traffic. If metrics get worse, it rolls back automatically.'),
  },
  config: {
    title: 'Externalized configuration',
    icon: '⚙️',
    cost: 1,
    desc: tr('Настройки и адреса вынесены из сборки в конфиг-сервер или переменные окружения: меняются без релиза.', 'Settings and addresses live outside the build in a config server or environment variables: they change without a release.'),
  },
  contracts: {
    title: 'Consumer-driven contracts',
    icon: '🤝',
    cost: 1,
    desc: tr('Потребители описывают, что они ждут от API, и эти контракты проверяются в CI поставщика (Pact).', 'Consumers describe what they expect from an API, and these contracts are verified in the provider\'s CI (Pact).'),
  },
}

export const PATTERN_GROUPS: PatternGroup[] = [
  {
    title: tr('Декомпозиция', 'Decomposition'),
    patterns: ['gateway', 'acl'],
    elsewhere: [
      { title: 'Decompose by business capability', where: tr('кнопка «Вынести в сервис»', '“Extract into a service” button') },
      { title: 'Database per service', where: tr('кнопка «Своя БД»', '“Own database” button') },
    ],
  },
  { title: tr('Внешний API', 'External API'), patterns: ['bff', 'accessToken', 'rateLimiter'] },
  {
    title: tr('Коммуникация', 'Communication'),
    patterns: ['kafka', 'discovery', 'mesh', 'mtls'],
    elsewhere: [
      { title: 'Remote procedure invocation', where: tr('режим связи «REST»', '“REST” link mode') },
      { title: 'Domain events', where: tr('режим связи «событие»', '“event” link mode') },
    ],
  },
  {
    title: tr('Данные', 'Data'),
    patterns: ['outbox', 'cdc', 'idempotentConsumer', 'sagaOrchestrator', 'eventSourcing'],
    elsewhere: [
      { title: 'Saga', where: tr('режим связи «сага»', '“saga” link mode') },
      { title: 'CQRS / event-carried state', where: tr('режим связи «реплика»', '“replica” link mode') },
      { title: 'API composition', where: tr('режим связи «API»', '“API” link mode') },
      { title: tr('Shared database (антипаттерн)', 'Shared database (anti-pattern)'), where: tr('режим «SQL в чужую БД»', '“SQL into another DB” mode') },
    ],
  },
  { title: tr('Устойчивость', 'Resilience'), patterns: ['circuitBreakers', 'retry', 'bulkhead', 'idempotencyKeys'] },
  { title: tr('Наблюдаемость', 'Observability'), patterns: ['tracing', 'logs', 'metrics', 'health', 'auditLog'] },
  { title: tr('Деплой и конфигурация', 'Deployment and configuration'), patterns: ['containers', 'canary', 'config'] },
  { title: tr('Тестирование', 'Testing'), patterns: ['contracts'] },
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
    title: () => tr('Пик нагрузки ×5', 'Load peak ×5'),
    applies: () => true,
    ok: (c) => c.has('rateLimiter') && c.has('containers'),
    fix: ['rateLimiter', 'containers'],
    need: tr('Отбрасывать лишние запросы на входе, а не захлёбываться ими, и автоматически добавлять экземпляры под нагрузку', 'Turn away excess requests at the door instead of drowning in them, and add instances automatically under load'),
    fail: tr('Очередь запросов растёт, таймауты, затем каскадное падение', 'The request queue grows, timeouts follow, then a cascading failure'),
  },
  {
    id: 'slow-dep',
    title: (c) => tr(`${c.external} отвечает 30 секунд`, `${c.external} takes 30 seconds to respond`),
    applies: () => true,
    ok: (c) => c.has('circuitBreakers') && c.has('bulkhead'),
    fix: ['circuitBreakers', 'bulkhead'],
    need: tr('Через пару секунд перестать ждать зависшую систему и не давать ей занять все потоки и соединения сервиса', 'Stop waiting for a hung system after a couple of seconds and keep it from tying up all of the service’s threads and connections'),
    fail: tr('Все потоки ждут ответа, приложение не отвечает даже на то, что с этой системой не связано', 'All threads wait for a response; the app stops responding even to requests unrelated to that system'),
  },
  {
    id: 'flaky',
    title: () => tr('1% сетевых вызовов падает', '1% of network calls fail'),
    applies: (c) => c.syncCrossing,
    ok: (c) => c.has('retry'),
    fix: ['retry'],
    need: tr('Сам повторять запрос, если он упал из-за кратковременного сбоя сети, — с паузой, чтобы не добить сервис', 'Retry a request that failed due to a brief network glitch on its own — with a pause, so as not to finish off the service'),
    fail: tr('Каждая сотая операция завершается ошибкой у клиента', 'One in a hundred operations fails for the customer'),
  },
  {
    id: 'double',
    title: () => tr('Ретрай повторил денежную операцию', 'A retry repeated a money operation'),
    applies: (c) => c.has('retry') && c.criticalSyncCrossing,
    ok: (c) => c.has('idempotencyKeys'),
    fix: ['idempotencyKeys'],
    need: tr('Узнавать повтор той же денежной операции и не выполнять её второй раз', 'Recognize a repeat of the same money operation and not execute it twice'),
    fail: tr('Ответ потерялся по сети, клиент повторил, деньги списаны дважды', 'The response was lost in the network, the client retried, and the money was debited twice'),
  },
  {
    id: 'dup-events',
    title: () => tr('Брокер доставил событие дважды', 'The broker delivered an event twice'),
    applies: (c) => c.eventCrossing,
    ok: (c) => c.has('idempotentConsumer'),
    fix: ['idempotentConsumer'],
    need: tr('Получать одно и то же сообщение дважды без удвоения результата', 'Receive the same message twice without doubling the result'),
    fail: tr('После ребалансировки событие обработано повторно', 'After a rebalance, the event was processed again'),
  },
  {
    id: 'bad-deploy',
    title: () => tr('Релиз с ошибкой', 'A buggy release'),
    applies: () => true,
    // откатывать автоматически можно только по метрикам: доля ошибок и задержки новой версии против старой
    ok: (c) => c.has('canary') && c.has('health') && c.has('metrics'),
    fix: ['canary', 'health', 'metrics'],
    need: tr('Выкатывать новую версию сначала на малую долю пользователей, сравнивать ошибки и откатывать автоматически; понимать, какой экземпляр жив и готов к трафику', 'Roll out a new version to a small share of users first, compare errors and roll back automatically; know which instance is alive and ready for traffic'),
    fail: tr('Ошибку увидели все клиенты сразу, откат вручную ночью', 'All customers saw the bug at once; manual rollback at night'),
  },
  {
    id: 'debug',
    title: () => tr('Ночной инцидент: где тормозит?', 'Night-time incident: where is it slow?'),
    applies: (c) => c.services >= 2,
    ok: (c) => c.has('tracing') && c.has('logs') && c.has('metrics'),
    fix: ['tracing', 'logs', 'metrics'],
    need: tr('Видеть путь одного запроса через все сервисы с таймингами, а его логи и метрики — в одном месте', 'See the path of a single request through every service with timings, and its logs and metrics in one place'),
    fail: tr('Пять команд четыре часа ищут, чей сервис виноват', 'Five teams spend four hours figuring out whose service is to blame'),
  },
  {
    id: 'contract',
    title: () => tr('Команда-поставщик поменяла API', 'The provider team changed its API'),
    applies: (c) => c.syncCrossing,
    ok: (c) => c.has('contracts'),
    fix: ['contracts'],
    need: tr('Ловить ломающие изменения API ещё в сборке поставщика, до того как их увидят потребители', 'Catch breaking API changes in the provider’s build, before consumers see them'),
    fail: tr('Потребитель узнал об изменении из ошибок в проде', 'The consumer found out about the change from production errors'),
  },
  {
    id: 'legacy-model',
    title: () => tr('Монолит переименовал поля', 'The monolith renamed fields'),
    applies: (c) => c.monolithCrossing,
    ok: (c) => c.has('acl'),
    fix: ['acl'],
    need: tr('Переводить модель данных монолита на границе, чтобы она не расползалась по коду новых сервисов', 'Translate the monolith’s data model at the boundary so it does not spread through the new services’ code'),
    fail: tr('Модель легаси протекла в новые сервисы, правки расползлись по всем', 'The legacy model leaked into the new services, and the changes spread to all of them'),
  },
  {
    id: 'scale-out',
    title: () => tr('Автоскейлинг поднял 10 экземпляров', 'Autoscaling spun up 10 instances'),
    applies: (c) => c.services >= 2,
    ok: (c) => c.has('discovery'),
    fix: ['discovery', 'containers'],
    need: tr('Находить живые экземпляры сервисов по имени, а не по адресам, зашитым в конфиг', 'Find live service instances by name rather than by addresses baked into config'),
    fail: tr('Новые экземпляры никто не видит, старые адреса в конфигах', 'Nobody sees the new instances; configs still have the old addresses'),
  },
  {
    id: 'security',
    title: () => tr('Взломан один сервис во внутренней сети', 'One service on the internal network is compromised'),
    applies: (c) => c.services >= 1,
    ok: (c) => c.has('mtls') && c.has('accessToken'),
    fix: ['mtls', 'accessToken'],
    need: tr('Проверять, какой именно сервис звонит и от имени какого пользователя он действует', 'Verify exactly which service is calling and on behalf of which user it acts'),
    fail: tr('Злоумышленник вызывает любые сервисы от имени любого пользователя', 'The attacker calls any service on behalf of any user'),
  },
  {
    id: 'mobile',
    title: () => tr('Мобильному экрану нужно 6 запросов', 'A mobile screen needs 6 requests'),
    applies: (c) => c.services >= 2,
    ok: (c) => c.has('bff'),
    fix: ['bff'],
    need: tr('Отдавать мобильному экрану все нужные ему данные одним ответом', 'Give the mobile screen all the data it needs in a single response'),
    fail: tr('На мобильном интернете главный экран грузится 4 секунды', 'On mobile data, the home screen takes 4 seconds to load'),
  },
  {
    id: 'audit',
    title: () => tr('Регулятор просит историю изменений за год', 'The regulator asks for a year of change history'),
    applies: () => true,
    ok: (c) => c.has('auditLog') || c.has('eventSourcing'),
    fix: ['auditLog', 'eventSourcing'],
    need: tr('Хранить неизменяемую историю изменений: кто, что и когда сделал', 'Keep an immutable history of changes: who did what and when'),
    fail: tr('Историю восстанавливают по бэкапам две недели', 'Reconstructing the history from backups takes two weeks'),
  },
  {
    id: 'config',
    title: (c) => tr(`Сменить адрес: ${c.external} без релиза`, `Change the address of ${c.external} without a release`),
    applies: () => true,
    ok: (c) => c.has('config'),
    fix: ['config'],
    need: tr('Менять адреса и настройки без пересборки и релиза', 'Change addresses and settings without rebuilding and releasing'),
    fail: tr('Адрес зашит в сборку: внеплановый релиз всех сервисов', 'The address is baked into the build: an unplanned release of every service'),
  },
  {
    id: 'saga-stuck',
    title: () => tr('Сага зависла на полпути', 'A saga got stuck halfway'),
    applies: (c) => c.sagas,
    ok: (c) => c.has('sagaOrchestrator') || (c.has('tracing') && c.has('logs')),
    fix: ['sagaOrchestrator', 'tracing + logs'],
    need: tr('Видеть, на каком шаге остановилась многошаговая операция в нескольких сервисах, и уметь довести её до конца или откатить', 'See at which step a multi-step operation across several services stopped, and be able to finish it or roll it back'),
    fail: tr('Деньги списаны, заказ не создан, и никто не знает, на каком шаге всё остановилось', 'Money debited, order not created, and nobody knows at which step everything stopped'),
  },
  {
    id: 'heavy-read',
    title: () => tr('Тяжёлый отчёт в разгар дня', 'A heavy report at peak hours'),
    applies: (c) => c.heavyReads,
    ok: (c) => c.heavyReadsIsolated,
    fix: [tr('реплики (CQRS) на всех тяжёлых чтениях — отчётах, выгрузках, агрегатах', 'replicas (CQRS) for all heavy reads — reports, exports, aggregates')],
    need: tr('Дать тяжёлым отчётам и выгрузкам свою копию данных, чтобы они не читали боевую базу', 'Give heavy reports and exports their own copy of the data so they do not read the production database'),
    fail: tr('Отчёт сделал full scan по основной БД, и встали все', 'The report did a full scan of the main database, and everything ground to a halt'),
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
  const dup = (id: PatternId, by: PatternId) => flag(id, tr(`уже даёт «${PATTERNS[by].title}»`, `already provided by “${PATTERNS[by].title}”`))

  if (!c.eventCrossing) {
    flag('kafka', tr('нет ни одной связи на событиях', 'no event-based links at all'))
    flag('outbox', tr('нечего публиковать: событий нет', 'nothing to publish: there are no events'))
    flag('cdc', tr('нечего публиковать: событий нет', 'nothing to publish: there are no events'))
    flag('idempotentConsumer', tr('нет получателей событий', 'no event consumers'))
  } else if (p.outbox) {
    flag(
      'cdc',
      tr(
        'dual write уже решён через Outbox. CDC имеет смысл как способ доставки outbox-таблицы в брокер (Debezium Outbox Router), но в этой схеме он не нужен: события уже публикуются',
        'dual write is already solved by Outbox. CDC makes sense as a way to ship the outbox table to the broker (Debezium Outbox Router), but here it is not needed: events are already published',
      ),
    )
  }
  if (!c.sagas) flag('sagaOrchestrator', tr('нет ни одной саги', 'no sagas at all'))
  if (p.auditLog) flag('eventSourcing', tr('история для регулятора уже есть в Audit logging, а event sourcing втрое дороже', 'Audit logging already provides history for the regulator, and event sourcing costs three times as much'))
  if (!c.syncCrossing) {
    flag('retry', tr('нет сетевых вызовов между сервисами', 'no network calls between services'))
    flag('contracts', tr('нет API между сервисами — проверять нечего', 'no APIs between services — nothing to verify'))
  }
  if (!(p.retry || p.mesh) || !c.criticalSyncCrossing) flag('idempotencyKeys', tr('нет ретраев денежных операций', 'no retries of money operations'))
  if (!c.monolithCrossing) flag('acl', tr('новые сервисы не общаются с монолитом', 'the new services do not talk to the monolith'))
  if (c.services < 1) {
    flag('mtls', tr('сервисов нет — шифровать нечего', 'no services — nothing to encrypt'))
    flag('accessToken', tr('сервисов нет — токен передавать некому', 'no services — nobody to pass a token to'))
    flag('mesh', tr('сервисов нет — sidecar ставить некуда', 'no services — nowhere to put a sidecar'))
  }
  if (c.services < 2) {
    flag('bff', tr('пока один бэкенд — собирать ответ не из чего', 'only one backend so far — nothing to aggregate'))
    flag('discovery', tr('меньше двух сервисов — искать некого', 'fewer than two services — nothing to discover'))
    // метрики лишними не бывают: без них не видно ни нагрузки, ни деградации
    if (!(c.sagas && !p.sagaOrchestrator)) {
      flag('tracing', tr('трассировать нечего: запрос не покидает процесс', 'nothing to trace: requests never leave the process'))
      // много экземпляров в контейнерах — логи уже разбросаны по машинам, сборщик нужен
      if (!p.containers) flag('logs', tr('все логи и так в одном месте', 'all logs are already in one place'))
    }
  }
  if (p.mesh) {
    dup('circuitBreakers', 'mesh')
    dup('retry', 'mesh')
    dup('mtls', 'mesh')
    flag('discovery', tr('service mesh опирается на реестр сервисов платформы — отдельный discovery не нужен', 'the service mesh relies on the platform’s service registry, so a separate discovery is not needed'))
  } else if (p.containers) {
    dup('discovery', 'containers')
  }
  return out
}
