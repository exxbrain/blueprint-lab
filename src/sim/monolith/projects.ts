import type { Dep, Metrics, Mission, ModuleDef, Project } from './model'
import { tr } from '../../i18n'

const noProblems = (m: Metrics) => !m.problems.some((p) => p.severity === 'broken' || p.severity === 'risk')
const allStress = (m: Metrics) => m.stress.every((t) => !t.applies || t.ok)
const noExcess = (m: Metrics) => !m.problems.some((p) => p.severity === 'excess')
const heavyIsolated = (...ids: string[]) => (m: Metrics) => ids.every((id) => !m.heavyLeft.includes(id))
const stressOk = (...ids: string[]) => (m: Metrics) => ids.every((id) => m.stress.find((t) => t.id === id)?.ok)

// ---------------- Уровень 1: интернет-магазин ----------------

const shopModules: ModuleDef[] = [
  { id: 'catalog', title: tr('Каталог', 'Catalog'), icon: '📚', team: tr('Витрина', 'Storefront'), desc: tr('Товары, цены, поиск', 'Products, prices, search'), effort: 2 },
  { id: 'cart', title: tr('Корзина', 'Cart'), icon: '🛒', team: tr('Витрина', 'Storefront'), desc: tr('Корзина покупателя', 'Shopping cart'), effort: 1 },
  { id: 'orders', title: tr('Заказы', 'Orders'), icon: '📦', team: tr('Заказы', 'Orders'), desc: tr('Оформление и жизненный цикл заказа', 'Checkout and order lifecycle'), effort: 3 },
  { id: 'payments', title: tr('Платежи', 'Payments'), icon: '💳', team: tr('Финтех', 'Fintech'), desc: tr('Списание денег, возвраты', 'Charges, refunds'), effort: 2 },
  { id: 'inventory', title: tr('Склад', 'Inventory'), icon: '🏬', team: tr('Логистика', 'Logistics'), desc: tr('Остатки и резервирование товара', 'Stock levels and reservations'), effort: 2 },
  { id: 'notifications', title: tr('Уведомления', 'Notifications'), icon: '✉️', team: tr('Платформа', 'Platform'), desc: tr('Email, push, SMS', 'Email, push, SMS'), effort: 1 },
  { id: 'users', title: tr('Пользователи', 'Users'), icon: '👤', team: tr('Платформа', 'Platform'), desc: tr('Профили, адреса, авторизация', 'Profiles, addresses, auth'), effort: 2 },
  { id: 'reports', title: tr('Отчёты', 'Reports'), icon: '📊', team: tr('Аналитика', 'Analytics'), desc: tr('Выручка, продажи, остатки', 'Revenue, sales, stock'), effort: 1 },
]


const shopDeps: Dep[] = [
  {
    id: 'cart-catalog',
    from: 'cart',
    to: 'catalog',
    kind: 'read',
    critical: true,
    label: tr('цены товаров', 'product prices'),
    why: tr('Корзина делает JOIN с таблицей products, чтобы показать актуальные цены.', 'The cart JOINs the products table to show current prices.'),
  },
  {
    id: 'orders-cart',
    from: 'orders',
    to: 'cart',
    kind: 'call',
    critical: true,
    label: tr('содержимое корзины', 'cart contents'),
    why: tr('При оформлении заказ забирает позиции из корзины.', 'At checkout the order takes the items from the cart.'),
  },
  {
    id: 'orders-users',
    from: 'orders',
    to: 'users',
    kind: 'read',
    critical: true,
    label: tr('адрес доставки', 'delivery address'),
    why: tr('Заказ читает адрес из таблицы users_addresses.', 'The order reads the address from the users_addresses table.'),
  },
  {
    id: 'orders-payments',
    from: 'orders',
    to: 'payments',
    kind: 'tx',
    critical: true,
    label: tr('списание денег', 'charging the customer'),
    why: tr('Заказ создаётся и деньги списываются в одной транзакции БД: либо всё, либо ничего.', 'The order is created and the money is charged in a single DB transaction: all or nothing.'),
  },
  {
    id: 'orders-inventory',
    from: 'orders',
    to: 'inventory',
    kind: 'tx',
    critical: true,
    label: tr('резерв товара', 'stock reservation'),
    why: tr('В той же транзакции уменьшается остаток на складе.', 'The stock level is decremented in the same transaction.'),
  },
  {
    id: 'orders-notifications',
    from: 'orders',
    to: 'notifications',
    kind: 'call',
    critical: false,
    label: tr('письмо «заказ принят»', '"order received" email'),
    why: tr('После оформления отправляется письмо клиенту.', 'After checkout an email is sent to the customer.'),
  },
  {
    id: 'payments-users',
    from: 'payments',
    to: 'users',
    kind: 'read',
    critical: true,
    label: tr('платёжный профиль', 'payment profile'),
    why: tr('Платежи читают сохранённые карты из таблицы users.', 'Payments reads saved cards from the users table.'),
  },
  {
    id: 'catalog-inventory',
    from: 'catalog',
    to: 'inventory',
    kind: 'read',
    critical: false,
    label: tr('остатки на витрине', 'stock on the storefront'),
    why: tr('Страница товара показывает «осталось 3 шт.» через JOIN со stock.', 'The product page shows "only 3 left" via a JOIN with stock.'),
  },
  {
    id: 'inventory-notifications',
    from: 'inventory',
    to: 'notifications',
    kind: 'call',
    critical: false,
    label: tr('«товар снова в наличии»', '"back in stock"'),
    why: tr('Склад рассылает подписчикам уведомление о поступлении.', 'Inventory notifies subscribers when an item is restocked.'),
  },
  {
    id: 'reports-orders',
    from: 'reports',
    to: 'orders',
    kind: 'read',
    critical: false,
    heavy: true,
    label: tr('продажи', 'sales'),
    why: tr('Ночной отчёт делает тяжёлый JOIN по orders.', 'The nightly report runs a heavy JOIN over orders.'),
  },
  {
    id: 'reports-payments',
    from: 'reports',
    to: 'payments',
    kind: 'read',
    critical: false,
    heavy: true,
    label: tr('выручка', 'revenue'),
    why: tr('Отчёт по выручке читает payments.', 'The revenue report reads payments.'),
  },
  {
    id: 'reports-catalog',
    from: 'reports',
    to: 'catalog',
    kind: 'read',
    critical: false,
    heavy: true,
    label: tr('категории', 'categories'),
    why: tr('Отчёт группирует продажи по категориям каталога.', 'The report groups sales by catalog category.'),
  },
]


const SHOP_FULL_MODES = {
  'orders-payments': 'saga',
  'orders-inventory': 'saga',
  'orders-notifications': 'async',
  'inventory-notifications': 'async',
  'cart-catalog': 'replica',
  'orders-users': 'api',
  'payments-users': 'api',
  'catalog-inventory': 'replica',
  'reports-orders': 'replica',
  'reports-payments': 'replica',
  'reports-catalog': 'replica',
} as const

const RESILIENCE_ONLY = ['rateLimiter', 'containers', 'circuitBreakers', 'bulkhead', 'canary', 'health'] as const

