import type { Dep, Metrics, Mission, ModuleDef, Project } from './model'
import { tr } from '../../i18n'

const noProblems = (m: Metrics) => !m.problems.some((p) => p.severity === 'broken' || p.severity === 'risk')
const allStress = (m: Metrics) => m.stress.every((t) => !t.applies || t.ok)
const noExcess = (m: Metrics) => !m.problems.some((p) => p.severity === 'excess')
const heavyIsolated = (...ids: string[]) => (m: Metrics) => ids.every((id) => !m.heavyLeft.includes(id))
const stressOk = (...ids: string[]) => (m: Metrics) => ids.every((id) => m.stress.find((t) => t.id === id)?.ok)

// ---------------- Уровень 1: интернет-магазин ----------------

const shopModules: ModuleDef[] = [
  { id: 'catalog', title: tr('Каталог', 'Catalog', '商品目录'), icon: '📚', team: tr('Витрина', 'Storefront', '前台'), desc: tr('Товары, цены, поиск', 'Products, prices, search', '商品、价格、搜索'), effort: 2 },
  { id: 'cart', title: tr('Корзина', 'Cart', '购物车'), icon: '🛒', team: tr('Витрина', 'Storefront', '前台'), desc: tr('Корзина покупателя', 'Shopping cart', '顾客的购物车'), effort: 1 },
  { id: 'orders', title: tr('Заказы', 'Orders', '订单'), icon: '📦', team: tr('Заказы', 'Orders', '订单'), desc: tr('Оформление и жизненный цикл заказа', 'Checkout and order lifecycle', '下单与订单生命周期'), effort: 3 },
  { id: 'payments', title: tr('Платежи', 'Payments', '支付'), icon: '💳', team: tr('Финтех', 'Fintech', '金融科技'), desc: tr('Списание денег, возвраты', 'Charges, refunds', '扣款、退款'), effort: 2 },
  { id: 'inventory', title: tr('Склад', 'Inventory', '库存'), icon: '🏬', team: tr('Логистика', 'Logistics', '物流'), desc: tr('Остатки и резервирование товара', 'Stock levels and reservations', '库存数量与预留'), effort: 2 },
  { id: 'notifications', title: tr('Уведомления', 'Notifications', '通知'), icon: '✉️', team: tr('Платформа', 'Platform', '平台'), desc: tr('Email, push, SMS', 'Email, push, SMS', '邮件、推送、短信'), effort: 1 },
  { id: 'users', title: tr('Пользователи', 'Users', '用户'), icon: '👤', team: tr('Платформа', 'Platform', '平台'), desc: tr('Профили, адреса, авторизация', 'Profiles, addresses, auth', '个人资料、地址、认证'), effort: 2 },
  { id: 'reports', title: tr('Отчёты', 'Reports', '报表'), icon: '📊', team: tr('Аналитика', 'Analytics', '数据分析'), desc: tr('Выручка, продажи, остатки', 'Revenue, sales, stock', '营收、销量、库存'), effort: 1 },
]


