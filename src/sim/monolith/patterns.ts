/**
 * Каталог паттернов микросервисов (по мотивам microservices.io и паттернов устойчивости)
 * и стресс-тесты, которые проверяют, что паттерны действительно нужны.
 */

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
    desc: 'Клиенты ходят в одну точку, а фасад решает, что отправить в монолит, а что в новый сервис. С него начинается любой распил.',
  },
  acl: {
    title: 'Anti-corruption layer',
    icon: '🧱',
    cost: 1,
    desc: 'Слой-переводчик между новым сервисом и монолитом: модель легаси не протекает в новый код, а изменения монолита ломают только переводчик.',
  },
  bff: {
    title: 'Backend for Frontend',
    icon: '📱',
    cost: 2,
    desc: 'Отдельный бэкенд под каждый клиент (мобильное, веб): собирает данные из нескольких сервисов в один ответ под экран.',
  },
  accessToken: {
    title: 'Access token (JWT)',
    icon: '🎫',
    cost: 1,
    desc: 'Шлюз проверяет пользователя и передаёт сервисам подписанный токен с его правами. Сервисы не ходят в монолит за сессией.',
  },
  rateLimiter: {
    title: 'Rate limiter',
    icon: '🚧',
    cost: 1,
    desc: 'Ограничивает число запросов от клиента или в целом. Лишнее отбрасывается сразу, а не роняет систему.',
  },
  kafka: {
    title: 'Брокер сообщений (Kafka)',
    icon: '📜',
    cost: 4,
    desc: 'Основа асинхронного обмена: доменные события, саги, реплики данных.',
  },
  discovery: {
    title: 'Service discovery',
    icon: '🧭',
    cost: 1,
    desc: 'Реестр, где сервисы находят друг друга. Без него адреса зашиты в конфиги и ломаются при каждом перезапуске и масштабировании.',
  },
  mesh: {
    title: 'Service mesh (sidecar)',
    icon: '🕸️',
    cost: 4,
    desc: 'Прокси рядом с каждым сервисом берут на себя mTLS, ретраи, таймауты и circuit breaker без изменения кода. Добавляет пару миллисекунд на каждый вызов.',
  },
  mtls: {
    title: 'mTLS между сервисами',
    icon: '🔐',
    cost: 1,
    desc: 'Сервисы проверяют сертификаты друг друга: взломанный сервис не может притвориться другим.',
  },
  outbox: {
    title: 'Transactional Outbox',
    icon: '📮',
    cost: 1,
    desc: 'Событие пишется в таблицу outbox в той же транзакции, что и данные, а затем публикуется. Решает проблему dual write.',
  },
  cdc: {
    title: 'CDC (transaction log tailing)',
    icon: '🪵',
    cost: 2,
    desc: 'Debezium читает журнал транзакций БД и публикует изменения в брокер. Тоже решает dual write и работает даже с легаси-монолитом без правок кода.',
  },
  idempotentConsumer: {
    title: 'Idempotent consumer',
    icon: '♻️',
    cost: 1,
    desc: 'Получатель запоминает id обработанных сообщений и пропускает повторы. Брокеры гарантируют at-least-once, так что дубли будут.',
  },
  sagaOrchestrator: {
    title: 'Оркестратор саг',
    icon: '🎼',
    cost: 2,
    desc: 'Сага как явный процесс (Temporal, Camunda): видно, на каком шаге она остановилась, компенсации запускаются централизованно. Альтернатива — хореография на событиях.',
  },
  eventSourcing: {
    title: 'Event sourcing',
    icon: '📚',
    cost: 3,
    desc: 'Состояние хранится как последовательность событий. Полная история изменений бесплатно, но запросы к текущему состоянию нужны через проекции.',
  },
  circuitBreakers: {
    title: 'Circuit breaker + таймауты',
    icon: '🔌',
    cost: 1,
    desc: 'После серии ошибок вызовы к зависимости сразу возвращают ошибку или fallback, не ожидая таймаута. Некритичная зависимость больше не роняет вызывающего.',
  },
  retry: {
    title: 'Retry с backoff и jitter',
    icon: '🔁',
    cost: 1,
    desc: 'Повтор при кратковременных сбоях с растущей случайной паузой. Без идемпотентности повтор может выполнить операцию дважды.',
  },
  bulkhead: {
    title: 'Bulkhead',
    icon: '🚢',
    cost: 1,
    desc: 'Отдельные пулы потоков и соединений на каждую зависимость: зависшая внешняя система съедает только свой пул.',
  },
  idempotencyKeys: {
    title: 'Idempotency key',
    icon: '🔑',
    cost: 1,
    desc: 'Клиент передаёт уникальный ключ операции, сервер не выполняет её повторно. Обязателен для ретраев денежных операций.',
  },
  tracing: {
    title: 'Distributed tracing',
    icon: '🔭',
    cost: 1,
    desc: 'Сквозной trace id через все сервисы: видно, где запрос провёл время.',
  },
  logs: {
    title: 'Log aggregation',
    icon: '🧾',
    cost: 1,
    desc: 'Логи всех сервисов в одном месте с поиском по trace id.',
  },
  metrics: {
    title: 'Application metrics + алерты',
    icon: '📈',
    cost: 1,
    desc: 'RED/USE-метрики каждого сервиса и алерты на них: узнаёте о проблеме раньше клиентов.',
  },
  health: {
    title: 'Health check API',
    icon: '❤️',
    cost: 1,
    desc: 'Эндпоинт, по которому балансировщик и оркестратор понимают, что экземпляр жив и готов принимать трафик.',
  },
  auditLog: {
    title: 'Audit logging',
    icon: '🗂️',
    cost: 1,
    desc: 'Журнал действий пользователей и изменений данных в отдельном хранилище.',
  },
  containers: {
    title: 'Контейнеры + оркестратор (k8s)',
    icon: '☸️',
    cost: 3,
    desc: 'Каждый сервис — контейнер, Kubernetes перезапускает, масштабирует (HPA) и даёт встроенный discovery через DNS.',
  },
  canary: {
    title: 'Canary / blue-green релизы',
    icon: '🐤',
    cost: 2,
    desc: 'Новая версия сначала получает 5% трафика. Если метрики хуже — автоматический откат.',
  },
  config: {
    title: 'Externalized configuration',
    icon: '⚙️',
    cost: 1,
    desc: 'Настройки и адреса вынесены из сборки в конфиг-сервер или переменные окружения: меняются без релиза.',
  },
  contracts: {
    title: 'Consumer-driven contracts',
    icon: '🤝',
    cost: 1,
    desc: 'Потребители описывают, что они ждут от API, и эти контракты проверяются в CI поставщика (Pact).',
  },
}