const shopMissions: Mission[] = [
  {
    id: 'full',
    title: tr('Независимые команды', 'Independent teams'),
    brief: tr([
      'Восемь команд мешают друг другу на каждом релизе. Нужно, чтобы минимум пять из них релизились независимо, а система стала устойчивее, чем была.',
    ], [
      'Eight teams get in each other\'s way on every release. At least five of them need to be released independently, and the system must end up more resilient than before.',
    ]),
    budget: 92,
    goals: [
      { text: tr('Минимум 5 модулей релизятся независимо', 'At least 5 modules released independently'), check: (m) => m.independent.length >= 5 },
      { text: tr('Оформление заказа ≤ 150 мс', 'Checkout ≤ 150 ms'), check: (m) => m.flowLatency <= 150 },
      { text: tr('Доступность оформления ≥ 99.7%', 'Checkout availability ≥ 99.7%'), check: (m) => m.flowAvailability >= 0.997 },
      { text: tr('Нет сломанных функций и рисков потери данных', 'No broken features and no risk of data loss'), check: noProblems },
      { text: tr('Сложность эксплуатации ≤ 52', 'Operational complexity ≤ 52'), check: (m) => m.complexity <= 52 },
      { text: tr('Пройдены все стресс-тесты', 'All stress tests passed'), check: allStress },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns'), check: noExcess },
    ],
    debrief: tr([
      'Вы прошли путь Strangler Fig: фасад перед монолитом, вынос модулей по одному, отдельные БД и замена ACID-транзакций сагами. Чтение чужих таблиц ушло в API и реплики на событиях, а outbox убрал риск потери событий.',
      'Заметьте, что пилить всё не нужно. Каждый сервис добавляет сетевой хоп, точку отказа и строчку в счёте за эксплуатацию. Хороший распил останавливается, когда модули, которым нужна независимость, её получили.',
    ], [
      'You walked the Strangler Fig path: a facade in front of the monolith, extracting modules one at a time, separate databases, and replacing ACID transactions with sagas. Reads of other modules\' tables moved to APIs and event-fed replicas, and the outbox removed the risk of losing events.',
      'Note that you don\'t have to split everything. Every service adds a network hop, a point of failure and a line on the operations bill. A good breakup stops once the modules that need independence have it.',
    ]),
    solution: {
      extract: ['catalog', 'orders', 'payments', 'inventory', 'notifications'],
      ownDb: ['catalog', 'orders', 'payments', 'inventory', 'notifications'],
      modes: { ...SHOP_FULL_MODES },
      patterns: [
        'gateway', 'acl', 'bff', 'accessToken', 'rateLimiter', 'kafka', 'mtls', 'outbox', 'idempotentConsumer',
        'sagaOrchestrator', 'circuitBreakers', 'retry', 'bulkhead', 'idempotencyKeys', 'tracing', 'logs', 'metrics',
        'health', 'auditLog', 'containers', 'canary', 'config', 'contracts',
      ],
    },
    solutionSteps: tr([
      'Strangler-фасад, затем вынести Каталог, Заказы, Платежи, Склад и Уведомления, каждому своя БД.',
      'Заказы → Платежи и Заказы → Склад: саги; уведомления — события; Заказы → Пользователи и Платежи → Пользователи — API.',
      'Все некритичные чтения (Отчёты, остатки на витрине) и цены в корзине — реплики (CQRS).',
      'Kafka + Outbox + идемпотентный консьюмер + оркестратор саг; устойчивость, наблюдаемость, деплой и контракты — по подсказкам стресс-тестов.',
    ], [
      'Strangler facade, then extract Catalog, Orders, Payments, Inventory and Notifications, each with its own DB.',
      'Orders → Payments and Orders → Inventory: sagas; notifications: events; Orders → Users and Payments → Users: API.',
      'All non-critical reads (Reports, storefront stock) and cart prices: replicas (CQRS).',
      'Kafka + Outbox + idempotent consumer + saga orchestrator; resilience, observability, deployment and contracts as the stress tests suggest.',
    ]),
  },
  {
    id: 'black-friday',
    title: tr('Чёрная пятница без падений', 'Black Friday without outages'),
    brief: tr([
      'До распродажи месяц. Пилить монолит некогда, но прошлогодний инцидент повторяться не должен: тогда трафик вырос в пять раз, а платёжный провайдер начал отвечать по 30 секунд.',
    ], [
      'The sale is a month away. There is no time to break up the monolith, but last year\'s incident must not happen again: traffic grew fivefold and the payment provider started taking 30 seconds to respond.',
    ]),
    budget: 14,
    goals: [
      { text: tr('Пережить пик нагрузки ×5', 'Survive a ×5 load peak'), check: stressOk('peak') },
      { text: tr('Пережить зависание внешней системы', 'Survive a hanging external system'), check: stressOk('slow-dep') },
      { text: tr('Релиз с ошибкой не задевает всех клиентов', 'A faulty release does not hit all customers'), check: stressOk('bad-deploy') },
      { text: tr('Доступность оформления ≥ 99.8%', 'Checkout availability ≥ 99.8%'), check: (m) => m.flowAvailability >= 0.998 },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns'), check: noExcess },
    ],
    debrief: tr([
      'Микросервисы для этого не понадобились. Устойчивость — свойство платформы и кода, а не числа сервисов: rate limiter, автоскейлинг, таймауты с circuit breaker, bulkhead и аккуратные релизы работают и для монолита.',
      'Распил дал бы здесь только новые сетевые хопы и точки отказа за месяц до пика.',
    ], [
      'Microservices were not needed for this. Resilience is a property of the platform and the code, not of the number of services: a rate limiter, autoscaling, timeouts with a circuit breaker, bulkheads and careful releases work for a monolith too.',
      'Breaking it up here would only have added network hops and points of failure a month before the peak.',
    ]),
    solution: { extract: [], ownDb: [], modes: {}, patterns: [...RESILIENCE_ONLY] },
    solutionSteps: tr([
      'Ничего не выносить.',
      'Rate limiter + контейнеры с автоскейлингом — против пика.',
      'Circuit breaker + bulkhead — против зависшего провайдера.',
      'Canary-релизы + health check — против плохого релиза.',
    ], [
      'Extract nothing.',
      'Rate limiter + containers with autoscaling: against the peak.',
      'Circuit breaker + bulkhead: against the hanging provider.',
      'Canary releases + health checks: against a bad release.',
    ]),
  },
  {
    id: 'catalog',
    title: tr('Каталог отдельно к сезону', 'Catalog on its own for the season'),
    brief: tr([
      'Команде витрины нужно выкатывать изменения каталога каждый день в сезон распродаж. Остальное пока трогать не нужно, бюджет маленький.',
    ], [
      'The storefront team needs to ship catalog changes every day during the sales season. Nothing else needs to change yet, and the budget is small.',
    ]),
    budget: 14,
    goals: [
      { text: tr('Каталог релизится независимо', 'Catalog is released independently'), check: (m) => m.independent.includes('catalog') },
      { text: tr('Оформление заказа ≤ 150 мс', 'Checkout ≤ 150 ms'), check: (m) => m.flowLatency <= 150 },
      { text: tr('Нет сломанных функций и рисков потери данных', 'No broken features and no risk of data loss'), check: noProblems },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns'), check: noExcess },
    ],
    debrief: tr([
      'Самый дешёвый путь — вынести один модуль со своей БД, а все чтения его таблиц перевести на API. Брокер, реплики и саги здесь дороже и не нужны.',
      'Когда сервисов станет больше, синхронные API начнут копить латентность и отказы. Тогда и придёт время событий и реплик.',
    ], [
      'The cheapest path is to extract a single module with its own DB and switch all reads of its tables to an API. A broker, replicas and sagas cost more here and are not needed.',
      'As the number of services grows, synchronous APIs will start accumulating latency and failures. That is when events and replicas earn their place.',
    ]),
    solution: {
      extract: ['catalog'],
      ownDb: ['catalog'],
      modes: { 'cart-catalog': 'api', 'catalog-inventory': 'api', 'reports-catalog': 'api' },
      patterns: ['gateway'],
    },
    solutionSteps: tr([
      'Strangler-фасад.',
      'Вынести Каталог и выделить ему БД.',
      'Корзина → Каталог, Каталог → Склад, Отчёты → Каталог: перевести на API — прямой SQL после отделения БД сломается.',
    ], [
      'Strangler facade.',
      'Extract Catalog and give it its own DB.',
      'Cart → Catalog, Catalog → Inventory, Reports → Catalog: switch to API, since direct SQL breaks once the DB is separated.',
    ]),
  },
  {
    id: 'reports',
    title: tr('Ночной отчёт роняет магазин', 'The nightly report takes the store down'),
    brief: tr([
      'Аналитики запускают отчёт по выручке в 9 утра — он делает full scan по заказам и платежам, и оформление заказов встаёт на 15 минут. Отчёты должны жить отдельно и не трогать боевую базу.',
    ], [
      'Analysts run the revenue report at 9 a.m. It does a full scan over orders and payments, and checkout stalls for 15 minutes. Reports must live separately and stay off the production database.',
    ]),
    budget: 22,
    goals: [
      { text: tr('Отчёты релизятся независимо', 'Reports are released independently'), check: (m) => m.independent.includes('reports') },
      { text: tr('Тяжёлый отчёт в разгар дня не трогает боевую БД', 'A heavy report at peak time does not touch the production DB'), check: stressOk('heavy-read') },
      { text: tr('Нет сломанных функций и рисков потери данных', 'No broken features and no risk of data loss'), check: noProblems },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns'), check: noExcess },
    ],
    debrief: tr([
      'Это CQRS: у отчётов своя база-проекция, которую наполняют события о заказах, платежах и каталоге. Боевая БД больше не видит тяжёлых запросов.',
      'Монолит сам событий не публикует — здесь удобен CDC (Debezium читает журнал транзакций без правок легаси-кода). Outbox тоже подходит, но требует доработать монолит.',
    ], [
      'This is CQRS: reports have their own projection database, fed by events about orders, payments and the catalog. The production DB no longer sees heavy queries.',
      'The monolith does not publish events itself, so CDC is convenient here (Debezium reads the transaction log without touching legacy code). An outbox works too, but requires changes to the monolith.',
    ]),
    solution: {
      extract: ['reports'],
      ownDb: ['reports'],
      modes: { 'reports-orders': 'replica', 'reports-payments': 'replica', 'reports-catalog': 'replica' },
      patterns: ['gateway', 'kafka', 'cdc', 'idempotentConsumer'],
    },
    solutionSteps: tr([
      'Strangler-фасад, Kafka, CDC (или Outbox) и идемпотентный консьюмер.',
      'Подготовить в монолите реплики для всех трёх чтений Отчётов.',
      'Вынести Отчёты и выделить им БД.',
    ], [
      'Strangler facade, Kafka, CDC (or Outbox) and an idempotent consumer.',
      'In the monolith, prepare replicas for all three Reports reads.',
      'Extract Reports and give them their own DB.',
    ]),
  },
  {
    id: 'emails',
    title: tr('Письма не должны ронять заказы', 'Emails must not break orders'),
    brief: tr([
      'Почтовый провайдер падает раз в неделю — и вместе с ним падает оформление заказа: письмо «заказ принят» отправляется синхронно. Команда платформы хочет вынести уведомления в отдельный сервис, а бизнес — чтобы заказы не зависели от писем.',
    ], [
      'The email provider goes down once a week, and checkout goes down with it: the "order received" email is sent synchronously. The platform team wants to move notifications into a separate service, and the business wants orders not to depend on emails.',
    ]),
    budget: 14,
    goals: [
      { text: tr('Уведомления релизятся независимо', 'Notifications are released independently'), check: (m) => m.independent.includes('notifications') },
      { text: tr('Доступность оформления ≥ 99.8% — падение писем его не задевает', 'Checkout availability ≥ 99.8%: email outages do not affect it'), check: (m) => m.flowAvailability >= 0.998 },
      { text: tr('Нет сломанных функций и рисков потери данных', 'No broken features and no risk of data loss'), check: noProblems },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns'), check: noExcess },
    ],
    debrief: tr([
      'Дешевле всего — circuit breaker: некритичный вызов уведомлений при сбое просто пропускается, и заказ оформляется. Это graceful degradation.',
      'Асинхронные события надёжнее (письмо уйдёт, когда провайдер поднимется), но требуют брокера, outbox и идемпотентности — втрое дороже. Выбор зависит от того, можно ли потерять письмо.',
    ], [
      'The cheapest option is a circuit breaker: on failure, the non-critical notification call is simply skipped and the order goes through. This is graceful degradation.',
      'Asynchronous events are more reliable (the email goes out once the provider is back), but they require a broker, an outbox and idempotency, which costs three times as much. The choice depends on whether losing an email is acceptable.',
    ]),
    solution: {
      extract: ['notifications'],
      ownDb: ['notifications'],
      modes: {},
      patterns: ['gateway', 'circuitBreakers'],
    },
    solutionSteps: tr([
      'Strangler-фасад и circuit breaker.',
      'Вынести Уведомления и выделить им БД. Вызовы остаются синхронными, но breaker не даёт сбою писем уронить заказ.',
    ], [
      'Strangler facade and circuit breaker.',
      'Extract Notifications and give them their own DB. Calls stay synchronous, but the breaker keeps an email failure from breaking the order.',
    ]),
  },
  {
    id: 'pci',
    title: tr('Платежи под PCI DSS', 'Payments under PCI DSS'),
    brief: tr([
      'Аудиторы PCI DSS требуют изолировать платёжный контур: отдельный сервис и БД, шифрованная связь между сервисами, проверка прав пользователя на каждый вызов и полная история операций. Деньги и заказы не должны расходиться.',
    ], [
      'PCI DSS auditors require the payment perimeter to be isolated: a separate service and DB, encrypted service-to-service traffic, user authorization on every call and a full operation history. Money and orders must never get out of sync.',
    ]),
    budget: 26,
    goals: [
      { text: tr('Платежи релизятся независимо', 'Payments are released independently'), check: (m) => m.independent.includes('payments') },
      { text: tr('Взлом соседнего сервиса не открывает платежи', 'A compromised neighboring service does not expose payments'), check: stressOk('security') },
      { text: tr('Есть полная история операций', 'A full operation history is kept'), check: stressOk('audit') },
      { text: tr('Оформление заказа ≤ 150 мс', 'Checkout ≤ 150 ms'), check: (m) => m.flowLatency <= 150 },
      { text: tr('Нет сломанных функций и рисков потери данных', 'No broken features and no risk of data loss'), check: noProblems },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns'), check: noExcess },
    ],
    debrief: tr([
      'Изоляция платёжного контура сужает зону аудита: в scope PCI DSS попадает один сервис, а не весь магазин.',
      'Транзакция «заказ + списание» стала сагой: при отказе списания заказ отменяется компенсирующим событием. mTLS и токены доступа не дают взломанному соседу притвориться клиентом.',
    ], [
      'Isolating the payment perimeter narrows the audit scope: PCI DSS covers one service instead of the whole store.',
      'The "order + charge" transaction became a saga: if the charge fails, the order is cancelled by a compensating event. mTLS and access tokens prevent a compromised neighbor from impersonating a customer.',
    ]),
    solution: {
      extract: ['payments'],
      ownDb: ['payments'],
      modes: { 'orders-payments': 'saga', 'payments-users': 'api', 'reports-payments': 'api' },
      patterns: ['gateway', 'kafka', 'outbox', 'idempotentConsumer', 'mtls', 'accessToken', 'auditLog'],
    },
    solutionSteps: tr([
      'Strangler-фасад, Kafka, Outbox, идемпотентный консьюмер.',
      'Подготовить: Заказы → Платежи — сага; Платежи → Пользователи и Отчёты → Платежи — API.',
      'Вынести Платежи со своей БД.',
      'mTLS, Access token (JWT) и Audit logging.',
    ], [
      'Strangler facade, Kafka, Outbox, idempotent consumer.',
      'Prepare: Orders → Payments as a saga; Payments → Users and Reports → Payments via API.',
      'Extract Payments with its own DB.',
      'mTLS, Access token (JWT) and Audit logging.',
    ]),
  },
]