const shopDeps: Dep[] = [
  {
    id: 'cart-catalog',
    from: 'cart',
    to: 'catalog',
    kind: 'read',
    critical: true,
    label: tr('цены товаров', 'product prices', '商品价格'),
    why: tr('Корзина делает JOIN с таблицей products, чтобы показать актуальные цены.', 'The cart JOINs the products table to show current prices.', '购物车对 products 表做 JOIN，以显示最新价格。'),
  },
  {
    id: 'orders-cart',
    from: 'orders',
    to: 'cart',
    kind: 'call',
    critical: true,
    label: tr('содержимое корзины', 'cart contents', '购物车内容'),
    why: tr('При оформлении заказ забирает позиции из корзины.', 'At checkout the order takes the items from the cart.', '下单时，订单从购物车中取出商品条目。'),
  },
  {
    id: 'orders-users',
    from: 'orders',
    to: 'users',
    kind: 'read',
    critical: true,
    label: tr('адрес доставки', 'delivery address', '收货地址'),
    why: tr('Заказ читает адрес из таблицы users_addresses.', 'The order reads the address from the users_addresses table.', '订单从 users_addresses 表中读取地址。'),
  },
  {
    id: 'orders-payments',
    from: 'orders',
    to: 'payments',
    kind: 'tx',
    critical: true,
    label: tr('запись о платеже', 'payment record', '支付记录'),
    why: tr(
      'Заказ и запись о платеже создаются в одной транзакции БД: либо всё, либо ничего. Само списание у эквайера в транзакцию не входит — это внешний вызов.',
      'The order and the payment record are created in a single DB transaction: all or nothing. The actual charge at the acquirer is not part of it; that is an external call.',
      '订单和支付记录在同一个数据库事务中创建：要么全部成功，要么全部失败。收单机构的实际扣款不在这个事务里，那是一次外部调用。',
    ),
  },
  {
    id: 'orders-inventory',
    from: 'orders',
    to: 'inventory',
    kind: 'tx',
    critical: true,
    label: tr('резерв товара', 'stock reservation', '库存预留'),
    why: tr('В той же транзакции уменьшается остаток на складе.', 'The stock level is decremented in the same transaction.', '库存数量在同一个事务中扣减。'),
  },
  {
    id: 'orders-notifications',
    from: 'orders',
    to: 'notifications',
    kind: 'call',
    critical: false,
    label: tr('письмо «заказ принят»', '"order received" email', '“订单已受理”邮件'),
    why: tr('После оформления отправляется письмо клиенту.', 'After checkout an email is sent to the customer.', '下单后会给顾客发送一封邮件。'),
  },
  {
    id: 'payments-users',
    from: 'payments',
    to: 'users',
    kind: 'read',
    critical: true,
    label: tr('токен сохранённой карты', 'saved card token', '已保存银行卡的 token'),
    why: tr(
      'Платежи берут из профиля токен сохранённой карты. Сами номера карт хранятся только в Платежах (vault): иначе в PCI-контур попали бы и Пользователи.',
      'Payments takes the saved card token from the profile. Card numbers themselves are stored only in Payments (a vault); otherwise Users would fall into PCI scope too.',
      '支付模块从用户资料中获取已保存银行卡的 token。卡号本身只存放在支付模块中（vault）；否则用户模块也会落入 PCI 合规范围。',
    ),
  },
  {
    id: 'catalog-inventory',
    from: 'catalog',
    to: 'inventory',
    kind: 'read',
    critical: false,
    label: tr('остатки на витрине', 'stock on the storefront', '前台显示的库存'),
    why: tr('Страница товара показывает «осталось 3 шт.» через JOIN со stock.', 'The product page shows "only 3 left" via a JOIN with stock.', '商品页通过与 stock 表做 JOIN 来显示“仅剩 3 件”。'),
  },
  {
    id: 'inventory-notifications',
    from: 'inventory',
    to: 'notifications',
    kind: 'call',
    critical: false,
    label: tr('«товар снова в наличии»', '"back in stock"', '“商品已到货”'),
    why: tr('Склад рассылает подписчикам уведомление о поступлении.', 'Inventory notifies subscribers when an item is restocked.', '商品补货后，库存模块会通知订阅者。'),
  },
  {
    id: 'reports-orders',
    from: 'reports',
    to: 'orders',
    kind: 'read',
    critical: false,
    heavy: true,
    label: tr('продажи', 'sales', '销量'),
    why: tr('Ночной отчёт делает тяжёлый JOIN по orders.', 'The nightly report runs a heavy JOIN over orders.', '夜间报表对 orders 表执行繁重的 JOIN。'),
  },
  {
    id: 'reports-payments',
    from: 'reports',
    to: 'payments',
    kind: 'read',
    critical: false,
    heavy: true,
    label: tr('выручка', 'revenue', '营收'),
    why: tr('Отчёт по выручке читает payments.', 'The revenue report reads payments.', '营收报表读取 payments 表。'),
  },
  {
    id: 'reports-catalog',
    from: 'reports',
    to: 'catalog',
    kind: 'read',
    critical: false,
    heavy: true,
    label: tr('категории', 'categories', '分类'),
    why: tr('Отчёт группирует продажи по категориям каталога.', 'The report groups sales by catalog category.', '报表按商品目录的分类汇总销量。'),
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

const RESILIENCE_ONLY = ['rateLimiter', 'containers', 'circuitBreakers', 'bulkhead', 'canary', 'health', 'metrics'] as const

const shopMissions: Mission[] = [
  {
    id: 'full',
    title: tr('Независимые команды', 'Independent teams', '独立的团队'),
    brief: tr([
      'Восемь команд мешают друг другу на каждом релизе. Нужно, чтобы минимум пять из них релизились независимо, а система стала устойчивее, чем была.',
    ], [
      'Eight teams get in each other\'s way on every release. At least five of them need to be released independently, and the system must end up more resilient than before.',
    ], [
      '每次发布，八个团队都互相掣肘。至少要让其中五个团队能够独立发布，同时系统要比原来更有韧性。',
    ]),
    budget: 92,
    goals: [
      { text: tr('Минимум 5 модулей релизятся независимо', 'At least 5 modules released independently', '至少 5 个模块独立发布'), check: (m) => m.independent.length >= 5 },
      { text: tr('Оформление заказа ≤ 150 мс', 'Checkout ≤ 150 ms', '下单 ≤ 150 ms'), check: (m) => m.flowLatency <= 150 },
      { text: tr('Доступность оформления ≥ 99.7%', 'Checkout availability ≥ 99.7%', '下单可用性 ≥ 99.7%'), check: (m) => m.flowAvailability >= 0.997 },
      { text: tr('Нет сломанных функций и рисков потери данных', 'No broken features and no risk of data loss', '没有失效的功能，也没有数据丢失风险'), check: noProblems },
      { text: tr('Сложность эксплуатации ≤ 52', 'Operational complexity ≤ 52', '运维复杂度 ≤ 52'), check: (m) => m.complexity <= 52 },
      { text: tr('Пройдены все стресс-тесты', 'All stress tests passed', '通过所有压力测试'), check: allStress },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns', '没有多余的模式'), check: noExcess },
    ],
    debrief: tr([
      'Вы прошли путь Strangler Fig: фасад перед монолитом, вынос модулей по одному, отдельные БД и замена ACID-транзакций сагами. Чтение чужих таблиц ушло в API и реплики на событиях, а outbox убрал риск потери событий.',
      'Заметьте, что пилить всё не нужно. Каждый сервис добавляет сетевой хоп, точку отказа и строчку в счёте за эксплуатацию. Хороший распил останавливается, когда модули, которым нужна независимость, её получили.',
    ], [
      'You walked the Strangler Fig path: a facade in front of the monolith, extracting modules one at a time, separate databases, and replacing ACID transactions with sagas. Reads of other modules\' tables moved to APIs and event-fed replicas, and the outbox removed the risk of losing events.',
      'Note that you don\'t have to split everything. Every service adds a network hop, a point of failure and a line on the operations bill. A good breakup stops once the modules that need independence have it.',
    ], [
      '你走完了 Strangler Fig（绞杀者模式）的完整路径：在单体前面放一个门面，逐个拆出模块，拆分数据库，用 Saga 取代 ACID 事务。对其他模块表的读取改成了 API 和由事件更新的副本，而 Outbox 消除了丢失事件的风险。',
      '注意，并不需要把所有东西都拆开。每个服务都会增加一次网络跳转、一个故障点，以及运维账单上的一笔开销。好的拆分会在需要独立的模块都获得独立之后及时停下。',
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
    ], [
      '先搭 Strangler 门面，再拆出商品目录、订单、支付、库存和通知，各自配备独立的数据库。',
      '订单 → 支付、订单 → 库存：Saga；通知：事件；订单 → 用户、支付 → 用户：API。',
      '所有非关键读取（报表、前台库存）以及购物车价格：副本（CQRS）。',
      'Kafka + Outbox + 幂等消费者 + Saga 编排器；韧性、可观测性、部署和契约方面按压力测试的提示补充。',
    ]),
  },
  {
    id: 'black-friday',
    title: tr('Чёрная пятница без падений', 'Black Friday without outages', '黑色星期五不宕机'),
    brief: tr([
      'До распродажи месяц. Пилить монолит некогда, но прошлогодний инцидент повторяться не должен: тогда трафик вырос в пять раз, а платёжный провайдер начал отвечать по 30 секунд.',
    ], [
      'The sale is a month away. There is no time to break up the monolith, but last year\'s incident must not happen again: traffic grew fivefold and the payment provider started taking 30 seconds to respond.',
    ], [
      '距离大促还有一个月。拆分单体已经来不及了，但去年的事故绝不能重演：当时流量涨到了五倍，支付服务商的响应时间变成了 30 秒。',
    ]),
    budget: 14,
    goals: [
      { text: tr('Пережить пик нагрузки ×5', 'Survive a ×5 load peak', '扛住 ×5 的负载峰值'), check: stressOk('peak') },
      { text: tr('Пережить зависание внешней системы', 'Survive a hanging external system', '扛住外部系统无响应'), check: stressOk('slow-dep') },
      { text: tr('Релиз с ошибкой не задевает всех клиентов', 'A faulty release does not hit all customers', '有缺陷的发布不会影响所有客户'), check: stressOk('bad-deploy') },
      { text: tr('Доступность оформления ≥ 99.8%', 'Checkout availability ≥ 99.8%', '下单可用性 ≥ 99.8%'), check: (m) => m.flowAvailability >= 0.998 },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns', '没有多余的模式'), check: noExcess },
    ],
    debrief: tr([
      'Микросервисы для этого не понадобились. Устойчивость — свойство платформы и кода, а не числа сервисов: rate limiter, автоскейлинг, таймауты с circuit breaker, bulkhead и аккуратные релизы работают и для монолита.',
      'Распил дал бы здесь только новые сетевые хопы и точки отказа за месяц до пика.',
    ], [
      'Microservices were not needed for this. Resilience is a property of the platform and the code, not of the number of services: a rate limiter, autoscaling, timeouts with a circuit breaker, bulkheads and careful releases work for a monolith too.',
      'Breaking it up here would only have added network hops and points of failure a month before the peak.',
    ], [
      '这件事并不需要微服务。韧性是平台和代码的属性，而不是服务数量的属性：rate limiter（限流器）、自动扩缩容、带 circuit breaker（熔断器）的超时、bulkhead（舱壁隔离）以及谨慎的发布，对单体同样有效。',
      '在这里拆分，只会在峰值前一个月平白增加网络跳转和故障点。',
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
    ], [
      '什么都不拆。',
      'Rate limiter + 带自动扩缩容的容器：应对峰值。',
      'Circuit breaker + bulkhead：应对无响应的服务商。',
      'Canary 发布 + health check：应对有问题的发布。',
    ]),
  },
  {
    id: 'catalog',
    title: tr('Каталог отдельно к сезону', 'Catalog on its own for the season', '旺季前让商品目录独立'),
    brief: tr([
      'Команде витрины нужно выкатывать изменения каталога каждый день в сезон распродаж. Остальное пока трогать не нужно, бюджет маленький.',
    ], [
      'The storefront team needs to ship catalog changes every day during the sales season. Nothing else needs to change yet, and the budget is small.',
    ], [
      '促销季期间，前台团队需要每天上线商品目录的改动。其他部分暂时不用动，预算也很少。',
    ]),
    budget: 14,
    goals: [
      { text: tr('Каталог релизится независимо', 'Catalog is released independently', '商品目录独立发布'), check: (m) => m.independent.includes('catalog') },
      { text: tr('Оформление заказа ≤ 150 мс', 'Checkout ≤ 150 ms', '下单 ≤ 150 ms'), check: (m) => m.flowLatency <= 150 },
      { text: tr('Нет сломанных функций и рисков потери данных', 'No broken features and no risk of data loss', '没有失效的功能，也没有数据丢失风险'), check: noProblems },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns', '没有多余的模式'), check: noExcess },
    ],
    debrief: tr([
      'Самый дешёвый путь — вынести один модуль со своей БД, а все чтения его таблиц перевести на API. Брокер, реплики и саги здесь дороже и не нужны.',
      'Когда сервисов станет больше, синхронные API начнут копить латентность и отказы. Тогда и придёт время событий и реплик. Учтите: тяжёлые отчёты, переведённые на API, продолжают нагружать базу Каталога — просто через его сервис; следующий шаг для них — своя копия данных.',
    ], [
      'The cheapest path is to extract a single module with its own DB and switch all reads of its tables to an API. A broker, replicas and sagas cost more here and are not needed.',
      'As the number of services grows, synchronous APIs will start accumulating latency and failures. That is when events and replicas earn their place. Note that heavy reports switched to an API still load the Catalog database, just through its service; the next step for them is their own copy of the data.',
    ], [
      '最便宜的做法是：只拆出一个模块并配备独立的数据库，把对它的表的所有读取都改成 API。Broker、副本和 Saga 在这里成本更高，也没有必要。',
      '随着服务数量增加，同步 API 会不断累积延迟和故障。到那时，事件和副本才真正派上用场。注意：改成走 API 的重型报表仍然会给商品目录的数据库带来负载，只是改为经过它的服务；对这些报表来说，下一步是拥有自己的数据副本。',
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
    ], [
      'Strangler 门面。',
      '拆出商品目录，并为它配备独立的数据库。',
      '购物车 → 商品目录、商品目录 → 库存、报表 → 商品目录：改用 API，因为数据库分离后，直接 SQL 就会失效。',
    ]),
  },
  {
    id: 'reports',
    title: tr('Ночной отчёт роняет магазин', 'The nightly report takes the store down', '夜间报表拖垮了商城'),
    brief: tr([
      'Аналитики запускают отчёт по выручке в 9 утра — он делает full scan по заказам и платежам, и оформление заказов встаёт на 15 минут. Отчёты должны жить отдельно и не трогать боевую базу.',
    ], [
      'Analysts run the revenue report at 9 a.m. It does a full scan over orders and payments, and checkout stalls for 15 minutes. Reports must live separately and stay off the production database.',
    ], [
      '分析师每天早上 9 点运行营收报表。它会对订单和支付做全表扫描，导致下单卡住 15 分钟。报表必须独立运行，不能碰生产数据库。',
    ]),
    budget: 22,
    goals: [
      { text: tr('Отчёты релизятся независимо', 'Reports are released independently', '报表独立发布'), check: (m) => m.independent.includes('reports') },
      { text: tr('Тяжёлый отчёт в разгар дня не трогает боевую БД', 'A heavy report at peak time does not touch the production DB', '高峰时段的重型报表不访问生产数据库'), check: stressOk('heavy-read') },
      { text: tr('Нет сломанных функций и рисков потери данных', 'No broken features and no risk of data loss', '没有失效的功能，也没有数据丢失风险'), check: noProblems },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns', '没有多余的模式'), check: noExcess },
    ],
    debrief: tr([
      'Это CQRS: у отчётов своя база-проекция, которую наполняют события о заказах, платежах и каталоге. Боевая БД больше не видит тяжёлых запросов.',
      'Монолит сам событий не публикует — здесь удобен CDC (Debezium читает журнал транзакций без правок легаси-кода). Outbox тоже подходит, но требует доработать монолит.',
    ], [
      'This is CQRS: reports have their own projection database, fed by events about orders, payments and the catalog. The production DB no longer sees heavy queries.',
      'The monolith does not publish events itself, so CDC is convenient here (Debezium reads the transaction log without touching legacy code). An outbox works too, but requires changes to the monolith.',
    ], [
      '这就是 CQRS：报表拥有自己的投影数据库，由订单、支付和商品目录的事件来填充。生产数据库再也不会收到重型查询。',
      '单体本身不发布事件，所以这里用 CDC 很方便（Debezium 读取事务日志，无需修改遗留代码）。Outbox 也可以，但需要改造单体。',
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
    ], [
      'Strangler 门面、Kafka、CDC（或 Outbox）以及幂等消费者。',
      '在单体中为报表的三项读取都准备好副本。',
      '拆出报表，并为其配备独立的数据库。',
    ]),
  },
  {
    id: 'emails',
    title: tr('Письма не должны ронять заказы', 'Emails must not break orders', '邮件不能拖垮订单'),
    brief: tr([
      'Почтовый провайдер падает раз в неделю — и вместе с ним падает оформление заказа: письмо «заказ принят» отправляется синхронно. Команда платформы хочет вынести уведомления в отдельный сервис, а бизнес — чтобы заказы не зависели от писем.',
    ], [
      'The email provider goes down once a week, and checkout goes down with it: the "order received" email is sent synchronously. The platform team wants to move notifications into a separate service, and the business wants orders not to depend on emails.',
    ], [
      '邮件服务商每周都会宕机一次，下单也跟着一起挂掉：因为“订单已受理”邮件是同步发送的。平台团队想把通知拆成独立服务，而业务方希望订单不再依赖邮件。',
    ]),
    budget: 14,
    goals: [
      { text: tr('Уведомления релизятся независимо', 'Notifications are released independently', '通知独立发布'), check: (m) => m.independent.includes('notifications') },
      { text: tr('Доступность оформления ≥ 99.8% — падение писем его не задевает', 'Checkout availability ≥ 99.8%: email outages do not affect it', '下单可用性 ≥ 99.8%：邮件故障不影响下单'), check: (m) => m.flowAvailability >= 0.998 },
      { text: tr('Нет сломанных функций и рисков потери данных', 'No broken features and no risk of data loss', '没有失效的功能，也没有数据丢失风险'), check: noProblems },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns', '没有多余的模式'), check: noExcess },
    ],
    debrief: tr([
      'Дешевле всего — circuit breaker: некритичный вызов уведомлений при сбое просто пропускается, и заказ оформляется. Это graceful degradation.',
      'Асинхронные события надёжнее (письмо уйдёт, когда провайдер поднимется), но требуют брокера, outbox и идемпотентности — втрое дороже. Выбор зависит от того, можно ли потерять письмо.',
    ], [
      'The cheapest option is a circuit breaker: on failure, the non-critical notification call is simply skipped and the order goes through. This is graceful degradation.',
      'Asynchronous events are more reliable (the email goes out once the provider is back), but they require a broker, an outbox and idempotency, which costs three times as much. The choice depends on whether losing an email is acceptable.',
    ], [
      '最便宜的方案是 circuit breaker（熔断器）：发生故障时，直接跳过非关键的通知调用，订单照常完成。这就是优雅降级（graceful degradation）。',
      '异步事件更可靠（服务商恢复后邮件照样会发出），但需要 Broker、Outbox 和幂等性，成本是前者的三倍。如何选择，取决于能否接受丢失邮件。',
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
    ], [
      'Strangler 门面和 circuit breaker。',
      '拆出通知，并为其配备独立的数据库。调用仍是同步的，但熔断器能防止邮件故障拖垮订单。',
    ]),
  },
  {
    id: 'pci',
    title: tr('Платежи под PCI DSS', 'Payments under PCI DSS', '符合 PCI DSS 的支付'),
    brief: tr([
      'Аудиторы PCI DSS требуют изолировать платёжный контур: отдельный сервис и БД, шифрованная связь между сервисами, проверка прав пользователя на каждый вызов и полная история операций. Деньги и заказы не должны расходиться.',
    ], [
      'PCI DSS auditors require the payment perimeter to be isolated: a separate service and DB, encrypted service-to-service traffic, user authorization on every call and a full operation history. Money and orders must never get out of sync.',
    ], [
      'PCI DSS 审计方要求隔离支付边界：独立的服务和数据库、服务之间加密通信、每次调用都校验用户权限，并保留完整的操作历史。资金和订单绝不能对不上。',
    ]),
    budget: 26,
    goals: [
      { text: tr('Платежи релизятся независимо', 'Payments are released independently', '支付独立发布'), check: (m) => m.independent.includes('payments') },
      { text: tr('Взлом соседнего сервиса не открывает платежи', 'A compromised neighboring service does not expose payments', '相邻服务被攻破也不会暴露支付'), check: stressOk('security') },
      { text: tr('Есть полная история операций', 'A full operation history is kept', '保留完整的操作历史'), check: stressOk('audit') },
      { text: tr('Оформление заказа ≤ 150 мс', 'Checkout ≤ 150 ms', '下单 ≤ 150 ms'), check: (m) => m.flowLatency <= 150 },
      { text: tr('Нет сломанных функций и рисков потери данных', 'No broken features and no risk of data loss', '没有失效的功能，也没有数据丢失风险'), check: noProblems },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns', '没有多余的模式'), check: noExcess },
    ],
    debrief: tr([
      'Изоляция платёжного контура сужает зону аудита: в scope PCI DSS попадает один сервис, а не весь магазин. Условие — номера карт хранятся только в Платежах, а остальные модули видят лишь токен; отчёты по платежам через API тоже не должны получать номера карт.',
      'Транзакция «заказ + запись о платеже» стала сагой: при отказе списания заказ отменяется компенсирующим событием. mTLS и токены доступа не дают взломанному соседу притвориться клиентом.',
    ], [
      'Isolating the payment perimeter narrows the audit scope: PCI DSS covers one service instead of the whole store. The condition is that card numbers live only in Payments while other modules see just a token; payment reports via the API must not receive card numbers either.',
      'The "order + payment record" transaction became a saga: if the charge fails, the order is cancelled by a compensating event. mTLS and access tokens prevent a compromised neighbor from impersonating a customer.',
    ], [
      '隔离支付边界可以缩小审计范围：PCI DSS 只覆盖一个服务，而不是整个商城。前提是卡号只存放在支付模块中，其他模块只能看到 token；通过 API 获取支付数据的报表也不能拿到卡号。',
      '“订单 + 支付记录”事务变成了 Saga：如果扣款失败，订单会通过补偿事件被取消。mTLS 和访问令牌（access token）能防止被攻破的相邻服务冒充客户。',
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
    ], [
      'Strangler 门面、Kafka、Outbox、幂等消费者。',
      '准备：订单 → 支付改为 Saga；支付 → 用户和报表 → 支付改走 API。',
      '拆出支付，并为其配备独立的数据库。',
      'mTLS、Access token（JWT）和 Audit logging。',
    ]),
  },
]

const shop: Project = {
  id: 'shop',
  title: tr('Интернет-магазин', 'Online store', '网上商城'),
  short: tr('Учебный уровень: 8 модулей, понятный домен', 'Training level: 8 modules, a familiar domain', '入门关卡：8 个模块，熟悉的业务领域'),
  intro: tr([
    'Интернет-магазину 7 лет. Восемь команд коммитят в один репозиторий, релиз раз в две недели, и его согласовывают все.',
  ], [
    'The online store is 7 years old. Eight teams commit to a single repository, releases happen every two weeks, and everyone has to sign off on them.',
  ], [
    '这家网上商城已经运营了 7 年。八个团队向同一个代码仓库提交代码，每两周发布一次，而且每次发布都要所有人点头。',
  ]),
  entry: 'orders',
  entryLabel: tr('оформление заказа', 'checkout', '下单'),
  external: tr('Платёжный провайдер', 'Payment provider', '支付服务商'),
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
  { id: 'accounts', title: tr('Клиенты и счета', 'Customers and accounts', '客户与账户'), icon: '🏦', team: tr('Ядро', 'Core', '核心'), desc: tr('Профиль клиента, счета, карты, тарифы. 200+ таблиц', 'Customer profile, accounts, cards, tariffs. 200+ tables', '客户资料、账户、银行卡、资费。200+ 张表'), effort: 8 },
  { id: 'documents', title: tr('Документы', 'Documents', '单据'), icon: '📄', team: tr('Ядро', 'Core', '核心'), desc: tr('Платёжные документы и их жизненный цикл: черновик → подписан → исполнен', 'Payment documents and their lifecycle: draft → signed → executed', '支付单据及其生命周期：草稿 → 已签署 → 已执行'), effort: 6 },
  { id: 'transfers', title: tr('Переводы', 'Transfers', '转账'), icon: '💸', team: tr('Платежи', 'Payments', '支付'), desc: tr('Перевод по номеру телефона, между своими счетами, на карту', 'Transfers by phone number, between own accounts, to a card', '按手机号转账、本人账户间转账、转账到卡'), effort: 3 },
  { id: 'billpay', title: tr('Оплата услуг', 'Bill payments', '生活缴费'), icon: '🧾', team: tr('Платежи', 'Payments', '支付'), desc: tr('ЖКХ, связь, штрафы, налоги', 'Utilities, mobile, fines, taxes', '水电燃气、话费、罚款、税费'), effort: 3 },
  { id: 'limits', title: tr('Лимиты', 'Limits', '限额'), icon: '🚦', team: tr('Риски', 'Risk', '风控'), desc: tr('Суточные и месячные лимиты на операции', 'Daily and monthly transaction limits', '每日和每月的交易限额'), effort: 2 },
  { id: 'antifraud', title: tr('Антифрод', 'Anti-fraud', '反欺诈'), icon: '🛡️', team: tr('Риски', 'Risk', '风控'), desc: tr('Скоринг операций, блокировка подозрительных', 'Transaction scoring, blocking suspicious ones', '交易评分，拦截可疑交易'), effort: 2 },
  { id: 'confirm', title: tr('Подтверждение', 'Confirmation', '交易确认'), icon: '🔑', team: tr('Безопасность', 'Security', '安全'), desc: tr('SMS/push-коды, электронная подпись', 'SMS/push codes, electronic signature', '短信/推送验证码、电子签名'), effort: 2 },
  { id: 'ledger', title: tr('Шлюз АБС', 'CBS gateway', 'CBS 网关'), icon: '🏛️', team: tr('Интеграции', 'Integrations', '集成'), desc: tr('Проводки и остатки в автоматизированной банковской системе', 'Postings and balances in the core banking system', '核心银行系统中的记账与余额'), effort: 4 },
  { id: 'offers', title: tr('Предложения и сторис', 'Offers and stories', '优惠与动态'), icon: '🎯', team: tr('Маркетинг', 'Marketing', '市场营销'), desc: tr('Персональные предложения, сторис, баннеры', 'Personal offers, stories, banners', '个性化优惠、动态、横幅'), effort: 1 },
  { id: 'audit', title: tr('Аудит', 'Audit', '审计'), icon: '🗂️', team: tr('Комплаенс', 'Compliance', '合规'), desc: tr('Журнал действий, выгрузки для регулятора', 'Activity log, regulatory exports', '操作日志、监管数据导出'), effort: 1 },
]

const bankDeps: Dep[] = [
  {
    id: 'transfers-accounts',
    from: 'transfers',
    to: 'accounts',
    kind: 'read',
    critical: true,
    label: tr('счёт списания', 'debit account', '扣款账户'),
    why: tr('Перевод делает JOIN к таблицам счетов ядра, чтобы найти счёт списания и тариф.', 'The transfer JOINs the core\'s account tables to find the debit account and tariff.', '转账对核心的账户表做 JOIN，以查找扣款账户和资费。'),
  },
  {
    id: 'transfers-documents',
    from: 'transfers',
    to: 'documents',
    kind: 'tx',
    critical: true,
    label: tr('платёжный документ', 'payment document', '支付单据'),
    why: tr('Документ перевода создаётся в той же транзакции, что и сам перевод.', 'The transfer document is created in the same transaction as the transfer itself.', '转账单据与转账本身在同一个事务中创建。'),
  },
  {
    id: 'transfers-limits',
    from: 'transfers',
    to: 'limits',
    kind: 'tx',
    critical: true,
    label: tr('счётчик лимита', 'limit counter', '限额计数器'),
    why: tr(
      'Суточный лимит увеличивается в той же транзакции: иначе два параллельных перевода проскочат лимит. Если превратить это в сагу, первым шагом должно быть атомарное резервирование лимита в Лимитах — у саги нет изоляции.',
      'The daily limit counter is incremented in the same transaction; otherwise two concurrent transfers could slip past the limit. If this becomes a saga, the first step must be an atomic limit reservation in Limits: sagas have no isolation.',
      '每日限额计数器在同一个事务中累加；否则两笔并发转账可能会绕过限额。如果改成 Saga，第一步必须是在限额模块中原子地预占限额：Saga 不具备隔离性。',
    ),
  },
  {
    id: 'transfers-antifraud',
    from: 'transfers',
    to: 'antifraud',
    kind: 'call',
    critical: true,
    label: tr('скоринг операции', 'transaction scoring', '交易评分'),
    why: tr('Перед исполнением перевод синхронно получает оценку риска.', 'Before execution the transfer synchronously gets a risk score.', '执行前，转账会同步获取风险评分。'),
  },
  {
    id: 'transfers-confirm',
    from: 'transfers',
    to: 'confirm',
    kind: 'call',
    critical: true,
    label: tr('код подтверждения', 'confirmation code', '验证码'),
    why: tr('Перевод проверяет SMS-код или подпись клиента.', 'The transfer verifies the customer\'s SMS code or signature.', '转账会校验客户的短信验证码或签名。'),
  },
  {
    id: 'transfers-ledger',
    from: 'transfers',
    to: 'ledger',
    kind: 'call',
    critical: true,
    label: tr('проводка', 'posting', '记账'),
    why: tr('Деньги списываются проводкой в АБС через шлюз.', 'Money is debited by a posting in the CBS via the gateway.', '资金通过网关在 CBS 中记账扣款。'),
  },
  {
    id: 'transfers-audit',
    from: 'transfers',
    to: 'audit',
    kind: 'call',
    critical: false,
    label: tr('запись в журнал', 'log entry', '日志记录'),
    why: tr('Каждая операция пишется в журнал аудита.', 'Every operation is written to the audit log.', '每笔操作都会写入审计日志。'),
  },
  {
    id: 'billpay-documents',
    from: 'billpay',
    to: 'documents',
    kind: 'tx',
    critical: true,
    label: tr('документ оплаты', 'payment document', '支付单据'),
    why: tr('Оплата услуги тоже создаёт платёжный документ в общей транзакции.', 'A bill payment also creates a payment document in the shared transaction.', '生活缴费同样会在共享事务中创建支付单据。'),
  },
  {
    id: 'billpay-ledger',
    from: 'billpay',
    to: 'ledger',
    kind: 'call',
    critical: true,
    label: tr('проводка', 'posting', '记账'),
    why: tr('Оплата проводится через тот же шлюз АБС.', 'The payment is posted through the same CBS gateway.', '缴费通过同一个 CBS 网关记账。'),
  },
  {
    id: 'limits-accounts',
    from: 'limits',
    to: 'accounts',
    kind: 'read',
    critical: true,
    label: tr('тарифный план', 'tariff plan', '资费套餐'),
    why: tr('Размер лимита зависит от тарифа клиента — читается JOIN-ом из таблиц ядра.', 'The limit size depends on the customer\'s tariff, read with a JOIN from the core\'s tables.', '限额大小取决于客户的资费，通过对核心表做 JOIN 读取。'),
  },
  {
    id: 'antifraud-documents',
    from: 'antifraud',
    to: 'documents',
    kind: 'read',
    critical: false,
    heavy: true,
    label: tr('история операций', 'transaction history', '交易历史'),
    why: tr('Скоринг смотрит последние операции клиента прямым запросом к таблице документов.', 'Scoring looks at the customer\'s recent transactions with a direct query on the documents table.', '评分时会直接查询 documents 表，查看客户最近的交易。'),
  },
  {
    id: 'ledger-documents',
    from: 'ledger',
    to: 'documents',
    kind: 'call',
    critical: false,
    label: tr('статус исполнения', 'execution status', '执行状态'),
    why: tr('Когда АБС исполнила проводку, шлюз обновляет статус документа.', 'Once the CBS has executed the posting, the gateway updates the document status.', 'CBS 执行记账后，网关会更新单据状态。'),
  },
  {
    id: 'offers-accounts',
    from: 'offers',
    to: 'accounts',
    kind: 'read',
    critical: false,
    heavy: true,
    label: tr('сегмент клиента', 'customer segment', '客户分群'),
    why: tr('Предложения подбираются по продуктам и сегменту клиента.', 'Offers are selected based on the customer\'s products and segment.', '根据客户持有的产品和所属分群来挑选优惠。'),
  },
  {
    id: 'offers-documents',
    from: 'offers',
    to: 'documents',
    kind: 'read',
    critical: false,
    heavy: true,
    label: tr('последние операции', 'recent transactions', '最近交易'),
    why: tr('«Вы часто платите за связь — подключите автоплатёж»: тяжёлый запрос по документам.', '"You often pay your phone bill, so set up autopay": a heavy query over documents.', '“你经常缴话费，不如设置自动缴费”：这是对单据表的重型查询。'),
  },
  {
    id: 'audit-documents',
    from: 'audit',
    to: 'documents',
    kind: 'read',
    critical: false,
    heavy: true,
    label: tr('выгрузка для регулятора', 'regulatory export', '监管数据导出'),
    why: tr('Ночная выгрузка читает все документы за сутки.', 'The nightly export reads all documents for the day.', '夜间导出会读取当天的所有单据。'),
  },
]

const bankMissions: Mission[] = [
  {
    id: 'payments',
    title: tr('Независимые релизы платежей', 'Independent payment releases', '支付功能独立发布'),
    brief: tr([
      'Платёжная команда хочет выпускать фичи переводов каждую неделю, риски — менять скоринг без общего релиза, маркетинг — не ронять банк тяжёлыми запросами. Деньги не должны теряться ни при каком сбое.',
    ], [
      'The payments team wants to ship transfer features every week, Risk wants to change scoring without a shared release, and Marketing wants to stop bringing the bank down with heavy queries. Money must never be lost, whatever fails.',
    ], [
      '支付团队想每周上线转账新功能，风控团队想在不参与统一发布的情况下调整评分规则，市场营销团队则不想再用重型查询拖垮整个银行。无论哪里出故障，资金都绝不能丢失。',
    ]),
    budget: 91,
    goals: [
      {
        text: tr('Переводы и Антифрод релизятся независимо', 'Transfers and Anti-fraud are released independently', '转账和反欺诈独立发布'),
        check: (m) => m.independent.includes('transfers') && m.independent.includes('antifraud'),
      },
      { text: tr('Всего минимум 5 модулей релизятся независимо', 'At least 5 modules in total released independently', '总共至少 5 个模块独立发布'), check: (m) => m.independent.length >= 5 },
      { text: tr('Перевод ≤ 160 мс', 'Transfer ≤ 160 ms', '转账 ≤ 160 ms'), check: (m) => m.flowLatency <= 160 },
      { text: tr('Доступность переводов ≥ 99.5%', 'Transfer availability ≥ 99.5%', '转账可用性 ≥ 99.5%'), check: (m) => m.flowAvailability >= 0.995 },
      { text: tr('Нет сломанных функций и рисков потери денег', 'No broken features and no risk of losing money', '没有失效的功能，也没有资金损失风险'), check: noProblems },
      { text: tr('Сложность эксплуатации ≤ 52', 'Operational complexity ≤ 52', '运维复杂度 ≤ 52'), check: (m) => m.complexity <= 52 },
      { text: tr('Пройдены все стресс-тесты', 'All stress tests passed', '通过所有压力测试'), check: allStress },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns', '没有多余的模式'), check: noExcess },
    ],
    debrief: tr([
      'В банке нельзя «распилить всё»: каждый синхронный сервис на пути перевода отнимает доступность, а антифрод, подтверждение и проводка обязаны ответить до исполнения. Независимость получают модули, которые можно отвязать событиями и сагами: аудит, предложения, оплата услуг, сами переводы, антифрод.',
      'Ядро (клиенты, счета, документы) обычно уходит последним, а часто остаётся «хорошим монолитом». Чтения из него заменяют API и репликами, а транзакции с документами и лимитами — сагами с компенсациями. У саги нет изоляции, поэтому её первый шаг — атомарное резервирование лимита в Лимитах, иначе два параллельных перевода проскочат лимит. Outbox здесь обязателен: потерянное событие — это потерянные деньги.',
    ], [
      'A bank cannot "split everything": every synchronous service on the transfer path eats into availability, and anti-fraud, confirmation and posting must all respond before execution. Independence goes to the modules that can be decoupled with events and sagas: audit, offers, bill payments, transfers themselves, anti-fraud.',
      'The core (customers, accounts, documents) usually goes last, and often stays a "good monolith". Reads from it are replaced with APIs and replicas, and transactions with documents and limits with compensating sagas. A saga has no isolation, so its first step is an atomic limit reservation in Limits; otherwise two concurrent transfers slip past the limit. An outbox is mandatory here: a lost event means lost money.',
    ], [
      '银行不能“全部拆开”：转账路径上的每一个同步服务都会拉低可用性，而反欺诈、交易确认和记账都必须在执行前给出响应。独立性应该留给能用事件和 Saga 解耦的模块：审计、优惠、生活缴费、转账本身、反欺诈。',
      '核心（客户、账户、单据）通常最后才拆，而且常常保留为一个“好的单体”。对它的读取改为 API 和副本，与单据和限额相关的事务改为带补偿的 Saga。Saga 没有隔离性，所以第一步要在限额模块中原子地预占限额；否则两笔并发转账就会绕过限额。这里 Outbox 必不可少：丢一个事件就意味着丢钱。',
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
    ], [
      '先搭 Strangler 门面，再拆出转账、生活缴费、反欺诈、优惠和审计，各自配备独立的数据库。核心、单据、限额、交易确认和 CBS 网关保持不动。',
      '转账 → 单据、转账 → 限额、生活缴费 → 单据：Saga。转账 → 账户：API。转账 → 审计：事件。',
      '反欺诈、优惠和审计通过副本读取核心数据（CQRS）。',
      'Kafka + Outbox + 幂等消费者 + Saga 编排器；其余按压力测试的提示补充。',
    ]),
  },
  {
    id: 'salary-day',
    title: tr('День зарплаты', 'Payday', '发薪日'),
    brief: tr([
      'В день зарплаты нагрузка вырастает в пять раз, и именно тогда АБС любит отвечать по 30 секунд. В прошлый раз упал весь банк, включая вход в приложение. Распил отложен на следующий год.',
    ], [
      'On payday the load grows fivefold, and that is exactly when the CBS likes to take 30 seconds to respond. Last time the whole bank went down, including app login. Breaking up the monolith is postponed until next year.',
    ], [
      '发薪日负载会涨到五倍，而 CBS 恰恰喜欢在这时候花 30 秒才响应。上一次整个银行都挂了，连 App 登录都不行。拆分单体推迟到明年。',
    ]),
    budget: 14,
    goals: [
      { text: tr('Пережить пик нагрузки ×5', 'Survive a ×5 load peak', '扛住 ×5 的负载峰值'), check: stressOk('peak') },
      { text: tr('Пережить зависание АБС', 'Survive a hanging CBS', '扛住 CBS 无响应'), check: stressOk('slow-dep') },
      { text: tr('Релиз с ошибкой не задевает всех клиентов', 'A faulty release does not hit all customers', '有缺陷的发布不会影响所有客户'), check: stressOk('bad-deploy') },
      { text: tr('Доступность переводов ≥ 99.8%', 'Transfer availability ≥ 99.8%', '转账可用性 ≥ 99.8%'), check: (m) => m.flowAvailability >= 0.998 },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns', '没有多余的模式'), check: noExcess },
    ],
    debrief: tr([
      'Устойчивость не требует распила: rate limiter, автоскейлинг, circuit breaker с bulkhead (у АБС свой пул соединений) и canary-релизы защищают и монолит.',
      'Bulkhead здесь ключевой: зависшая АБС съедает только свой пул, а вход в приложение и просмотр счетов продолжают работать.',
    ], [
      'Resilience does not require a breakup: a rate limiter, autoscaling, a circuit breaker with a bulkhead (the CBS gets its own connection pool) and canary releases protect a monolith too.',
      'The bulkhead is the key here: a hanging CBS exhausts only its own pool, while app login and account views keep working.',
    ], [
      '韧性并不需要拆分：rate limiter、自动扩缩容、circuit breaker 加 bulkhead（CBS 拥有自己的连接池）以及 Canary 发布，同样能保护单体。',
      '这里的关键是 bulkhead：无响应的 CBS 只会耗尽它自己的连接池，App 登录和账户查看仍能正常工作。',
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
    ], [
      '什么都不拆。',
      'Rate limiter + 带自动扩缩容的容器。',
      '为 CBS 配置 Circuit breaker + bulkhead。',
      'Canary 发布 + health check。',
    ]),
  },
  {
    id: 'antifraud',
    title: tr('Антифрод отдельно', 'Anti-fraud on its own', '让反欺诈独立'),
    brief: tr([
      'Мошенники меняют схемы каждую неделю, а правила скоринга выходят раз в месяц вместе с релизом всего банка. Риски просят независимый релиз антифрода. Бюджет минимальный.',
    ], [
      'Fraudsters change their schemes every week, but scoring rules ship once a month with the whole bank\'s release. Risk is asking for an independent anti-fraud release. The budget is minimal.',
    ], [
      '骗子每周都在换花样，可评分规则却要跟着全行的统一发布，一个月才能上线一次。风控团队要求反欺诈能独立发布。预算极少。',
    ]),
    budget: 11,
    goals: [
      { text: tr('Антифрод релизится независимо', 'Anti-fraud is released independently', '反欺诈独立发布'), check: (m) => m.independent.includes('antifraud') },
      { text: tr('Перевод ≤ 160 мс', 'Transfer ≤ 160 ms', '转账 ≤ 160 ms'), check: (m) => m.flowLatency <= 160 },
      { text: tr('Нет сломанных функций и рисков потери денег', 'No broken features and no risk of losing money', '没有失效的功能，也没有资金损失风险'), check: noProblems },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns', '没有多余的模式'), check: noExcess },
    ],
    debrief: tr([
      'Минимальный распил: один сервис, своя БД и чтение истории операций через API ядра. Реплика на событиях была бы лучше для нагрузки, но требует брокера и outbox — это втрое дороже.',
      'Такой «первый сервис» — нормальный старт Strangler Fig: команда учится жить с сетью, а платформа появляется по мере необходимости.',
    ], [
      'A minimal breakup: one service, its own DB, and reading transaction history through the core\'s API. An event-fed replica would be better for load, but it needs a broker and an outbox, which costs three times as much.',
      'Such a "first service" is a normal start for Strangler Fig: the team learns to live with the network, and the platform grows as needed.',
    ], [
      '最小化的拆分：一个服务、一个独立的数据库，通过核心的 API 读取交易历史。从负载角度看，由事件更新的副本会更好，但它需要 Broker 和 Outbox，成本是三倍。',
      '这样的“第一个服务”是 Strangler Fig 的正常起点：团队学会与网络打交道，平台也按需逐步完善。',
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
    ], [
      'Strangler 门面。',
      '拆出反欺诈，并为它配备独立的数据库。',
      '把反欺诈 → 单据改为 API。',
    ]),
  },
  {
    id: 'regulator',
    title: tr('Регулятор: аудит и отчётность', 'Regulator: audit and reporting', '监管：审计与报送'),
    brief: tr([
      'Регулятор требует хранить историю всех операций и выдавать выгрузки по запросу. Сейчас ночная выгрузка и маркетинговые запросы читают основную БД и тормозят переводы.',
    ], [
      'The regulator requires a history of all operations to be kept and exports to be provided on request. Right now the nightly export and marketing queries read the main DB and slow down transfers.',
    ], [
      '监管机构要求保存所有操作的历史，并能按要求提供导出数据。目前，夜间导出和营销查询都直接读取主数据库，拖慢了转账。',
    ]),
    budget: 34,
    goals: [
      { text: tr('Аудит релизится независимо', 'Audit is released independently', '审计独立发布'), check: (m) => m.independent.includes('audit') },
      { text: tr('История изменений для регулятора', 'Change history for the regulator', '为监管机构保留变更历史'), check: stressOk('audit') },
      { text: tr('Тяжёлые чтения не трогают основную БД', 'Heavy reads do not touch the main DB', '重型读取不访问主数据库'), check: stressOk('heavy-read') },
      { text: tr('Нет сломанных функций и рисков потери денег', 'No broken features and no risk of losing money', '没有失效的功能，也没有资金损失风险'), check: noProblems },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns', '没有多余的模式'), check: noExcess },
    ],
    debrief: tr([
      'CQRS в чистом виде: тяжёлые читатели (аудит, предложения, антифрод) получают свои копии данных через события и больше не ходят в основную БД.',
      'Outbox или CDC обязательны: потерянное событие — это дыра в выгрузке для регулятора. CDC удобен именно с легаси: Debezium читает журнал транзакций монолита без правок его кода.',
    ], [
      'CQRS in its purest form: heavy readers (audit, offers, anti-fraud) get their own copies of the data via events and no longer hit the main DB.',
      'An outbox or CDC is mandatory: a lost event is a hole in the regulatory export. CDC is especially handy with legacy code: Debezium reads the monolith\'s transaction log without touching its code.',
    ], [
      '最纯粹的 CQRS：重型读取方（审计、优惠、反欺诈）通过事件获得自己的数据副本，不再访问主数据库。',
      'Outbox 或 CDC 必不可少：丢一个事件，监管导出里就会出现一个缺口。对付遗留代码时 CDC 尤其方便：Debezium 读取单体的事务日志，无需改动其代码。',
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
    ], [
      'Strangler 门面、Kafka、Outbox、幂等消费者、Audit logging 以及链路追踪（tracing），因为已经有三个服务了。',
      '拆出审计、优惠和反欺诈，各自配备独立的数据库。',
      '它们对核心和单据的所有读取：副本（CQRS）。',
    ]),
  },
  {
    id: 'billpay',
    title: tr('Оплата услуг отдельно', 'Bill payments on their own', '让生活缴费独立'),
    brief: tr([
      'Команда «Оплаты услуг» подключает по два новых поставщика в неделю и не может ждать общего релиза. При этом сеть до АБС иногда моргает: клиенты видят ошибки, а при повторе платёж может пройти дважды.',
    ], [
      'The Bill payments team onboards two new billers a week and cannot wait for the shared release. Meanwhile the network to the CBS occasionally flickers: customers see errors, and on retry a payment may go through twice.',
    ], [
      '生活缴费团队每周要接入两家新的收费单位，等不起统一发布。与此同时，通往 CBS 的网络偶尔抖动：客户会看到报错，重试时还可能重复缴费。',
    ]),
    budget: 25,
    goals: [
      { text: tr('Оплата услуг релизится независимо', 'Bill payments are released independently', '生活缴费独立发布'), check: (m) => m.independent.includes('billpay') },
      { text: tr('Кратковременные сбои сети не видны клиенту', 'Brief network glitches are invisible to the customer', '短暂的网络抖动对客户不可见'), check: stressOk('flaky') },
      { text: tr('Повтор запроса не списывает деньги дважды', 'A retried request does not charge twice', '重试的请求不会重复扣款'), check: stressOk('double') },
      { text: tr('Нет сломанных функций и рисков потери денег', 'No broken features and no risk of losing money', '没有失效的功能，也没有资金损失风险'), check: noProblems },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns', '没有多余的模式'), check: noExcess },
    ],
    debrief: tr([
      'Ретраи без идемпотентности — классическая причина двойных списаний: ответ потерялся, клиент повторил, АБС провела платёж второй раз. Idempotency key делает повтор безопасным.',
      'Документ оплаты и сам платёж больше не в одной транзакции — их связывает сага с компенсацией.',
    ], [
      'Retries without idempotency are the classic cause of double charges: the response got lost, the client retried, and the CBS posted the payment a second time. An idempotency key makes retries safe.',
      'The payment document and the payment itself are no longer in one transaction; a compensating saga ties them together.',
    ], [
      '没有幂等性的重试是重复扣款的典型原因：响应丢了，客户端重试，CBS 就又记了一次账。Idempotency key（幂等键）让重试变得安全。',
      '支付单据与缴费本身不再处于同一个事务中，由一个补偿型 Saga 把它们串联起来。',
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
    ], [
      'Strangler 门面、Kafka、Outbox、幂等消费者。',
      '准备生活缴费 → 单据的 Saga。',
      '拆出生活缴费，并为其配备独立的数据库。',
      '为 CBS 记账配置 Retry with backoff 和 Idempotency key。',
    ]),
  },
  {
    id: 'abs-outage',
    title: tr('АБС падает — банк живёт', 'The CBS is down, the bank lives on', 'CBS 宕机，银行照常运转'),
    brief: tr([
      'Когда АБС уходит на регламентные работы или зависает, ложится весь интернет-банк: шлюз АБС живёт в монолите и съедает все потоки. Клиенты должны хотя бы видеть счета и историю, пока проводки недоступны.',
    ], [
      'When the CBS goes into scheduled maintenance or hangs, the entire online bank goes down: the CBS gateway lives inside the monolith and eats all the threads. Customers should at least be able to see their accounts and history while postings are unavailable.',
    ], [
      '每当 CBS 进入计划维护或卡死，整个网上银行就会瘫痪：CBS 网关运行在单体内部，会耗尽所有线程。在无法记账期间，客户至少应该能查看自己的账户和交易历史。',
    ]),
    budget: 16,
    goals: [
      { text: tr('Радиус поражения ≤ 60%', 'Blast radius ≤ 60%', '爆炸半径（故障影响范围）≤ 60%'), check: (m) => m.blastRadius <= 0.6 },
      { text: tr('Зависание АБС не роняет приложение', 'A hanging CBS does not take the app down', 'CBS 无响应不会拖垮 App'), check: stressOk('slow-dep') },
      { text: tr('Нет сломанных функций и рисков потери денег', 'No broken features and no risk of losing money', '没有失效的功能，也没有资金损失风险'), check: noProblems },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns', '没有多余的模式'), check: noExcess },
    ],
    debrief: tr([
      'Интеграцию с внешней системой изолируют в отдельный процесс: его падение задевает только тех, кому он нужен синхронно (переводы, оплата услуг), а не весь банк.',
      'Bulkhead держит под АБС отдельный пул соединений, circuit breaker быстро отвечает «проводки временно недоступны» вместо 30-секундного ожидания.',
    ], [
      'The integration with an external system is isolated in a separate process: its failure affects only those who need it synchronously (transfers, bill payments), not the whole bank.',
      'The bulkhead keeps a dedicated connection pool for the CBS, and the circuit breaker quickly answers "postings temporarily unavailable" instead of waiting 30 seconds.',
    ], [
      '与外部系统的集成被隔离到独立的进程中：它出故障时，只影响需要同步调用它的功能（转账、生活缴费），而不是整个银行。',
      'Bulkhead 为 CBS 保留专用的连接池，而 circuit breaker 会迅速返回“记账暂时不可用”，而不是干等 30 秒。',
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
    ], [
      'Strangler 门面、circuit breaker 和 bulkhead。',
      '把 CBS 网关拆成独立的服务，并配备自己的数据库。',
    ]),
  },
  {
    id: 'marketing',
    title: tr('Маркетинг не мешает платежам', 'Marketing stays out of payments\' way', '营销不再妨碍支付'),
    brief: tr([
      'Маркетинг запускает персональные предложения по всей базе: тяжёлые запросы по счетам и операциям каждый час нагружают ядро. Команде нужны свои релизы, а ядру — покой.',
    ], [
      'Marketing runs personal offers across the entire customer base: heavy hourly queries over accounts and transactions load the core. The team needs its own releases, and the core needs peace and quiet.',
    ], [
      '市场营销团队面向全部客户计算个性化优惠：每小时对账户和交易执行的重型查询给核心带来了负载。团队需要自己的发布节奏，而核心需要清静。',
    ]),
    budget: 18,
    goals: [
      { text: tr('Предложения релизятся независимо', 'Offers are released independently', '优惠独立发布'), check: (m) => m.independent.includes('offers') },
      {
        text: tr('Запросы маркетинга не ходят в БД ядра', 'Marketing queries do not hit the core DB', '营销查询不访问核心数据库'),
        check: heavyIsolated('offers-accounts', 'offers-documents'),
      },
      { text: tr('Нет сломанных функций и рисков потери денег', 'No broken features and no risk of losing money', '没有失效的功能，也没有资金损失风险'), check: noProblems },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns', '没有多余的模式'), check: noExcess },
    ],
    debrief: tr([
      'Через API ядра было бы дешевле, но тяжёлые запросы просто переехали бы с SQL на HTTP — нагрузка на ядро осталась бы той же. Реплика на событиях отдаёт маркетингу собственную копию данных.',
      'Цена — eventual consistency: предложение может опоздать на несколько секунд после операции. Для маркетинга это нормально.',
    ], [
      'Going through the core\'s API would be cheaper, but the heavy queries would simply move from SQL to HTTP and the load on the core would stay the same. An event-fed replica gives marketing its own copy of the data.',
      'The price is eventual consistency: an offer may lag a few seconds behind a transaction. For marketing that is fine.',
    ], [
      '走核心的 API 会更便宜，但重型查询只是从 SQL 换成了 HTTP，核心的负载并不会减少。由事件更新的副本能让营销拥有自己的数据副本。',
      '代价是最终一致性：优惠可能比交易晚几秒。对营销来说，这完全没问题。',
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
    ], [
      'Strangler 门面、Kafka、Outbox、幂等消费者。',
      '准备优惠 → 账户和优惠 → 单据的副本。',
      '拆出优惠，并为其配备独立的数据库。',
    ]),
  },
]

const bank: Project = {
  id: 'bank',
  title: tr('Интернет-банк «Ромашка»', 'Daisy Online Bank', '“雏菊”网上银行'),
  short: tr('Сложный уровень: 10 модулей, тяжёлое ядро, деньги', 'Hard level: 10 modules, a heavy core, money', '困难关卡：10 个模块，庞大的核心，涉及资金'),
  intro: tr([
    'Интернет-банк вырос из одного приложения: ядро с клиентами и счетами, документы, а вокруг десятки модулей, которые зависят от ядра и друг от друга. Одна общая БД, интеграция с АБС синхронная, брокера сообщений нет. Релиз — раз в месяц с ночным окном.',
  ], [
    'The online bank grew out of a single application: a core with customers and accounts, documents, and dozens of modules around them that depend on the core and on each other. One shared DB, synchronous integration with the core banking system (CBS), no message broker. Releases happen once a month in a night window.',
  ], [
    '这家网上银行由一个单体应用发展而来：核心包含客户和账户、单据，周围还有几十个模块，它们既依赖核心，也相互依赖。一个共享数据库，与核心银行系统（CBS）同步集成，没有消息 Broker。每月在夜间窗口发布一次。',
  ]),
  entry: 'transfers',
  entryLabel: tr('перевод по телефону', 'transfer by phone number', '按手机号转账'),
  external: tr('АБС', 'CBS', 'CBS'),
  modules: bankModules,
  deps: bankDeps,
  missions: bankMissions,
  targets: { latency: 160, availability: 0.995, complexity: 52 },
}

// ---------------- Уровень 3: доставка еды ----------------

const foodModules: ModuleDef[] = [
  { id: 'restaurants', title: tr('Рестораны и меню', 'Restaurants and menus', '餐厅与菜单'), icon: '🍽️', team: tr('Партнёры', 'Partners', '商家合作'), desc: tr('Карточки ресторанов, меню, цены, часы работы', 'Restaurant pages, menus, prices, opening hours', '餐厅页面、菜单、价格、营业时间'), effort: 2 },
  { id: 'orders', title: tr('Заказы', 'Orders', '订单'), icon: '🧾', team: tr('Заказы', 'Orders', '订单'), desc: tr('Корзина, оформление, статусы заказа', 'Cart, checkout, order statuses', '购物车、下单、订单状态'), effort: 3 },
  { id: 'dispatch', title: tr('Назначение курьеров', 'Courier dispatch', '骑手调度'), icon: '🧭', team: tr('Логистика', 'Logistics', '物流'), desc: tr('Подбор ближайшего свободного курьера', 'Finding the nearest available courier', '寻找最近的空闲骑手'), effort: 2 },
  { id: 'tracking', title: tr('Геотрекинг', 'Geotracking', '位置追踪'), icon: '📍', team: tr('Логистика', 'Logistics', '物流'), desc: tr('Координаты курьеров: десятки тысяч обновлений в секунду', 'Courier coordinates: tens of thousands of updates per second', '骑手坐标：每秒数万次更新'), effort: 1 },
  { id: 'payments', title: tr('Оплата', 'Payments', '支付'), icon: '💳', team: tr('Финтех', 'Fintech', '金融科技'), desc: tr('Списание, чаевые, возвраты', 'Charges, tips, refunds', '扣款、小费、退款'), effort: 2 },
  { id: 'promo', title: tr('Промокоды', 'Promo codes', '优惠码'), icon: '🏷️', team: tr('Маркетинг', 'Marketing', '市场营销'), desc: tr('Скидки, акции, первый заказ', 'Discounts, campaigns, first order', '折扣、促销活动、首单优惠'), effort: 1 },
  { id: 'reviews', title: tr('Отзывы и рейтинги', 'Reviews and ratings', '评价与评分'), icon: '⭐', team: tr('Контент', 'Content', '内容'), desc: tr('Отзывы, оценки, рейтинг ресторанов', 'Reviews, scores, restaurant ratings', '评价、打分、餐厅评分'), effort: 1 },
  { id: 'notifications', title: tr('Уведомления', 'Notifications', '通知'), icon: '🔔', team: tr('Платформа', 'Platform', '平台'), desc: tr('Push: «курьер в пути», «заказ у двери»', 'Push: "courier on the way", "order at your door"', '推送：“骑手正在路上”“订单已送达门口”'), effort: 1 },
]

const foodDeps: Dep[] = [
  {
    id: 'orders-restaurants',
    from: 'orders',
    to: 'restaurants',
    kind: 'read',
    critical: true,
    label: tr('меню и цены', 'menu and prices', '菜单与价格'),
    why: tr('Заказ JOIN-ит позиции с меню, чтобы проверить цены и наличие.', 'The order JOINs its items with the menu to check prices and availability.', '订单将其中的菜品与菜单做 JOIN，以核对价格和是否有货。'),
  },
  {
    id: 'orders-promo',
    from: 'orders',
    to: 'promo',
    kind: 'call',
    critical: false,
    label: tr('применить промокод', 'apply promo code', '使用优惠码'),
    why: tr('При оформлении проверяется промокод. Если сервис промо недоступен, заказ можно оформить без скидки.', 'The promo code is checked at checkout. If the promo service is unavailable, the order can go through without the discount.', '下单时会校验优惠码。如果优惠码服务不可用，订单可以不打折照常完成。'),
  },
  {
    id: 'orders-payments',
    from: 'orders',
    to: 'payments',
    kind: 'tx',
    critical: true,
    label: tr('запись о платеже', 'payment record', '支付记录'),
    why: tr('Заказ и запись о платеже — в одной транзакции; само списание у эквайера — внешний вызов.', 'The order and the payment record are in a single transaction; the charge at the acquirer is an external call.', '订单和支付记录在同一个事务中；收单机构的扣款是一次外部调用。'),
  },
  {
    id: 'orders-dispatch',
    from: 'orders',
    to: 'dispatch',
    kind: 'call',
    critical: false,
    label: tr('найти курьера', 'find a courier', '寻找骑手'),
    why: tr('После оплаты заказ синхронно просит назначить курьера — и ждёт.', 'After payment the order synchronously asks for a courier to be assigned, and waits.', '支付完成后，订单同步请求分配骑手，并一直等待。'),
  },
  {
    id: 'orders-notifications',
    from: 'orders',
    to: 'notifications',
    kind: 'call',
    critical: false,
    label: tr('push «заказ принят»', '"order received" push', '“订单已受理”推送'),
    why: tr('Клиенту уходит push о принятом заказе.', 'The customer gets a push saying the order was received.', '顾客会收到一条推送，告知订单已受理。'),
  },
  {
    id: 'dispatch-tracking',
    from: 'dispatch',
    to: 'tracking',
    kind: 'read',
    critical: true,
    label: tr('где сейчас курьеры', 'where couriers are now', '骑手当前位置'),
    why: tr('Чтобы найти ближайшего курьера, назначение читает таблицу координат.', 'To find the nearest courier, dispatch reads the coordinates table.', '为了找到最近的骑手，调度模块会读取坐标表。'),
  },
  {
    id: 'dispatch-notifications',
    from: 'dispatch',
    to: 'notifications',
    kind: 'call',
    critical: false,
    label: tr('push «курьер назначен»', '"courier assigned" push', '“已分配骑手”推送'),
    why: tr('Клиент и курьер получают уведомление о назначении.', 'The customer and the courier are notified of the assignment.', '顾客和骑手都会收到分配通知。'),
  },
  {
    id: 'reviews-orders',
    from: 'reviews',
    to: 'orders',
    kind: 'read',
    critical: false,
    label: tr('был ли заказ', 'was there an order', '是否有过订单'),
    why: tr('Отзыв можно оставить только на реальный заказ — проверка через таблицу заказов.', 'A review can only be left for a real order, checked against the orders table.', '只有真实的订单才能评价，这一点通过 orders 表核实。'),
  },
  {
    id: 'restaurants-reviews',
    from: 'restaurants',
    to: 'reviews',
    kind: 'read',
    critical: false,
    heavy: true,
    label: tr('рейтинг в карточке', 'rating on the restaurant page', '餐厅页面上的评分'),
    why: tr('Каждая карточка ресторана считает средний рейтинг агрегатом по всем отзывам.', 'Every restaurant page computes the average rating by aggregating all reviews.', '每个餐厅页面都会汇总所有评价来计算平均评分。'),
  },
  {
    id: 'promo-orders',
    from: 'promo',
    to: 'orders',
    kind: 'read',
    critical: false,
    heavy: true,
    label: tr('история заказов', 'order history', '订单历史'),
    why: tr('«Скидка на десятый заказ»: промо сканирует историю заказов клиента.', '"Discount on your tenth order": promo scans the customer\'s order history.', '“第十单享折扣”：优惠码模块会扫描顾客的订单历史。'),
  },
]

const foodMissions: Mission[] = [
  {
    id: 'tracking',
    title: tr('Геотрекинг съедает базу', 'Geotracking is eating the database', '位置追踪正在吞噬数据库'),
    brief: tr([
      'Курьеры шлют координаты каждые 3 секунды — это 40 тысяч записей в секунду в общую базу. Она задыхается, и тормозит всё: меню, заказы, оплата. Нужно убрать этот поток из общей БД.',
    ], [
      'Couriers send their coordinates every 3 seconds: 40,000 writes per second into the shared database. It is choking, and everything slows down: menus, orders, payments. This stream has to be moved out of the shared DB.',
    ], [
      '骑手每 3 秒上报一次坐标：每秒向共享数据库写入 40,000 次。数据库不堪重负，一切都变慢了：菜单、订单、支付。必须把这股数据流移出共享数据库。',
    ]),
    budget: 8,
    goals: [
      { text: tr('Геотрекинг релизится независимо', 'Geotracking is released independently', '位置追踪独立发布'), check: (m) => m.independent.includes('tracking') },
      { text: tr('Нет сломанных функций и рисков потери данных', 'No broken features and no risk of data loss', '没有失效的功能，也没有数据丢失风险'), check: noProblems },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns', '没有多余的模式'), check: noExcess },
    ],
    debrief: tr([
      'Хороший первый кандидат на вынос — горячий модуль с почти отдельными данными: у геотрекинга одна входящая связь и огромный поток записей, которому в общей БД не место.',
      'Назначение курьеров теперь спрашивает координаты через API. Позже трекинг можно перевести на хранилище, созданное для такого потока (Redis Geo, Cassandra), не трогая монолит.',
    ], [
      'A good first candidate for extraction is a hot module with nearly separate data: geotracking has a single incoming dependency and a huge write stream that does not belong in the shared DB.',
      'Courier dispatch now asks for coordinates via an API. Later, tracking can move to storage built for this kind of stream (Redis Geo, Cassandra) without touching the monolith.',
    ], [
      '第一个拆分的好候选，是数据几乎独立的热点模块：位置追踪只有一个入向依赖，而且有一股巨大的写入流，本就不该放在共享数据库里。',
      '骑手调度现在通过 API 获取坐标。之后，位置追踪可以迁移到专为这类数据流设计的存储（Redis Geo、Cassandra），而无需改动单体。',
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
    ], [
      'Strangler 门面。',
      '准备：骑手调度 → 位置追踪改走 API。',
      '拆出位置追踪，并为其配备独立的数据库。',
    ]),
  },
  {
    id: 'checkout',
    title: tr('Оформление заказа отвечает за всё', 'Checkout is responsible for everything', '下单什么都要管'),
    brief: tr([
      'Команда заказов — самая загруженная: любой релиз ресторанов, промо или логистики требует их согласования, а оформление ждёт назначения курьера. Нужно вынести Заказы — самый связанный модуль — так, чтобы оформление стало быстрее и надёжнее.',
    ], [
      'The orders team is the busiest: every release of restaurants, promo or logistics needs their sign-off, and checkout waits for a courier to be assigned. Orders, the most coupled module, needs to be extracted so that checkout becomes faster and more reliable.',
    ], [
      '订单团队是最忙的：餐厅、优惠码或物流的每次发布都需要他们签字确认，而下单还要等待骑手分配完成。需要把耦合度最高的订单模块拆出来，让下单更快、更可靠。',
    ]),
    budget: 30,
    goals: [
      { text: tr('Заказы релизятся независимо', 'Orders are released independently', '订单独立发布'), check: (m) => m.independent.includes('orders') },
      { text: tr('Оформление заказа ≤ 150 мс', 'Checkout ≤ 150 ms', '下单 ≤ 150 ms'), check: (m) => m.flowLatency <= 150 },
      { text: tr('Доступность оформления ≥ 99.6%', 'Checkout availability ≥ 99.6%', '下单可用性 ≥ 99.6%'), check: (m) => m.flowAvailability >= 0.996 },
      { text: tr('Нет сломанных функций и рисков потери данных', 'No broken features and no risk of data loss', '没有失效的功能，也没有数据丢失风险'), check: noProblems },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns', '没有多余的模式'), check: noExcess },
    ],
    debrief: tr([
      'Самый связанный модуль — самый дорогой распил: каждая из семи связей требует своего решения. Меню — через API, оплата — сага, курьер и push — события (клиенту не нужно ждать курьера, чтобы увидеть «заказ принят»), промокод — синхронно, но за circuit breaker.',
      'Промокоды читают заказы через API — это тяжёлое чтение по-прежнему нагружает базу Заказов; со временем ему нужна своя копия данных. Чаще такой модуль выносят последним, когда вокруг уже есть платформа и опыт. Обратите внимание, во что вынос обошёлся по сравнению с геотрекингом.',
    ], [
      'The most coupled module is the most expensive to extract: each of its seven dependencies needs its own solution. Menu via API, payment as a saga, courier and push as events (the customer should not wait for a courier to see "order received"), promo code synchronously but behind a circuit breaker.',
      'Promo codes read orders via an API, and that heavy read still loads the Orders database; over time it needs its own copy of the data. Such a module is usually extracted last, once a platform and experience are already in place. Notice how much this extraction cost compared to geotracking.',
    ], [
      '耦合度最高的模块拆起来最贵：它的七个依赖都需要各自的解决方案。菜单走 API，支付用 Saga，骑手和推送用事件（顾客不应该等分配到骑手后才看到“订单已受理”），优惠码保持同步调用，但放在 circuit breaker 后面。',
      '优惠码通过 API 读取订单，这项重型读取仍然会给订单数据库带来负载；久而久之，它需要自己的数据副本。这样的模块通常最后才拆，那时平台和经验都已经具备。对比一下，这次拆分的成本比位置追踪高了多少。',
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
    ], [
      'Strangler 门面、Kafka、Outbox、幂等消费者、circuit breaker。',
      '准备：菜单走 API；支付用 Saga；骑手和推送用事件；评价 → 订单和优惠码 → 订单走 API。',
      '拆出订单，并为其配备独立的数据库。',
    ]),
  },
  {
    id: 'reviews',
    title: tr('Отзывы отдельно', 'Reviews on their own', '让评价独立'),
    brief: tr([
      'Каталог ресторанов открывают сотни раз в секунду, и каждая карточка считает рейтинг по всем отзывам. Команда контента хочет свои релизы (модерация, фото в отзывах), а партнёры — быструю витрину.',
    ], [
      'The restaurant catalog is opened hundreds of times per second, and every restaurant page computes its rating from all reviews. The content team wants its own releases (moderation, photos in reviews), and partners want a fast storefront.',
    ], [
      '餐厅列表每秒被打开数百次，而每个餐厅页面都要根据全部评价计算评分。内容团队想要自己的发布节奏（审核、评价配图），合作商家则希望前台页面更快。',
    ]),
    budget: 18,
    goals: [
      { text: tr('Отзывы релизятся независимо', 'Reviews are released independently', '评价独立发布'), check: (m) => m.independent.includes('reviews') },
      { text: tr('Рейтинг не считается по чужой БД на каждый показ', 'The rating is not computed from another module\'s DB on every view', '不再在每次浏览时从其他模块的数据库计算评分'), check: heavyIsolated('restaurants-reviews') },
      { text: tr('Нет сломанных функций и рисков потери данных', 'No broken features and no risk of data loss', '没有失效的功能，也没有数据丢失风险'), check: noProblems },
      { text: tr('Нет лишних паттернов', 'No unnecessary patterns', '没有多余的模式'), check: noExcess },
    ],
    debrief: tr([
      'Рейтинг — классическая проекция: отзывы публикуют события, а у ресторанов хранится готовое среднее, которое обновляется при каждом новом отзыве. Витрине больше не нужен агрегат на каждый показ.',
      'Проверка «был ли заказ» — точечный запрос, для него достаточно API.',
    ], [
      'A rating is a classic projection: reviews publish events, and restaurants store a precomputed average that is updated with every new review. The storefront no longer needs an aggregate on every view.',
      'The "was there an order" check is a point lookup, so an API is enough.',
    ], [
      '评分是典型的投影：评价模块发布事件，餐厅模块保存预先计算好的平均分，每条新评价都会更新它。前台不再需要在每次浏览时做聚合。',
      '“是否有过订单”的检查是单点查询，用 API 就够了。',
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
    ], [
      'Strangler 门面、Kafka、Outbox、幂等消费者。',
      '准备：餐厅 → 评价改为副本；评价 → 订单走 API。',
      '拆出评价，并为其配备独立的数据库。',
    ]),
  },
]

const food: Project = {
  id: 'food',
  title: tr('Доставка еды «Ложка»', 'Spoon food delivery', '“勺子”外卖'),
  short: tr('Средний уровень: 8 модулей, горячие данные и логистика', 'Intermediate level: 8 modules, hot data and logistics', '中级关卡：8 个模块，热点数据与物流'),
  intro: tr([
    'Сервис доставки вырос за два года из стартапа: один репозиторий, одна база, восемь команд. Пятничный вечер — пик, и любая проблема видна тысячам голодных клиентов.',
  ], [
    'The delivery service grew out of a startup in two years: one repository, one database, eight teams. Friday evening is the peak, and any problem is visible to thousands of hungry customers.',
  ], [
    '这家外卖平台用两年时间从初创公司成长起来：一个代码仓库、一个数据库、八个团队。周五晚上是高峰，任何问题都会被成千上万饥肠辘辘的顾客看到。',
  ]),
  entry: 'orders',
  entryLabel: tr('оформление заказа', 'checkout', '下单'),
  external: tr('Эквайринг', 'Acquiring', '收单'),
  modules: foodModules,
  deps: foodDeps,
  missions: foodMissions,
  targets: { latency: 150, availability: 0.996, complexity: 52 },
}

export const PROJECTS: Project[] = [shop, food, bank]