export const PATTERN_GROUPS: PatternGroup[] = [
  {
    title: 'Декомпозиция',
    patterns: ['gateway', 'acl'],
    elsewhere: [
      { title: 'Decompose by business capability', where: 'кнопка «Вынести в сервис»' },
      { title: 'Database per service', where: 'кнопка «Своя БД»' },
    ],
  },
  { title: 'Внешний API', patterns: ['bff', 'accessToken', 'rateLimiter'] },
  {
    title: 'Коммуникация',
    patterns: ['kafka', 'discovery', 'mesh', 'mtls'],
    elsewhere: [
      { title: 'Remote procedure invocation', where: 'режим связи «REST»' },
      { title: 'Domain events', where: 'режим связи «событие»' },
    ],
  },
  {
    title: 'Данные',
    patterns: ['outbox', 'cdc', 'idempotentConsumer', 'sagaOrchestrator', 'eventSourcing'],
    elsewhere: [
      { title: 'Saga', where: 'режим связи «сага»' },
      { title: 'CQRS / event-carried state', where: 'режим связи «реплика»' },
      { title: 'API composition', where: 'режим связи «API»' },
      { title: 'Shared database (антипаттерн)', where: 'режим «SQL в чужую БД»' },
    ],
  },
  { title: 'Устойчивость', patterns: ['circuitBreakers', 'retry', 'bulkhead', 'idempotencyKeys'] },
  { title: 'Наблюдаемость', patterns: ['tracing', 'logs', 'metrics', 'health', 'auditLog'] },
  { title: 'Деплой и конфигурация', patterns: ['containers', 'canary', 'config'] },
  { title: 'Тестирование', patterns: ['contracts'] },
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
}