const shop: Project = {
  id: 'shop',
  title: tr('Интернет-магазин', 'Online store'),
  short: tr('Учебный уровень: 8 модулей, понятный домен', 'Training level: 8 modules, a familiar domain'),
  intro: tr([
    'Интернет-магазину 7 лет. Восемь команд коммитят в один репозиторий, релиз раз в две недели, и его согласовывают все.',
  ], [
    'The online store is 7 years old. Eight teams commit to a single repository, releases happen every two weeks, and everyone has to sign off on them.',
  ]),
  entry: 'orders',
  entryLabel: tr('оформление заказа', 'checkout'),
  external: tr('Платёжный провайдер', 'Payment provider'),
  modules: shopModules,
  deps: shopDeps,
  missions: shopMissions,
  targets: { latency: 150, availability: 0.997, complexity: 52 },
}

// ---------------- Уровень 2: интернет-банк ----------------
// Типичный модульный монолит интернет-банка: тяжёлое ядро и документы,
// от которых зависит всё; синхронная интеграция с АБС; лимиты и антифрод в одной транзакции
// с платежом; одна общая БД и ни одного брокера сообщений.

const bankModules: ModuleDef[] = [
  { id: 'accounts', title: tr('Клиенты и счета', 'Customers and accounts'), icon: '🏦', team: tr('Ядро', 'Core'), desc: tr('Профиль клиента, счета, карты, тарифы. 200+ таблиц', 'Customer profile, accounts, cards, tariffs. 200+ tables'), effort: 8 },
  { id: 'documents', title: tr('Документы', 'Documents'), icon: '📄', team: tr('Ядро', 'Core'), desc: tr('Платёжные документы и их жизненный цикл: черновик → подписан → исполнен', 'Payment documents and their lifecycle: draft → signed → executed'), effort: 6 },
  { id: 'transfers', title: tr('Переводы', 'Transfers'), icon: '💸', team: tr('Платежи', 'Payments'), desc: tr('Перевод по номеру телефона, между своими счетами, на карту', 'Transfers by phone number, between own accounts, to a card'), effort: 3 },
  { id: 'billpay', title: tr('Оплата услуг', 'Bill payments'), icon: '🧾', team: tr('Платежи', 'Payments'), desc: tr('ЖКХ, связь, штрафы, налоги', 'Utilities, mobile, fines, taxes'), effort: 3 },
  { id: 'limits', title: tr('Лимиты', 'Limits'), icon: '🚦', team: tr('Риски', 'Risk'), desc: tr('Суточные и месячные лимиты на операции', 'Daily and monthly transaction limits'), effort: 2 },
  { id: 'antifraud', title: tr('Антифрод', 'Anti-fraud'), icon: '🛡️', team: tr('Риски', 'Risk'), desc: tr('Скоринг операций, блокировка подозрительных', 'Transaction scoring, blocking suspicious ones'), effort: 2 },
  { id: 'confirm', title: tr('Подтверждение', 'Confirmation'), icon: '🔑', team: tr('Безопасность', 'Security'), desc: tr('SMS/push-коды, электронная подпись', 'SMS/push codes, electronic signature'), effort: 2 },
  { id: 'ledger', title: tr('Шлюз АБС', 'CBS gateway'), icon: '🏛️', team: tr('Интеграции', 'Integrations'), desc: tr('Проводки и остатки в автоматизированной банковской системе', 'Postings and balances in the core banking system'), effort: 4 },
  { id: 'offers', title: tr('Предложения и сторис', 'Offers and stories'), icon: '🎯', team: tr('Маркетинг', 'Marketing'), desc: tr('Персональные предложения, сторис, баннеры', 'Personal offers, stories, banners'), effort: 1 },
  { id: 'audit', title: tr('Аудит', 'Audit'), icon: '🗂️', team: tr('Комплаенс', 'Compliance'), desc: tr('Журнал действий, выгрузки для регулятора', 'Activity log, regulatory exports'), effort: 1 },
]

const bankDeps: Dep[] = [
  {
    id: 'transfers-accounts',
    from: 'transfers',
    to: 'accounts',
    kind: 'read',
    critical: true,
    label: tr('счёт списания', 'debit account'),
    why: tr('Перевод делает JOIN к таблицам счетов ядра, чтобы найти счёт списания и тариф.', 'The transfer JOINs the core\'s account tables to find the debit account and tariff.'),
  },
  {
    id: 'transfers-documents',
    from: 'transfers',
    to: 'documents',
    kind: 'tx',
    critical: true,
    label: tr('платёжный документ', 'payment document'),
    why: tr('Документ перевода создаётся в той же транзакции, что и сам перевод.', 'The transfer document is created in the same transaction as the transfer itself.'),
  },
  {
    id: 'transfers-limits',
    from: 'transfers',
    to: 'limits',
    kind: 'tx',
    critical: true,
    label: tr('счётчик лимита', 'limit counter'),
    why: tr('Суточный лимит увеличивается в той же транзакции: иначе два параллельных перевода проскочат лимит.', 'The daily limit counter is incremented in the same transaction; otherwise two concurrent transfers could slip past the limit.'),
  },
  {
    id: 'transfers-antifraud',
    from: 'transfers',
    to: 'antifraud',
    kind: 'call',
    critical: true,
    label: tr('скоринг операции', 'transaction scoring'),
    why: tr('Перед исполнением перевод синхронно получает оценку риска.', 'Before execution the transfer synchronously gets a risk score.'),
  },
  {
    id: 'transfers-confirm',
    from: 'transfers',
    to: 'confirm',
    kind: 'call',
    critical: true,
    label: tr('код подтверждения', 'confirmation code'),
    why: tr('Перевод проверяет SMS-код или подпись клиента.', 'The transfer verifies the customer\'s SMS code or signature.'),
  },
  {
    id: 'transfers-ledger',
    from: 'transfers',
    to: 'ledger',
    kind: 'call',
    critical: true,
    label: tr('проводка', 'posting'),
    why: tr('Деньги списываются проводкой в АБС через шлюз.', 'Money is debited by a posting in the CBS via the gateway.'),
  },
  {
    id: 'transfers-audit',
    from: 'transfers',
    to: 'audit',
    kind: 'call',
    critical: false,
    label: tr('запись в журнал', 'log entry'),
    why: tr('Каждая операция пишется в журнал аудита.', 'Every operation is written to the audit log.'),
  },
  {
    id: 'billpay-documents',
    from: 'billpay',
    to: 'documents',
    kind: 'tx',
    critical: true,
    label: tr('документ оплаты', 'payment document'),
    why: tr('Оплата услуги тоже создаёт платёжный документ в общей транзакции.', 'A bill payment also creates a payment document in the shared transaction.'),
  },
  {
    id: 'billpay-ledger',
    from: 'billpay',
    to: 'ledger',
    kind: 'call',
    critical: true,
    label: tr('проводка', 'posting'),
    why: tr('Оплата проводится через тот же шлюз АБС.', 'The payment is posted through the same CBS gateway.'),
  },
  {
    id: 'limits-accounts',
    from: 'limits',
    to: 'accounts',
    kind: 'read',
    critical: true,
    label: tr('тарифный план', 'tariff plan'),
    why: tr('Размер лимита зависит от тарифа клиента — читается JOIN-ом из таблиц ядра.', 'The limit size depends on the customer\'s tariff, read with a JOIN from the core\'s tables.'),
  },
  {
    id: 'antifraud-documents',
    from: 'antifraud',
    to: 'documents',
    kind: 'read',
    critical: false,
    heavy: true,
    label: tr('история операций', 'transaction history'),
    why: tr('Скоринг смотрит последние операции клиента прямым запросом к таблице документов.', 'Scoring looks at the customer\'s recent transactions with a direct query on the documents table.'),
  },
  {
    id: 'ledger-documents',
    from: 'ledger',
    to: 'documents',
    kind: 'call',
    critical: false,
    label: tr('статус исполнения', 'execution status'),
    why: tr('Когда АБС исполнила проводку, шлюз обновляет статус документа.', 'Once the CBS has executed the posting, the gateway updates the document status.'),
  },
  {
    id: 'offers-accounts',
    from: 'offers',
    to: 'accounts',
    kind: 'read',
    critical: false,
    heavy: true,
    label: tr('сегмент клиента', 'customer segment'),
    why: tr('Предложения подбираются по продуктам и сегменту клиента.', 'Offers are selected based on the customer\'s products and segment.'),
  },
  {
    id: 'offers-documents',
    from: 'offers',
    to: 'documents',
    kind: 'read',
    critical: false,
    heavy: true,
    label: tr('последние операции', 'recent transactions'),
    why: tr('«Вы часто платите за связь — подключите автоплатёж»: тяжёлый запрос по документам.', '"You often pay your phone bill, so set up autopay": a heavy query over documents.'),
  },
  {
    id: 'audit-documents',
    from: 'audit',
    to: 'documents',
    kind: 'read',
    critical: false,
    heavy: true,
    label: tr('выгрузка для регулятора', 'regulatory export'),
    why: tr('Ночная выгрузка читает все документы за сутки.', 'The nightly export reads all documents for the day.'),
  },
]