export const STRESS_TESTS: StressTest[] = [
  {
    id: 'peak',
    title: () => 'Пик нагрузки ×5',
    applies: () => true,
    ok: (c) => c.has('rateLimiter') && c.has('containers'),
    fix: ['rateLimiter', 'containers'],
    fail: 'Очередь запросов растёт, таймауты, затем каскадное падение',
  },
  {
    id: 'slow-dep',
    title: (c) => `${c.external} отвечает 30 секунд`,
    applies: () => true,
    ok: (c) => c.has('circuitBreakers') && c.has('bulkhead'),
    fix: ['circuitBreakers', 'bulkhead'],
    fail: 'Все потоки ждут ответа, приложение не отвечает даже на то, что с этой системой не связано',
  },
  {
    id: 'flaky',
    title: () => '1% сетевых вызовов падает',
    applies: (c) => c.syncCrossing,
    ok: (c) => c.has('retry'),
    fix: ['retry'],
    fail: 'Каждая сотая операция завершается ошибкой у клиента',
  },
  {
    id: 'double',
    title: () => 'Ретрай повторил денежную операцию',
    applies: (c) => c.has('retry') && c.criticalSyncCrossing,
    ok: (c) => c.has('idempotencyKeys'),
    fix: ['idempotencyKeys'],
    fail: 'Ответ потерялся по сети, клиент повторил, деньги списаны дважды',
  },
  {
    id: 'dup-events',
    title: () => 'Брокер доставил событие дважды',
    applies: (c) => c.eventCrossing,
    ok: (c) => c.has('idempotentConsumer'),
    fix: ['idempotentConsumer'],
    fail: 'После ребалансировки событие обработано повторно',
  },
  {
    id: 'bad-deploy',
    title: () => 'Релиз с ошибкой',
    applies: () => true,
    ok: (c) => c.has('canary') && c.has('health'),
    fix: ['canary', 'health'],
    fail: 'Ошибку увидели все клиенты сразу, откат вручную ночью',
  },
  {
    id: 'debug',
    title: () => 'Ночной инцидент: где тормозит?',
    applies: (c) => c.services >= 2,
    ok: (c) => c.has('tracing') && c.has('logs') && c.has('metrics'),
    fix: ['tracing', 'logs', 'metrics'],
    fail: 'Пять команд четыре часа ищут, чей сервис виноват',
  },
  {
    id: 'contract',
    title: () => 'Команда-поставщик поменяла API',
    applies: (c) => c.syncCrossing,
    ok: (c) => c.has('contracts'),
    fix: ['contracts'],
    fail: 'Потребитель узнал об изменении из ошибок в проде',
  },
  {
    id: 'legacy-model',
    title: () => 'Монолит переименовал поля',
    applies: (c) => c.monolithCrossing,
    ok: (c) => c.has('acl'),
    fix: ['acl'],
    fail: 'Модель легаси протекла в новые сервисы, правки расползлись по всем',
  },
  {
    id: 'scale-out',
    title: () => 'Автоскейлинг поднял 10 экземпляров',
    applies: (c) => c.services >= 2,
    ok: (c) => c.has('discovery'),
    fix: ['discovery', 'containers'],
    fail: 'Новые экземпляры никто не видит, старые адреса в конфигах',
  },
  {
    id: 'security',
    title: () => 'Взломан один сервис во внутренней сети',
    applies: (c) => c.services >= 1,
    ok: (c) => c.has('mtls') && c.has('accessToken'),
    fix: ['mtls', 'accessToken'],
    fail: 'Злоумышленник вызывает любые сервисы от имени любого пользователя',
  },
  {
    id: 'mobile',
    title: () => 'Мобильному экрану нужно 6 запросов',
    applies: (c) => c.services >= 2,
    ok: (c) => c.has('bff'),
    fix: ['bff'],
    fail: 'На мобильном интернете главный экран грузится 4 секунды',
  },
  {
    id: 'audit',
    title: () => 'Регулятор просит историю изменений за год',
    applies: () => true,
    ok: (c) => c.has('auditLog') || c.has('eventSourcing'),
    fix: ['auditLog', 'eventSourcing'],
    fail: 'Историю восстанавливают по бэкапам две недели',
  },
  {
    id: 'config',
    title: (c) => `Сменить адрес: ${c.external} без релиза`,
    applies: () => true,
    ok: (c) => c.has('config'),
    fix: ['config'],
    fail: 'Адрес зашит в сборку: внеплановый релиз всех сервисов',
  },
  {
    id: 'saga-stuck',
    title: () => 'Сага зависла на полпути',
    applies: (c) => c.sagas,
    ok: (c) => c.has('sagaOrchestrator') || (c.has('tracing') && c.has('logs')),
    fix: ['sagaOrchestrator', 'tracing + logs'],
    fail: 'Деньги списаны, заказ не создан, и никто не знает, на каком шаге всё остановилось',
  },
  {
    id: 'heavy-read',
    title: () => 'Тяжёлый отчёт в разгар дня',
    applies: (c) => c.heavyReads,
    ok: (c) => c.heavyReadsIsolated,
    fix: ['реплики (CQRS) на всех тяжёлых чтениях — отчётах, выгрузках, агрегатах'],
    fail: 'Отчёт сделал full scan по основной БД, и встали все',
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
  const dup = (id: PatternId, by: PatternId) => flag(id, `уже даёт «${PATTERNS[by].title}»`)

  if (!c.eventCrossing) {
    flag('kafka', 'нет ни одной связи на событиях')
    flag('outbox', 'нечего публиковать: событий нет')
    flag('cdc', 'нечего публиковать: событий нет')
    flag('idempotentConsumer', 'нет получателей событий')
  } else if (p.outbox) {
    flag('cdc', 'dual write уже решён через Outbox — две схемы публикации одной задачи')
  }
  if (!c.sagas) flag('sagaOrchestrator', 'нет ни одной саги')
  if (p.auditLog) flag('eventSourcing', 'история для регулятора уже есть в Audit logging, а event sourcing втрое дороже')
  if (!c.syncCrossing) {
    flag('retry', 'нет сетевых вызовов между сервисами')
    flag('contracts', 'нет API между сервисами — проверять нечего')
  }
  if (!(p.retry || p.mesh) || !c.criticalSyncCrossing) flag('idempotencyKeys', 'нет ретраев денежных операций')
  if (!c.monolithCrossing) flag('acl', 'новые сервисы не общаются с монолитом')
  if (c.services < 1) {
    flag('mtls', 'сервисов нет — шифровать нечего')
    flag('accessToken', 'сервисов нет — токен передавать некому')
    flag('mesh', 'сервисов нет — sidecar ставить некуда')
  }
  if (c.services < 2) {
    flag('bff', 'пока один бэкенд — собирать ответ не из чего')
    flag('discovery', 'меньше двух сервисов — искать некого')
    flag('metrics', 'для монолита хватает базового мониторинга')
    if (!(c.sagas && !p.sagaOrchestrator)) {
      flag('tracing', 'трассировать нечего: запрос не покидает процесс')
      flag('logs', 'все логи и так в одном месте')
    }
  }
  if (p.mesh) {
    dup('circuitBreakers', 'mesh')
    dup('retry', 'mesh')
    dup('mtls', 'mesh')
    dup('discovery', 'mesh')
  } else if (p.containers) {
    dup('discovery', 'containers')
  }
  return out
}