const bankMissions: Mission[] = [
  {
    id: 'payments',
    title: tr('Независимые релизы платежей', 'Independent payment releases'),
    brief: tr([
      'Платёжная команда хочет выпускать фичи переводов каждую неделю, риски — менять скоринг без общего релиза, маркетинг — не ронять банк тяжёлыми запросами. Деньги не должны теряться ни при каком сбое.',
    ], [
      'The payments team wants to ship transfer features every week, Risk wants to change scoring without a shared release, and Marketing wants to stop bringing the bank down with heavy queries. Money must never be lost, whatever fails.',
    ]),
    budget: 91,
    goals: [
      {
        text: tr('Переводы и Антифрод релизятся независимо', 'Transfers and Anti-fraud are released independently'),
        check: (m) => m.independent.includes('transfers') && m.independent.includes('antifraud'),
      },
      { text: tr('Всего минимум 5 модулей релизятся независимо', 'At least 5 modules in total released independently'), check: (m) => m.independent.length >= 5 },
      { text: tr('Перевод ≤ 160 мс', 'Transfer ≤ 160 ms'), check: (m) => m.flowLatency <= 160 },
      { text: tr('Доступность переводов ≥ 99.5%', 'Transfer availability ≥ 99.5%'), check: (m) => m.flowAvailability >= 0.995 },
      { text: tr('Нет сломанных функций и рисков потери денег', 'No broken features and no risk of losing money'), check: noProblems },
      { text: tr('Сложность эксплуатации ≤ 52', 'Operational complexity ≤ 52'), check: (m) => m.complexity <= 52 },
      { text: tr('Пройдены все стресс-тесты', 'All stress tests passed'), check: allStress },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns'), check: noExcess },
    ],
    debrief: tr([
      'В банке нельзя «распилить всё»: каждый синхронный сервис на пути перевода отнимает доступность, а антифрод, подтверждение и проводка обязаны ответить до исполнения. Независимость получают модули, которые можно отвязать событиями и сагами: аудит, предложения, оплата услуг, сами переводы, антифрод.',
      'Ядро (клиенты, счета, документы) обычно уходит последним, а часто остаётся «хорошим монолитом». Чтения из него заменяют API и репликами, а транзакции с документами и лимитами — сагами с компенсациями. Outbox здесь обязателен: потерянное событие — это потерянные деньги.',
    ], [
      'A bank cannot "split everything": every synchronous service on the transfer path eats into availability, and anti-fraud, confirmation and posting must all respond before execution. Independence goes to the modules that can be decoupled with events and sagas: audit, offers, bill payments, transfers themselves, anti-fraud.',
      'The core (customers, accounts, documents) usually goes last, and often stays a "good monolith". Reads from it are replaced with APIs and replicas, and transactions with documents and limits with compensating sagas. An outbox is mandatory here: a lost event means lost money.',
    ]),
    solution: {
      extract: ['transfers', 'billpay', 'antifraud', 'offers', 'audit'],
      ownDb: ['transfers', 'billpay', 'antifraud', 'offers', 'audit'],
      modes: {
        'transfers-accounts': 'api',
        'transfers-documents': 'saga',
        'transfers-limits': 'saga',
        'transfers-audit': 'async',
        'billpay-documents': 'saga',
        'antifraud-documents': 'replica',
        'offers-accounts': 'replica',
        'offers-documents': 'replica',
        'audit-documents': 'replica',
      },
      patterns: [
        'gateway', 'acl', 'bff', 'accessToken', 'rateLimiter', 'kafka', 'mtls', 'outbox', 'idempotentConsumer',
        'sagaOrchestrator', 'circuitBreakers', 'retry', 'bulkhead', 'idempotencyKeys', 'tracing', 'logs', 'metrics',
        'health', 'auditLog', 'containers', 'canary', 'config', 'contracts',
      ],
    },
    solutionSteps: tr([
      'Strangler-фасад, затем вынести Переводы, Оплату услуг, Антифрод, Предложения и Аудит со своими БД. Ядро, Документы, Лимиты, Подтверждение и Шлюз АБС оставить.',
      'Переводы → Документы, Переводы → Лимиты, Оплата → Документы: саги. Переводы → Счета: API. Переводы → Аудит: событие.',
      'Антифрод, Предложения и Аудит читают ядро через реплики (CQRS).',
      'Kafka + Outbox + идемпотентный консьюмер + оркестратор саг; остальное — по подсказкам стресс-тестов.',
    ], [
      'Strangler facade, then extract Transfers, Bill payments, Anti-fraud, Offers and Audit with their own DBs. Leave the core, Documents, Limits, Confirmation and the CBS gateway in place.',
      'Transfers → Documents, Transfers → Limits, Bill payments → Documents: sagas. Transfers → Accounts: API. Transfers → Audit: event.',
      'Anti-fraud, Offers and Audit read the core through replicas (CQRS).',
      'Kafka + Outbox + idempotent consumer + saga orchestrator; the rest as the stress tests suggest.',
    ]),
  },
  {
    id: 'salary-day',
    title: tr('День зарплаты', 'Payday'),
    brief: tr([
      'В день зарплаты нагрузка вырастает в пять раз, и именно тогда АБС любит отвечать по 30 секунд. В прошлый раз упал весь банк, включая вход в приложение. Распил отложен на следующий год.',
    ], [
      'On payday the load grows fivefold, and that is exactly when the CBS likes to take 30 seconds to respond. Last time the whole bank went down, including app login. Breaking up the monolith is postponed until next year.',
    ]),
    budget: 14,
    goals: [
      { text: tr('Пережить пик нагрузки ×5', 'Survive a ×5 load peak'), check: stressOk('peak') },
      { text: tr('Пережить зависание АБС', 'Survive a hanging CBS'), check: stressOk('slow-dep') },
      { text: tr('Релиз с ошибкой не задевает всех клиентов', 'A faulty release does not hit all customers'), check: stressOk('bad-deploy') },
      { text: tr('Доступность переводов ≥ 99.8%', 'Transfer availability ≥ 99.8%'), check: (m) => m.flowAvailability >= 0.998 },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns'), check: noExcess },
    ],
    debrief: tr([
      'Устойчивость не требует распила: rate limiter, автоскейлинг, circuit breaker с bulkhead (у АБС свой пул соединений) и canary-релизы защищают и монолит.',
      'Bulkhead здесь ключевой: зависшая АБС съедает только свой пул, а вход в приложение и просмотр счетов продолжают работать.',
    ], [
      'Resilience does not require a breakup: a rate limiter, autoscaling, a circuit breaker with a bulkhead (the CBS gets its own connection pool) and canary releases protect a monolith too.',
      'The bulkhead is the key here: a hanging CBS exhausts only its own pool, while app login and account views keep working.',
    ]),
    solution: { extract: [], ownDb: [], modes: {}, patterns: [...RESILIENCE_ONLY] },
    solutionSteps: tr([
      'Ничего не выносить.',
      'Rate limiter + контейнеры с автоскейлингом.',
      'Circuit breaker + bulkhead для АБС.',
      'Canary-релизы + health check.',
    ], [
      'Extract nothing.',
      'Rate limiter + containers with autoscaling.',
      'Circuit breaker + bulkhead for the CBS.',
      'Canary releases + health checks.',
    ]),
  },
  {
    id: 'antifraud',
    title: tr('Антифрод отдельно', 'Anti-fraud on its own'),
    brief: tr([
      'Мошенники меняют схемы каждую неделю, а правила скоринга выходят раз в месяц вместе с релизом всего банка. Риски просят независимый релиз антифрода. Бюджет минимальный.',
    ], [
      'Fraudsters change their schemes every week, but scoring rules ship once a month with the whole bank\'s release. Risk is asking for an independent anti-fraud release. The budget is minimal.',
    ]),
    budget: 11,
    goals: [
      { text: tr('Антифрод релизится независимо', 'Anti-fraud is released independently'), check: (m) => m.independent.includes('antifraud') },
      { text: tr('Перевод ≤ 160 мс', 'Transfer ≤ 160 ms'), check: (m) => m.flowLatency <= 160 },
      { text: tr('Нет сломанных функций и рисков потери денег', 'No broken features and no risk of losing money'), check: noProblems },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns'), check: noExcess },
    ],
    debrief: tr([
      'Минимальный распил: один сервис, своя БД и чтение истории операций через API ядра. Реплика на событиях была бы лучше для нагрузки, но требует брокера и outbox — это втрое дороже.',
      'Такой «первый сервис» — нормальный старт Strangler Fig: команда учится жить с сетью, а платформа появляется по мере необходимости.',
    ], [
      'A minimal breakup: one service, its own DB, and reading transaction history through the core\'s API. An event-fed replica would be better for load, but it needs a broker and an outbox, which costs three times as much.',
      'Such a "first service" is a normal start for Strangler Fig: the team learns to live with the network, and the platform grows as needed.',
    ]),
    solution: {
      extract: ['antifraud'],
      ownDb: ['antifraud'],
      modes: { 'antifraud-documents': 'api' },
      patterns: ['gateway'],
    },
    solutionSteps: tr([
      'Strangler-фасад.',
      'Вынести Антифрод и выделить ему БД.',
      'Антифрод → Документы перевести на API.',
    ], [
      'Strangler facade.',
      'Extract Anti-fraud and give it its own DB.',
      'Switch Anti-fraud → Documents to API.',
    ]),
  },
  {
    id: 'regulator',
    title: tr('Регулятор: аудит и отчётность', 'Regulator: audit and reporting'),
    brief: tr([
      'Регулятор требует хранить историю всех операций и выдавать выгрузки по запросу. Сейчас ночная выгрузка и маркетинговые запросы читают основную БД и тормозят переводы.',
    ], [
      'The regulator requires a history of all operations to be kept and exports to be provided on request. Right now the nightly export and marketing queries read the main DB and slow down transfers.',
    ]),
    budget: 34,
    goals: [
      { text: tr('Аудит релизится независимо', 'Audit is released independently'), check: (m) => m.independent.includes('audit') },
      { text: tr('История изменений для регулятора', 'Change history for the regulator'), check: stressOk('audit') },
      { text: tr('Тяжёлые чтения не трогают основную БД', 'Heavy reads do not touch the main DB'), check: stressOk('heavy-read') },
      { text: tr('Нет сломанных функций и рисков потери денег', 'No broken features and no risk of losing money'), check: noProblems },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns'), check: noExcess },
    ],
    debrief: tr([
      'CQRS в чистом виде: тяжёлые читатели (аудит, предложения, антифрод) получают свои копии данных через события и больше не ходят в основную БД.',
      'Outbox или CDC обязательны: потерянное событие — это дыра в выгрузке для регулятора. CDC удобен именно с легаси: Debezium читает журнал транзакций монолита без правок его кода.',
    ], [
      'CQRS in its purest form: heavy readers (audit, offers, anti-fraud) get their own copies of the data via events and no longer hit the main DB.',
      'An outbox or CDC is mandatory: a lost event is a hole in the regulatory export. CDC is especially handy with legacy code: Debezium reads the monolith\'s transaction log without touching its code.',
    ]),
    solution: {
      extract: ['audit', 'offers', 'antifraud'],
      ownDb: ['audit', 'offers', 'antifraud'],
      modes: {
        'audit-documents': 'replica',
        'offers-accounts': 'replica',
        'offers-documents': 'replica',
        'antifraud-documents': 'replica',
      },
      patterns: ['gateway', 'kafka', 'outbox', 'idempotentConsumer', 'auditLog', 'tracing'],
    },
    solutionSteps: tr([
      'Strangler-фасад, Kafka, Outbox, идемпотентный консьюмер, Audit logging и трассировка — сервисов уже три.',
      'Вынести Аудит, Предложения и Антифрод со своими БД.',
      'Все их чтения ядра и документов — реплики (CQRS).',
    ], [
      'Strangler facade, Kafka, Outbox, idempotent consumer, Audit logging and tracing, since there are already three services.',
      'Extract Audit, Offers and Anti-fraud with their own DBs.',
      'All their reads of the core and documents: replicas (CQRS).',
    ]),
  },
  {
    id: 'billpay',
    title: tr('Оплата услуг отдельно', 'Bill payments on their own'),
    brief: tr([
      'Команда «Оплаты услуг» подключает по два новых поставщика в неделю и не может ждать общего релиза. При этом сеть до АБС иногда моргает: клиенты видят ошибки, а при повторе платёж может пройти дважды.',
    ], [
      'The Bill payments team onboards two new billers a week and cannot wait for the shared release. Meanwhile the network to the CBS occasionally flickers: customers see errors, and on retry a payment may go through twice.',
    ]),
    budget: 25,
    goals: [
      { text: tr('Оплата услуг релизится независимо', 'Bill payments are released independently'), check: (m) => m.independent.includes('billpay') },
      { text: tr('Кратковременные сбои сети не видны клиенту', 'Brief network glitches are invisible to the customer'), check: stressOk('flaky') },
      { text: tr('Повтор запроса не списывает деньги дважды', 'A retried request does not charge twice'), check: stressOk('double') },
      { text: tr('Нет сломанных функций и рисков потери денег', 'No broken features and no risk of losing money'), check: noProblems },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns'), check: noExcess },
    ],
    debrief: tr([
      'Ретраи без идемпотентности — классическая причина двойных списаний: ответ потерялся, клиент повторил, АБС провела платёж второй раз. Idempotency key делает повтор безопасным.',
      'Документ оплаты и сам платёж больше не в одной транзакции — их связывает сага с компенсацией.',
    ], [
      'Retries without idempotency are the classic cause of double charges: the response got lost, the client retried, and the CBS posted the payment a second time. An idempotency key makes retries safe.',
      'The payment document and the payment itself are no longer in one transaction; a compensating saga ties them together.',
    ]),
    solution: {
      extract: ['billpay'],
      ownDb: ['billpay'],
      modes: { 'billpay-documents': 'saga' },
      patterns: ['gateway', 'kafka', 'outbox', 'idempotentConsumer', 'retry', 'idempotencyKeys'],
    },
    solutionSteps: tr([
      'Strangler-фасад, Kafka, Outbox, идемпотентный консьюмер.',
      'Подготовить сагу Оплата → Документы.',
      'Вынести Оплату услуг со своей БД.',
      'Retry с backoff и Idempotency key для проводок в АБС.',
    ], [
      'Strangler facade, Kafka, Outbox, idempotent consumer.',
      'Prepare the Bill payments → Documents saga.',
      'Extract Bill payments with its own DB.',
      'Retry with backoff and Idempotency key for CBS postings.',
    ]),
  },
  {
    id: 'abs-outage',
    title: tr('АБС падает — банк живёт', 'The CBS is down, the bank lives on'),
    brief: tr([
      'Когда АБС уходит на регламентные работы или зависает, ложится весь интернет-банк: шлюз АБС живёт в монолите и съедает все потоки. Клиенты должны хотя бы видеть счета и историю, пока проводки недоступны.',
    ], [
      'When the CBS goes into scheduled maintenance or hangs, the entire online bank goes down: the CBS gateway lives inside the monolith and eats all the threads. Customers should at least be able to see their accounts and history while postings are unavailable.',
    ]),
    budget: 16,
    goals: [
      { text: tr('Радиус поражения ≤ 60%', 'Blast radius ≤ 60%'), check: (m) => m.blastRadius <= 0.6 },
      { text: tr('Зависание АБС не роняет приложение', 'A hanging CBS does not take the app down'), check: stressOk('slow-dep') },
      { text: tr('Нет сломанных функций и рисков потери денег', 'No broken features and no risk of losing money'), check: noProblems },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns'), check: noExcess },
    ],
    debrief: tr([
      'Интеграцию с внешней системой изолируют в отдельный процесс: его падение задевает только тех, кому он нужен синхронно (переводы, оплата услуг), а не весь банк.',
      'Bulkhead держит под АБС отдельный пул соединений, circuit breaker быстро отвечает «проводки временно недоступны» вместо 30-секундного ожидания.',
    ], [
      'The integration with an external system is isolated in a separate process: its failure affects only those who need it synchronously (transfers, bill payments), not the whole bank.',
      'The bulkhead keeps a dedicated connection pool for the CBS, and the circuit breaker quickly answers "postings temporarily unavailable" instead of waiting 30 seconds.',
    ]),
    solution: {
      extract: ['ledger'],
      ownDb: ['ledger'],
      modes: {},
      patterns: ['gateway', 'circuitBreakers', 'bulkhead'],
    },
    solutionSteps: tr([
      'Strangler-фасад, circuit breaker и bulkhead.',
      'Вынести Шлюз АБС в отдельный сервис со своей БД.',
    ], [
      'Strangler facade, circuit breaker and bulkhead.',
      'Extract the CBS gateway into a separate service with its own DB.',
    ]),
  },
  {
    id: 'marketing',
    title: tr('Маркетинг не мешает платежам', 'Marketing stays out of payments\' way'),
    brief: tr([
      'Маркетинг запускает персональные предложения по всей базе: тяжёлые запросы по счетам и операциям каждый час нагружают ядро. Команде нужны свои релизы, а ядру — покой.',
    ], [
      'Marketing runs personal offers across the entire customer base: heavy hourly queries over accounts and transactions load the core. The team needs its own releases, and the core needs peace and quiet.',
    ]),
    budget: 18,
    goals: [
      { text: tr('Предложения релизятся независимо', 'Offers are released independently'), check: (m) => m.independent.includes('offers') },
      {
        text: tr('Запросы маркетинга не ходят в БД ядра', 'Marketing queries do not hit the core DB'),
        check: heavyIsolated('offers-accounts', 'offers-documents'),
      },
      { text: tr('Нет сломанных функций и рисков потери денег', 'No broken features and no risk of losing money'), check: noProblems },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns'), check: noExcess },
    ],
    debrief: tr([
      'Через API ядра было бы дешевле, но тяжёлые запросы просто переехали бы с SQL на HTTP — нагрузка на ядро осталась бы той же. Реплика на событиях отдаёт маркетингу собственную копию данных.',
      'Цена — eventual consistency: предложение может опоздать на несколько секунд после операции. Для маркетинга это нормально.',
    ], [
      'Going through the core\'s API would be cheaper, but the heavy queries would simply move from SQL to HTTP and the load on the core would stay the same. An event-fed replica gives marketing its own copy of the data.',
      'The price is eventual consistency: an offer may lag a few seconds behind a transaction. For marketing that is fine.',
    ]),
    solution: {
      extract: ['offers'],
      ownDb: ['offers'],
      modes: { 'offers-accounts': 'replica', 'offers-documents': 'replica' },
      patterns: ['gateway', 'kafka', 'outbox', 'idempotentConsumer'],
    },
    solutionSteps: tr([
      'Strangler-фасад, Kafka, Outbox, идемпотентный консьюмер.',
      'Подготовить реплики Предложения → Счета и Предложения → Документы.',
      'Вынести Предложения со своей БД.',
    ], [
      'Strangler facade, Kafka, Outbox, idempotent consumer.',
      'Prepare the Offers → Accounts and Offers → Documents replicas.',
      'Extract Offers with its own DB.',
    ]),
  },
]

const bank: Project = {
  id: 'bank',
  title: tr('Интернет-банк «Ромашка»', 'Daisy Online Bank'),
  short: tr('Сложный уровень: 10 модулей, тяжёлое ядро, деньги', 'Hard level: 10 modules, a heavy core, money'),
  intro: tr([
    'Интернет-банк вырос из одного приложения: ядро с клиентами и счетами, документы, а вокруг десятки модулей, которые зависят от ядра и друг от друга. Одна общая БД, интеграция с АБС синхронная, брокера сообщений нет. Релиз — раз в месяц с ночным окном.',
  ], [
    'The online bank grew out of a single application: a core with customers and accounts, documents, and dozens of modules around them that depend on the core and on each other. One shared DB, synchronous integration with the core banking system (CBS), no message broker. Releases happen once a month in a night window.',
  ]),
  entry: 'transfers',
  entryLabel: tr('перевод по телефону', 'transfer by phone number'),
  external: tr('АБС', 'CBS'),
  modules: bankModules,
  deps: bankDeps,
  missions: bankMissions,
  targets: { latency: 160, availability: 0.995, complexity: 52 },
}

// ---------------- Уровень 3: доставка еды ----------------

const foodModules: ModuleDef[] = [
  { id: 'restaurants', title: tr('Рестораны и меню', 'Restaurants and menus'), icon: '🍽️', team: tr('Партнёры', 'Partners'), desc: tr('Карточки ресторанов, меню, цены, часы работы', 'Restaurant pages, menus, prices, opening hours'), effort: 2 },
  { id: 'orders', title: tr('Заказы', 'Orders'), icon: '🧾', team: tr('Заказы', 'Orders'), desc: tr('Корзина, оформление, статусы заказа', 'Cart, checkout, order statuses'), effort: 3 },
  { id: 'dispatch', title: tr('Назначение курьеров', 'Courier dispatch'), icon: '🧭', team: tr('Логистика', 'Logistics'), desc: tr('Подбор ближайшего свободного курьера', 'Finding the nearest available courier'), effort: 2 },
  { id: 'tracking', title: tr('Геотрекинг', 'Geotracking'), icon: '📍', team: tr('Логистика', 'Logistics'), desc: tr('Координаты курьеров: десятки тысяч обновлений в секунду', 'Courier coordinates: tens of thousands of updates per second'), effort: 1 },
  { id: 'payments', title: tr('Оплата', 'Payments'), icon: '💳', team: tr('Финтех', 'Fintech'), desc: tr('Списание, чаевые, возвраты', 'Charges, tips, refunds'), effort: 2 },
  { id: 'promo', title: tr('Промокоды', 'Promo codes'), icon: '🏷️', team: tr('Маркетинг', 'Marketing'), desc: tr('Скидки, акции, первый заказ', 'Discounts, campaigns, first order'), effort: 1 },
  { id: 'reviews', title: tr('Отзывы и рейтинги', 'Reviews and ratings'), icon: '⭐', team: tr('Контент', 'Content'), desc: tr('Отзывы, оценки, рейтинг ресторанов', 'Reviews, scores, restaurant ratings'), effort: 1 },
  { id: 'notifications', title: tr('Уведомления', 'Notifications'), icon: '🔔', team: tr('Платформа', 'Platform'), desc: tr('Push: «курьер в пути», «заказ у двери»', 'Push: "courier on the way", "order at your door"'), effort: 1 },
]

const foodDeps: Dep[] = [
  {
    id: 'orders-restaurants',
    from: 'orders',
    to: 'restaurants',
    kind: 'read',
    critical: true,
    label: tr('меню и цены', 'menu and prices'),
    why: tr('Заказ JOIN-ит позиции с меню, чтобы проверить цены и наличие.', 'The order JOINs its items with the menu to check prices and availability.'),
  },
  {
    id: 'orders-promo',
    from: 'orders',
    to: 'promo',
    kind: 'call',
    critical: false,
    label: tr('применить промокод', 'apply promo code'),
    why: tr('При оформлении проверяется промокод. Если сервис промо недоступен, заказ можно оформить без скидки.', 'The promo code is checked at checkout. If the promo service is unavailable, the order can go through without the discount.'),
  },
  {
    id: 'orders-payments',
    from: 'orders',
    to: 'payments',
    kind: 'tx',
    critical: true,
    label: tr('списание', 'charge'),
    why: tr('Заказ и списание денег — в одной транзакции.', 'The order and the charge are in a single transaction.'),
  },
  {
    id: 'orders-dispatch',
    from: 'orders',
    to: 'dispatch',
    kind: 'call',
    critical: false,
    label: tr('найти курьера', 'find a courier'),
    why: tr('После оплаты заказ синхронно просит назначить курьера — и ждёт.', 'After payment the order synchronously asks for a courier to be assigned, and waits.'),
  },
  {
    id: 'orders-notifications',
    from: 'orders',
    to: 'notifications',
    kind: 'call',
    critical: false,
    label: tr('push «заказ принят»', '"order received" push'),
    why: tr('Клиенту уходит push о принятом заказе.', 'The customer gets a push saying the order was received.'),
  },
  {
    id: 'dispatch-tracking',
    from: 'dispatch',
    to: 'tracking',
    kind: 'read',
    critical: true,
    label: tr('где сейчас курьеры', 'where couriers are now'),
    why: tr('Чтобы найти ближайшего курьера, назначение читает таблицу координат.', 'To find the nearest courier, dispatch reads the coordinates table.'),
  },
  {
    id: 'dispatch-notifications',
    from: 'dispatch',
    to: 'notifications',
    kind: 'call',
    critical: false,
    label: tr('push «курьер назначен»', '"courier assigned" push'),
    why: tr('Клиент и курьер получают уведомление о назначении.', 'The customer and the courier are notified of the assignment.'),
  },
  {
    id: 'reviews-orders',
    from: 'reviews',
    to: 'orders',
    kind: 'read',
    critical: false,
    label: tr('был ли заказ', 'was there an order'),
    why: tr('Отзыв можно оставить только на реальный заказ — проверка через таблицу заказов.', 'A review can only be left for a real order, checked against the orders table.'),
  },
  {
    id: 'restaurants-reviews',
    from: 'restaurants',
    to: 'reviews',
    kind: 'read',
    critical: false,
    heavy: true,
    label: tr('рейтинг в карточке', 'rating on the restaurant page'),
    why: tr('Каждая карточка ресторана считает средний рейтинг агрегатом по всем отзывам.', 'Every restaurant page computes the average rating by aggregating all reviews.'),
  },
  {
    id: 'promo-orders',
    from: 'promo',
    to: 'orders',
    kind: 'read',
    critical: false,
    heavy: true,
    label: tr('история заказов', 'order history'),
    why: tr('«Скидка на десятый заказ»: промо сканирует историю заказов клиента.', '"Discount on your tenth order": promo scans the customer\'s order history.'),
  },
]

const foodMissions: Mission[] = [
  {
    id: 'tracking',
    title: tr('Геотрекинг съедает базу', 'Geotracking is eating the database'),
    brief: tr([
      'Курьеры шлют координаты каждые 3 секунды — это 40 тысяч записей в секунду в общую базу. Она задыхается, и тормозит всё: меню, заказы, оплата. Нужно убрать этот поток из общей БД.',
    ], [
      'Couriers send their coordinates every 3 seconds: 40,000 writes per second into the shared database. It is choking, and everything slows down: menus, orders, payments. This stream has to be moved out of the shared DB.',
    ]),
    budget: 8,
    goals: [
      { text: tr('Геотрекинг релизится независимо', 'Geotracking is released independently'), check: (m) => m.independent.includes('tracking') },
      { text: tr('Нет сломанных функций и рисков потери данных', 'No broken features and no risk of data loss'), check: noProblems },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns'), check: noExcess },
    ],
    debrief: tr([
      'Хороший первый кандидат на вынос — горячий модуль с почти отдельными данными: у геотрекинга одна входящая связь и огромный поток записей, которому в общей БД не место.',
      'Назначение курьеров теперь спрашивает координаты через API. Позже трекинг можно перевести на хранилище, созданное для такого потока (Redis Geo, Cassandra), не трогая монолит.',
    ], [
      'A good first candidate for extraction is a hot module with nearly separate data: geotracking has a single incoming dependency and a huge write stream that does not belong in the shared DB.',
      'Courier dispatch now asks for coordinates via an API. Later, tracking can move to storage built for this kind of stream (Redis Geo, Cassandra) without touching the monolith.',
    ]),
    solution: {
      extract: ['tracking'],
      ownDb: ['tracking'],
      modes: { 'dispatch-tracking': 'api' },
      patterns: ['gateway'],
    },
    solutionSteps: tr([
      'Strangler-фасад.',
      'Подготовить: Назначение → Геотрекинг через API.',
      'Вынести Геотрекинг со своей БД.',
    ], [
      'Strangler facade.',
      'Prepare: Courier dispatch → Geotracking via API.',
      'Extract Geotracking with its own DB.',
    ]),
  },
  {
    id: 'checkout',
    title: tr('Оформление заказа отвечает за всё', 'Checkout is responsible for everything'),
    brief: tr([
      'Команда заказов — самая загруженная: любой релиз ресторанов, промо или логистики требует их согласования, а оформление ждёт назначения курьера. Нужно вынести Заказы — самый связанный модуль — так, чтобы оформление стало быстрее и надёжнее.',
    ], [
      'The orders team is the busiest: every release of restaurants, promo or logistics needs their sign-off, and checkout waits for a courier to be assigned. Orders, the most coupled module, needs to be extracted so that checkout becomes faster and more reliable.',
    ]),
    budget: 30,
    goals: [
      { text: tr('Заказы релизятся независимо', 'Orders are released independently'), check: (m) => m.independent.includes('orders') },
      { text: tr('Оформление заказа ≤ 150 мс', 'Checkout ≤ 150 ms'), check: (m) => m.flowLatency <= 150 },
      { text: tr('Доступность оформления ≥ 99.6%', 'Checkout availability ≥ 99.6%'), check: (m) => m.flowAvailability >= 0.996 },
      { text: tr('Нет сломанных функций и рисков потери данных', 'No broken features and no risk of data loss'), check: noProblems },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns'), check: noExcess },
    ],
    debrief: tr([
      'Самый связанный модуль — самый дорогой распил: каждая из семи связей требует своего решения. Меню — через API, оплата — сага, курьер и push — события (клиенту не нужно ждать курьера, чтобы увидеть «заказ принят»), промокод — синхронно, но за circuit breaker.',
      'Чаще такой модуль выносят последним, когда вокруг уже есть платформа и опыт. Обратите внимание, во что вынос обошёлся по сравнению с геотрекингом.',
    ], [
      'The most coupled module is the most expensive to extract: each of its seven dependencies needs its own solution. Menu via API, payment as a saga, courier and push as events (the customer should not wait for a courier to see "order received"), promo code synchronously but behind a circuit breaker.',
      'Such a module is usually extracted last, once a platform and experience are already in place. Notice how much this extraction cost compared to geotracking.',
    ]),
    solution: {
      extract: ['orders'],
      ownDb: ['orders'],
      modes: {
        'orders-restaurants': 'api',
        'orders-payments': 'saga',
        'orders-dispatch': 'async',
        'orders-notifications': 'async',
        'reviews-orders': 'api',
        'promo-orders': 'api',
      },
      patterns: ['gateway', 'kafka', 'outbox', 'idempotentConsumer', 'circuitBreakers'],
    },
    solutionSteps: tr([
      'Strangler-фасад, Kafka, Outbox, идемпотентный консьюмер, circuit breaker.',
      'Подготовить: меню — API; оплата — сага; курьер и push — события; Отзывы → Заказы и Промо → Заказы — API.',
      'Вынести Заказы со своей БД.',
    ], [
      'Strangler facade, Kafka, Outbox, idempotent consumer, circuit breaker.',
      'Prepare: menu via API; payment as a saga; courier and push as events; Reviews → Orders and Promo → Orders via API.',
      'Extract Orders with its own DB.',
    ]),
  },
  {
    id: 'reviews',
    title: tr('Отзывы отдельно', 'Reviews on their own'),
    brief: tr([
      'Каталог ресторанов открывают сотни раз в секунду, и каждая карточка считает рейтинг по всем отзывам. Команда контента хочет свои релизы (модерация, фото в отзывах), а партнёры — быструю витрину.',
    ], [
      'The restaurant catalog is opened hundreds of times per second, and every restaurant page computes its rating from all reviews. The content team wants its own releases (moderation, photos in reviews), and partners want a fast storefront.',
    ]),
    budget: 18,
    goals: [
      { text: tr('Отзывы релизятся независимо', 'Reviews are released independently'), check: (m) => m.independent.includes('reviews') },
      { text: tr('Рейтинг не считается по чужой БД на каждый показ', 'The rating is not computed from another module\'s DB on every view'), check: heavyIsolated('restaurants-reviews') },
      { text: tr('Нет сломанных функций и рисков потери данных', 'No broken features and no risk of data loss'), check: noProblems },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns'), check: noExcess },
    ],
    debrief: tr([
      'Рейтинг — классическая проекция: отзывы публикуют события, а у ресторанов хранится готовое среднее, которое обновляется при каждом новом отзыве. Витрине больше не нужен агрегат на каждый показ.',
      'Проверка «был ли заказ» — точечный запрос, для него достаточно API.',
    ], [
      'A rating is a classic projection: reviews publish events, and restaurants store a precomputed average that is updated with every new review. The storefront no longer needs an aggregate on every view.',
      'The "was there an order" check is a point lookup, so an API is enough.',
    ]),
    solution: {
      extract: ['reviews'],
      ownDb: ['reviews'],
      modes: { 'restaurants-reviews': 'replica', 'reviews-orders': 'api' },
      patterns: ['gateway', 'kafka', 'outbox', 'idempotentConsumer'],
    },
    solutionSteps: tr([
      'Strangler-фасад, Kafka, Outbox, идемпотентный консьюмер.',
      'Подготовить: Рестораны → Отзывы — реплика; Отзывы → Заказы — API.',
      'Вынести Отзывы со своей БД.',
    ], [
      'Strangler facade, Kafka, Outbox, idempotent consumer.',
      'Prepare: Restaurants → Reviews as a replica; Reviews → Orders via API.',
      'Extract Reviews with its own DB.',
    ]),
  },
]

const food: Project = {
  id: 'food',
  title: tr('Доставка еды «Ложка»', 'Spoon food delivery'),
  short: tr('Средний уровень: 8 модулей, горячие данные и логистика', 'Intermediate level: 8 modules, hot data and logistics'),
  intro: tr([
    'Сервис доставки вырос за два года из стартапа: один репозиторий, одна база, восемь команд. Пятничный вечер — пик, и любая проблема видна тысячам голодных клиентов.',
  ], [
    'The delivery service grew out of a startup in two years: one repository, one database, eight teams. Friday evening is the peak, and any problem is visible to thousands of hungry customers.',
  ]),
  entry: 'orders',
  entryLabel: tr('оформление заказа', 'checkout'),
  external: tr('Эквайринг', 'Acquiring'),
  modules: foodModules,
  deps: foodDeps,
  missions: foodMissions,
  targets: { latency: 150, availability: 0.996, complexity: 52 },
}

export const PROJECTS: Project[] = [shop, food, bank]
