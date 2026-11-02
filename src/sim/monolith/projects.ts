import type { Dep, Metrics, Mission, ModuleDef, Project } from './model'

const noProblems = (m: Metrics) => !m.problems.some((p) => p.severity === 'broken' || p.severity === 'risk')
const allStress = (m: Metrics) => m.stress.every((t) => !t.applies || t.ok)
const noExcess = (m: Metrics) => !m.problems.some((p) => p.severity === 'excess')
const heavyIsolated = (...ids: string[]) => (m: Metrics) => ids.every((id) => !m.heavyLeft.includes(id))
const stressOk = (...ids: string[]) => (m: Metrics) => ids.every((id) => m.stress.find((t) => t.id === id)?.ok)

// ---------------- Уровень 1: интернет-магазин ----------------

const shopModules: ModuleDef[] = [
  { id: 'catalog', title: 'Каталог', icon: '📚', team: 'Витрина', desc: 'Товары, цены, поиск', effort: 2 },
  { id: 'cart', title: 'Корзина', icon: '🛒', team: 'Витрина', desc: 'Корзина покупателя', effort: 1 },
  { id: 'orders', title: 'Заказы', icon: '📦', team: 'Заказы', desc: 'Оформление и жизненный цикл заказа', effort: 3 },
  { id: 'payments', title: 'Платежи', icon: '💳', team: 'Финтех', desc: 'Списание денег, возвраты', effort: 2 },
  { id: 'inventory', title: 'Склад', icon: '🏬', team: 'Логистика', desc: 'Остатки и резервирование товара', effort: 2 },
  { id: 'notifications', title: 'Уведомления', icon: '✉️', team: 'Платформа', desc: 'Email, push, SMS', effort: 1 },
  { id: 'users', title: 'Пользователи', icon: '👤', team: 'Платформа', desc: 'Профили, адреса, авторизация', effort: 2 },
  { id: 'reports', title: 'Отчёты', icon: '📊', team: 'Аналитика', desc: 'Выручка, продажи, остатки', effort: 1 },
]


const shopDeps: Dep[] = [
  {
    id: 'cart-catalog',
    from: 'cart',
    to: 'catalog',
    kind: 'read',
    critical: true,
    label: 'цены товаров',
    why: 'Корзина делает JOIN с таблицей products, чтобы показать актуальные цены.',
  },
  {
    id: 'orders-cart',
    from: 'orders',
    to: 'cart',
    kind: 'call',
    critical: true,
    label: 'содержимое корзины',
    why: 'При оформлении заказ забирает позиции из корзины.',
  },
  {
    id: 'orders-users',
    from: 'orders',
    to: 'users',
    kind: 'read',
    critical: true,
    label: 'адрес доставки',
    why: 'Заказ читает адрес из таблицы users_addresses.',
  },
  {
    id: 'orders-payments',
    from: 'orders',
    to: 'payments',
    kind: 'tx',
    critical: true,
    label: 'списание денег',
    why: 'Заказ создаётся и деньги списываются в одной транзакции БД: либо всё, либо ничего.',
  },
  {
    id: 'orders-inventory',
    from: 'orders',
    to: 'inventory',
    kind: 'tx',
    critical: true,
    label: 'резерв товара',
    why: 'В той же транзакции уменьшается остаток на складе.',
  },
  {
    id: 'orders-notifications',
    from: 'orders',
    to: 'notifications',
    kind: 'call',
    critical: false,
    label: 'письмо «заказ принят»',
    why: 'После оформления отправляется письмо клиенту.',
  },
  {
    id: 'payments-users',
    from: 'payments',
    to: 'users',
    kind: 'read',
    critical: true,
    label: 'платёжный профиль',
    why: 'Платежи читают сохранённые карты из таблицы users.',
  },
  {
    id: 'catalog-inventory',
    from: 'catalog',
    to: 'inventory',
    kind: 'read',
    critical: false,
    label: 'остатки на витрине',
    why: 'Страница товара показывает «осталось 3 шт.» через JOIN со stock.',
  },
  {
    id: 'inventory-notifications',
    from: 'inventory',
    to: 'notifications',
    kind: 'call',
    critical: false,
    label: '«товар снова в наличии»',
    why: 'Склад рассылает подписчикам уведомление о поступлении.',
  },
  {
    id: 'reports-orders',
    from: 'reports',
    to: 'orders',
    kind: 'read',
    critical: false,
    heavy: true,
    label: 'продажи',
    why: 'Ночной отчёт делает тяжёлый JOIN по orders.',
  },
  {
    id: 'reports-payments',
    from: 'reports',
    to: 'payments',
    kind: 'read',
    critical: false,
    heavy: true,
    label: 'выручка',
    why: 'Отчёт по выручке читает payments.',
  },
  {
    id: 'reports-catalog',
    from: 'reports',
    to: 'catalog',
    kind: 'read',
    critical: false,
    heavy: true,
    label: 'категории',
    why: 'Отчёт группирует продажи по категориям каталога.',
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
    title: 'Независимые команды',
    brief: [
      'Восемь команд мешают друг другу на каждом релизе. Нужно, чтобы минимум пять из них релизились независимо, а система стала устойчивее, чем была.',
    ],
    budget: 92,
    goals: [
      { text: 'Минимум 5 модулей релизятся независимо', check: (m) => m.independent.length >= 5 },
      { text: 'Оформление заказа ≤ 150 мс', check: (m) => m.flowLatency <= 150 },
      { text: 'Доступность оформления ≥ 99.7%', check: (m) => m.flowAvailability >= 0.997 },
      { text: 'Нет сломанных функций и рисков потери данных', check: noProblems },
      { text: 'Сложность эксплуатации ≤ 52', check: (m) => m.complexity <= 52 },
      { text: 'Пройдены все стресс-тесты', check: allStress },
      { text: 'Нет лишних паттернов', check: noExcess },
    ],
    debrief: [
      'Вы прошли путь Strangler Fig: фасад перед монолитом, вынос модулей по одному, отдельные БД и замена ACID-транзакций сагами. Чтение чужих таблиц ушло в API и реплики на событиях, а outbox убрал риск потери событий.',
      'Заметьте, что пилить всё не нужно. Каждый сервис добавляет сетевой хоп, точку отказа и строчку в счёте за эксплуатацию. Хороший распил останавливается, когда модули, которым нужна независимость, её получили.',
    ],
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
    solutionSteps: [
      'Strangler-фасад, затем вынести Каталог, Заказы, Платежи, Склад и Уведомления, каждому своя БД.',
      'Заказы → Платежи и Заказы → Склад: саги; уведомления — события; Заказы → Пользователи и Платежи → Пользователи — API.',
      'Все некритичные чтения (Отчёты, остатки на витрине) и цены в корзине — реплики (CQRS).',
      'Kafka + Outbox + идемпотентный консьюмер + оркестратор саг; устойчивость, наблюдаемость, деплой и контракты — по подсказкам стресс-тестов.',
    ],
  },
  {
    id: 'black-friday',
    title: 'Чёрная пятница без падений',
    brief: [
      'До распродажи месяц. Пилить монолит некогда, но прошлогодний инцидент повторяться не должен: тогда трафик вырос в пять раз, а платёжный провайдер начал отвечать по 30 секунд.',
    ],
    budget: 14,
    goals: [
      { text: 'Пережить пик нагрузки ×5', check: stressOk('peak') },
      { text: 'Пережить зависание внешней системы', check: stressOk('slow-dep') },
      { text: 'Релиз с ошибкой не задевает всех клиентов', check: stressOk('bad-deploy') },
      { text: 'Доступность оформления ≥ 99.8%', check: (m) => m.flowAvailability >= 0.998 },
      { text: 'Нет лишних паттернов', check: noExcess },
    ],
    debrief: [
      'Микросервисы для этого не понадобились. Устойчивость — свойство платформы и кода, а не числа сервисов: rate limiter, автоскейлинг, таймауты с circuit breaker, bulkhead и аккуратные релизы работают и для монолита.',
      'Распил дал бы здесь только новые сетевые хопы и точки отказа за месяц до пика.',
    ],
    solution: { extract: [], ownDb: [], modes: {}, patterns: [...RESILIENCE_ONLY] },
    solutionSteps: [
      'Ничего не выносить.',
      'Rate limiter + контейнеры с автоскейлингом — против пика.',
      'Circuit breaker + bulkhead — против зависшего провайдера.',
      'Canary-релизы + health check — против плохого релиза.',
    ],
  },
  {
    id: 'catalog',
    title: 'Каталог отдельно к сезону',
    brief: [
      'Команде витрины нужно выкатывать изменения каталога каждый день в сезон распродаж. Остальное пока трогать не нужно, бюджет маленький.',
    ],
    budget: 14,
    goals: [
      { text: 'Каталог релизится независимо', check: (m) => m.independent.includes('catalog') },
      { text: 'Оформление заказа ≤ 150 мс', check: (m) => m.flowLatency <= 150 },
      { text: 'Нет сломанных функций и рисков потери данных', check: noProblems },
      { text: 'Нет лишних паттернов', check: noExcess },
    ],
    debrief: [
      'Самый дешёвый путь — вынести один модуль со своей БД, а все чтения его таблиц перевести на API. Брокер, реплики и саги здесь дороже и не нужны.',
      'Когда сервисов станет больше, синхронные API начнут копить латентность и отказы. Тогда и придёт время событий и реплик.',
    ],
    solution: {
      extract: ['catalog'],
      ownDb: ['catalog'],
      modes: { 'cart-catalog': 'api', 'catalog-inventory': 'api', 'reports-catalog': 'api' },
      patterns: ['gateway'],
    },
    solutionSteps: [
      'Strangler-фасад.',
      'Вынести Каталог и выделить ему БД.',
      'Корзина → Каталог, Каталог → Склад, Отчёты → Каталог: перевести на API — прямой SQL после отделения БД сломается.',
    ],
  },
  {
    id: 'reports',
    title: 'Ночной отчёт роняет магазин',
    brief: [
      'Аналитики запускают отчёт по выручке в 9 утра — он делает full scan по заказам и платежам, и оформление заказов встаёт на 15 минут. Отчёты должны жить отдельно и не трогать боевую базу.',
    ],
    budget: 22,
    goals: [
      { text: 'Отчёты релизятся независимо', check: (m) => m.independent.includes('reports') },
      { text: 'Тяжёлый отчёт в разгар дня не трогает боевую БД', check: stressOk('heavy-read') },
      { text: 'Нет сломанных функций и рисков потери данных', check: noProblems },
      { text: 'Нет лишних паттернов', check: noExcess },
    ],
    debrief: [
      'Это CQRS: у отчётов своя база-проекция, которую наполняют события о заказах, платежах и каталоге. Боевая БД больше не видит тяжёлых запросов.',
      'Монолит сам событий не публикует — здесь удобен CDC (Debezium читает журнал транзакций без правок легаси-кода). Outbox тоже подходит, но требует доработать монолит.',
    ],
    solution: {
      extract: ['reports'],
      ownDb: ['reports'],
      modes: { 'reports-orders': 'replica', 'reports-payments': 'replica', 'reports-catalog': 'replica' },
      patterns: ['gateway', 'kafka', 'cdc', 'idempotentConsumer'],
    },
    solutionSteps: [
      'Strangler-фасад, Kafka, CDC (или Outbox) и идемпотентный консьюмер.',
      'Подготовить в монолите реплики для всех трёх чтений Отчётов.',
      'Вынести Отчёты и выделить им БД.',
    ],
  },
  {
    id: 'emails',
    title: 'Письма не должны ронять заказы',
    brief: [
      'Почтовый провайдер падает раз в неделю — и вместе с ним падает оформление заказа: письмо «заказ принят» отправляется синхронно. Команда платформы хочет вынести уведомления в отдельный сервис, а бизнес — чтобы заказы не зависели от писем.',
    ],
    budget: 14,
    goals: [
      { text: 'Уведомления релизятся независимо', check: (m) => m.independent.includes('notifications') },
      { text: 'Доступность оформления ≥ 99.8% — падение писем его не задевает', check: (m) => m.flowAvailability >= 0.998 },
      { text: 'Нет сломанных функций и рисков потери данных', check: noProblems },
      { text: 'Нет лишних паттернов', check: noExcess },
    ],
    debrief: [
      'Дешевле всего — circuit breaker: некритичный вызов уведомлений при сбое просто пропускается, и заказ оформляется. Это graceful degradation.',
      'Асинхронные события надёжнее (письмо уйдёт, когда провайдер поднимется), но требуют брокера, outbox и идемпотентности — втрое дороже. Выбор зависит от того, можно ли потерять письмо.',
    ],
    solution: {
      extract: ['notifications'],
      ownDb: ['notifications'],
      modes: {},
      patterns: ['gateway', 'circuitBreakers'],
    },
    solutionSteps: [
      'Strangler-фасад и circuit breaker.',
      'Вынести Уведомления и выделить им БД. Вызовы остаются синхронными, но breaker не даёт сбою писем уронить заказ.',
    ],
  },
  {
    id: 'pci',
    title: 'Платежи под PCI DSS',
    brief: [
      'Аудиторы PCI DSS требуют изолировать платёжный контур: отдельный сервис и БД, шифрованная связь между сервисами, проверка прав пользователя на каждый вызов и полная история операций. Деньги и заказы не должны расходиться.',
    ],
    budget: 26,
    goals: [
      { text: 'Платежи релизятся независимо', check: (m) => m.independent.includes('payments') },
      { text: 'Взлом соседнего сервиса не открывает платежи', check: stressOk('security') },
      { text: 'Есть полная история операций', check: stressOk('audit') },
      { text: 'Оформление заказа ≤ 150 мс', check: (m) => m.flowLatency <= 150 },
      { text: 'Нет сломанных функций и рисков потери данных', check: noProblems },
      { text: 'Нет лишних паттернов', check: noExcess },
    ],
    debrief: [
      'Изоляция платёжного контура сужает зону аудита: в scope PCI DSS попадает один сервис, а не весь магазин.',
      'Транзакция «заказ + списание» стала сагой: при отказе списания заказ отменяется компенсирующим событием. mTLS и токены доступа не дают взломанному соседу притвориться клиентом.',
    ],
    solution: {
      extract: ['payments'],
      ownDb: ['payments'],
      modes: { 'orders-payments': 'saga', 'payments-users': 'api', 'reports-payments': 'api' },
      patterns: ['gateway', 'kafka', 'outbox', 'idempotentConsumer', 'mtls', 'accessToken', 'auditLog'],
    },
    solutionSteps: [
      'Strangler-фасад, Kafka, Outbox, идемпотентный консьюмер.',
      'Подготовить: Заказы → Платежи — сага; Платежи → Пользователи и Отчёты → Платежи — API.',
      'Вынести Платежи со своей БД.',
      'mTLS, Access token (JWT) и Audit logging.',
    ],
  },
]

const shop: Project = {
  id: 'shop',
  title: 'Интернет-магазин',
  short: 'Учебный уровень: 8 модулей, понятный домен',
  intro: [
    'Интернет-магазину 7 лет. Восемь команд коммитят в один репозиторий, релиз раз в две недели, и его согласовывают все.',
  ],
  entry: 'orders',
  entryLabel: 'оформление заказа',
  external: 'Платёжный провайдер',
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
  { id: 'accounts', title: 'Клиенты и счета', icon: '🏦', team: 'Ядро', desc: 'Профиль клиента, счета, карты, тарифы. 200+ таблиц', effort: 8 },
  { id: 'documents', title: 'Документы', icon: '📄', team: 'Ядро', desc: 'Платёжные документы и их жизненный цикл: черновик → подписан → исполнен', effort: 6 },
  { id: 'transfers', title: 'Переводы', icon: '💸', team: 'Платежи', desc: 'Перевод по номеру телефона, между своими счетами, на карту', effort: 3 },
  { id: 'billpay', title: 'Оплата услуг', icon: '🧾', team: 'Платежи', desc: 'ЖКХ, связь, штрафы, налоги', effort: 3 },
  { id: 'limits', title: 'Лимиты', icon: '🚦', team: 'Риски', desc: 'Суточные и месячные лимиты на операции', effort: 2 },
  { id: 'antifraud', title: 'Антифрод', icon: '🛡️', team: 'Риски', desc: 'Скоринг операций, блокировка подозрительных', effort: 2 },
  { id: 'confirm', title: 'Подтверждение', icon: '🔑', team: 'Безопасность', desc: 'SMS/push-коды, электронная подпись', effort: 2 },
  { id: 'ledger', title: 'Шлюз АБС', icon: '🏛️', team: 'Интеграции', desc: 'Проводки и остатки в автоматизированной банковской системе', effort: 4 },
  { id: 'offers', title: 'Предложения и сторис', icon: '🎯', team: 'Маркетинг', desc: 'Персональные предложения, сторис, баннеры', effort: 1 },
  { id: 'audit', title: 'Аудит', icon: '🗂️', team: 'Комплаенс', desc: 'Журнал действий, выгрузки для регулятора', effort: 1 },
]

const bankDeps: Dep[] = [
  {
    id: 'transfers-accounts',
    from: 'transfers',
    to: 'accounts',
    kind: 'read',
    critical: true,
    label: 'счёт списания',
    why: 'Перевод делает JOIN к таблицам счетов ядра, чтобы найти счёт списания и тариф.',
  },
  {
    id: 'transfers-documents',
    from: 'transfers',
    to: 'documents',
    kind: 'tx',
    critical: true,
    label: 'платёжный документ',
    why: 'Документ перевода создаётся в той же транзакции, что и сам перевод.',
  },
  {
    id: 'transfers-limits',
    from: 'transfers',
    to: 'limits',
    kind: 'tx',
    critical: true,
    label: 'счётчик лимита',
    why: 'Суточный лимит увеличивается в той же транзакции: иначе два параллельных перевода проскочат лимит.',
  },
  {
    id: 'transfers-antifraud',
    from: 'transfers',
    to: 'antifraud',
    kind: 'call',
    critical: true,
    label: 'скоринг операции',
    why: 'Перед исполнением перевод синхронно получает оценку риска.',
  },
  {
    id: 'transfers-confirm',
    from: 'transfers',
    to: 'confirm',
    kind: 'call',
    critical: true,
    label: 'код подтверждения',
    why: 'Перевод проверяет SMS-код или подпись клиента.',
  },
  {
    id: 'transfers-ledger',
    from: 'transfers',
    to: 'ledger',
    kind: 'call',
    critical: true,
    label: 'проводка',
    why: 'Деньги списываются проводкой в АБС через шлюз.',
  },
  {
    id: 'transfers-audit',
    from: 'transfers',
    to: 'audit',
    kind: 'call',
    critical: false,
    label: 'запись в журнал',
    why: 'Каждая операция пишется в журнал аудита.',
  },
  {
    id: 'billpay-documents',
    from: 'billpay',
    to: 'documents',
    kind: 'tx',
    critical: true,
    label: 'документ оплаты',
    why: 'Оплата услуги тоже создаёт платёжный документ в общей транзакции.',
  },
  {
    id: 'billpay-ledger',
    from: 'billpay',
    to: 'ledger',
    kind: 'call',
    critical: true,
    label: 'проводка',
    why: 'Оплата проводится через тот же шлюз АБС.',
  },
  {
    id: 'limits-accounts',
    from: 'limits',
    to: 'accounts',
    kind: 'read',
    critical: true,
    label: 'тарифный план',
    why: 'Размер лимита зависит от тарифа клиента — читается JOIN-ом из таблиц ядра.',
  },
  {
    id: 'antifraud-documents',
    from: 'antifraud',
    to: 'documents',
    kind: 'read',
    critical: false,
    heavy: true,
    label: 'история операций',
    why: 'Скоринг смотрит последние операции клиента прямым запросом к таблице документов.',
  },
  {
    id: 'ledger-documents',
    from: 'ledger',
    to: 'documents',
    kind: 'call',
    critical: false,
    label: 'статус исполнения',
    why: 'Когда АБС исполнила проводку, шлюз обновляет статус документа.',
  },
  {
    id: 'offers-accounts',
    from: 'offers',
    to: 'accounts',
    kind: 'read',
    critical: false,
    heavy: true,
    label: 'сегмент клиента',
    why: 'Предложения подбираются по продуктам и сегменту клиента.',
  },
  {
    id: 'offers-documents',
    from: 'offers',
    to: 'documents',
    kind: 'read',
    critical: false,
    heavy: true,
    label: 'последние операции',
    why: '«Вы часто платите за связь — подключите автоплатёж»: тяжёлый запрос по документам.',
  },
  {
    id: 'audit-documents',
    from: 'audit',
    to: 'documents',
    kind: 'read',
    critical: false,
    heavy: true,
    label: 'выгрузка для регулятора',
    why: 'Ночная выгрузка читает все документы за сутки.',
  },
]

const bankMissions: Mission[] = [
  {
    id: 'payments',
    title: 'Независимые релизы платежей',
    brief: [
      'Платёжная команда хочет выпускать фичи переводов каждую неделю, риски — менять скоринг без общего релиза, маркетинг — не ронять банк тяжёлыми запросами. Деньги не должны теряться ни при каком сбое.',
    ],
    budget: 91,
    goals: [
      {
        text: 'Переводы и Антифрод релизятся независимо',
        check: (m) => m.independent.includes('transfers') && m.independent.includes('antifraud'),
      },
      { text: 'Всего минимум 5 модулей релизятся независимо', check: (m) => m.independent.length >= 5 },
      { text: 'Перевод ≤ 160 мс', check: (m) => m.flowLatency <= 160 },
      { text: 'Доступность переводов ≥ 99.5%', check: (m) => m.flowAvailability >= 0.995 },
      { text: 'Нет сломанных функций и рисков потери денег', check: noProblems },
      { text: 'Сложность эксплуатации ≤ 52', check: (m) => m.complexity <= 52 },
      { text: 'Пройдены все стресс-тесты', check: allStress },
      { text: 'Нет лишних паттернов', check: noExcess },
    ],
    debrief: [
      'В банке нельзя «распилить всё»: каждый синхронный сервис на пути перевода отнимает доступность, а антифрод, подтверждение и проводка обязаны ответить до исполнения. Независимость получают модули, которые можно отвязать событиями и сагами: аудит, предложения, оплата услуг, сами переводы, антифрод.',
      'Ядро (клиенты, счета, документы) обычно уходит последним, а часто остаётся «хорошим монолитом». Чтения из него заменяют API и репликами, а транзакции с документами и лимитами — сагами с компенсациями. Outbox здесь обязателен: потерянное событие — это потерянные деньги.',
    ],
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
    solutionSteps: [
      'Strangler-фасад, затем вынести Переводы, Оплату услуг, Антифрод, Предложения и Аудит со своими БД. Ядро, Документы, Лимиты, Подтверждение и Шлюз АБС оставить.',
      'Переводы → Документы, Переводы → Лимиты, Оплата → Документы: саги. Переводы → Счета: API. Переводы → Аудит: событие.',
      'Антифрод, Предложения и Аудит читают ядро через реплики (CQRS).',
      'Kafka + Outbox + идемпотентный консьюмер + оркестратор саг; остальное — по подсказкам стресс-тестов.',
    ],
  },
  {
    id: 'salary-day',
    title: 'День зарплаты',
    brief: [
      'В день зарплаты нагрузка вырастает в пять раз, и именно тогда АБС любит отвечать по 30 секунд. В прошлый раз упал весь банк, включая вход в приложение. Распил отложен на следующий год.',
    ],
    budget: 14,
    goals: [
      { text: 'Пережить пик нагрузки ×5', check: stressOk('peak') },
      { text: 'Пережить зависание АБС', check: stressOk('slow-dep') },
      { text: 'Релиз с ошибкой не задевает всех клиентов', check: stressOk('bad-deploy') },
      { text: 'Доступность переводов ≥ 99.8%', check: (m) => m.flowAvailability >= 0.998 },
      { text: 'Нет лишних паттернов', check: noExcess },
    ],
    debrief: [
      'Устойчивость не требует распила: rate limiter, автоскейлинг, circuit breaker с bulkhead (у АБС свой пул соединений) и canary-релизы защищают и монолит.',
      'Bulkhead здесь ключевой: зависшая АБС съедает только свой пул, а вход в приложение и просмотр счетов продолжают работать.',
    ],
    solution: { extract: [], ownDb: [], modes: {}, patterns: [...RESILIENCE_ONLY] },
    solutionSteps: [
      'Ничего не выносить.',
      'Rate limiter + контейнеры с автоскейлингом.',
      'Circuit breaker + bulkhead для АБС.',
      'Canary-релизы + health check.',
    ],
  },
  {
    id: 'antifraud',
    title: 'Антифрод отдельно',
    brief: [
      'Мошенники меняют схемы каждую неделю, а правила скоринга выходят раз в месяц вместе с релизом всего банка. Риски просят независимый релиз антифрода. Бюджет минимальный.',
    ],
    budget: 11,
    goals: [
      { text: 'Антифрод релизится независимо', check: (m) => m.independent.includes('antifraud') },
      { text: 'Перевод ≤ 160 мс', check: (m) => m.flowLatency <= 160 },
      { text: 'Нет сломанных функций и рисков потери денег', check: noProblems },
      { text: 'Нет лишних паттернов', check: noExcess },
    ],
    debrief: [
      'Минимальный распил: один сервис, своя БД и чтение истории операций через API ядра. Реплика на событиях была бы лучше для нагрузки, но требует брокера и outbox — это втрое дороже.',
      'Такой «первый сервис» — нормальный старт Strangler Fig: команда учится жить с сетью, а платформа появляется по мере необходимости.',
    ],
    solution: {
      extract: ['antifraud'],
      ownDb: ['antifraud'],
      modes: { 'antifraud-documents': 'api' },
      patterns: ['gateway'],
    },
    solutionSteps: [
      'Strangler-фасад.',
      'Вынести Антифрод и выделить ему БД.',
      'Антифрод → Документы перевести на API.',
    ],
  },
  {
    id: 'regulator',
    title: 'Регулятор: аудит и отчётность',
    brief: [
      'Регулятор требует хранить историю всех операций и выдавать выгрузки по запросу. Сейчас ночная выгрузка и маркетинговые запросы читают основную БД и тормозят переводы.',
    ],
    budget: 34,
    goals: [
      { text: 'Аудит релизится независимо', check: (m) => m.independent.includes('audit') },
      { text: 'История изменений для регулятора', check: stressOk('audit') },
      { text: 'Тяжёлые чтения не трогают основную БД', check: stressOk('heavy-read') },
      { text: 'Нет сломанных функций и рисков потери денег', check: noProblems },
      { text: 'Нет лишних паттернов', check: noExcess },
    ],
    debrief: [
      'CQRS в чистом виде: тяжёлые читатели (аудит, предложения, антифрод) получают свои копии данных через события и больше не ходят в основную БД.',
      'Outbox или CDC обязательны: потерянное событие — это дыра в выгрузке для регулятора. CDC удобен именно с легаси: Debezium читает журнал транзакций монолита без правок его кода.',
    ],
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
    solutionSteps: [
      'Strangler-фасад, Kafka, Outbox, идемпотентный консьюмер, Audit logging и трассировка — сервисов уже три.',
      'Вынести Аудит, Предложения и Антифрод со своими БД.',
      'Все их чтения ядра и документов — реплики (CQRS).',
    ],
  },
  {
    id: 'billpay',
    title: 'Оплата услуг отдельно',
    brief: [
      'Команда «Оплаты услуг» подключает по два новых поставщика в неделю и не может ждать общего релиза. При этом сеть до АБС иногда моргает: клиенты видят ошибки, а при повторе платёж может пройти дважды.',
    ],
    budget: 25,
    goals: [
      { text: 'Оплата услуг релизится независимо', check: (m) => m.independent.includes('billpay') },
      { text: 'Кратковременные сбои сети не видны клиенту', check: stressOk('flaky') },
      { text: 'Повтор запроса не списывает деньги дважды', check: stressOk('double') },
      { text: 'Нет сломанных функций и рисков потери денег', check: noProblems },
      { text: 'Нет лишних паттернов', check: noExcess },
    ],
    debrief: [
      'Ретраи без идемпотентности — классическая причина двойных списаний: ответ потерялся, клиент повторил, АБС провела платёж второй раз. Idempotency key делает повтор безопасным.',
      'Документ оплаты и сам платёж больше не в одной транзакции — их связывает сага с компенсацией.',
    ],
    solution: {
      extract: ['billpay'],
      ownDb: ['billpay'],
      modes: { 'billpay-documents': 'saga' },
      patterns: ['gateway', 'kafka', 'outbox', 'idempotentConsumer', 'retry', 'idempotencyKeys'],
    },
    solutionSteps: [
      'Strangler-фасад, Kafka, Outbox, идемпотентный консьюмер.',
      'Подготовить сагу Оплата → Документы.',
      'Вынести Оплату услуг со своей БД.',
      'Retry с backoff и Idempotency key для проводок в АБС.',
    ],
  },
  {
    id: 'abs-outage',
    title: 'АБС падает — банк живёт',
    brief: [
      'Когда АБС уходит на регламентные работы или зависает, ложится весь интернет-банк: шлюз АБС живёт в монолите и съедает все потоки. Клиенты должны хотя бы видеть счета и историю, пока проводки недоступны.',
    ],
    budget: 16,
    goals: [
      { text: 'Радиус поражения ≤ 60%', check: (m) => m.blastRadius <= 0.6 },
      { text: 'Зависание АБС не роняет приложение', check: stressOk('slow-dep') },
      { text: 'Нет сломанных функций и рисков потери денег', check: noProblems },
      { text: 'Нет лишних паттернов', check: noExcess },
    ],
    debrief: [
      'Интеграцию с внешней системой изолируют в отдельный процесс: его падение задевает только тех, кому он нужен синхронно (переводы, оплата услуг), а не весь банк.',
      'Bulkhead держит под АБС отдельный пул соединений, circuit breaker быстро отвечает «проводки временно недоступны» вместо 30-секундного ожидания.',
    ],
    solution: {
      extract: ['ledger'],
      ownDb: ['ledger'],
      modes: {},
      patterns: ['gateway', 'circuitBreakers', 'bulkhead'],
    },
    solutionSteps: [
      'Strangler-фасад, circuit breaker и bulkhead.',
      'Вынести Шлюз АБС в отдельный сервис со своей БД.',
    ],
  },
  {
    id: 'marketing',
    title: 'Маркетинг не мешает платежам',
    brief: [
      'Маркетинг запускает персональные предложения по всей базе: тяжёлые запросы по счетам и операциям каждый час нагружают ядро. Команде нужны свои релизы, а ядру — покой.',
    ],
    budget: 18,
    goals: [
      { text: 'Предложения релизятся независимо', check: (m) => m.independent.includes('offers') },
      {
        text: 'Запросы маркетинга не ходят в БД ядра',
        check: heavyIsolated('offers-accounts', 'offers-documents'),
      },
      { text: 'Нет сломанных функций и рисков потери денег', check: noProblems },
      { text: 'Нет лишних паттернов', check: noExcess },
    ],
    debrief: [
      'Через API ядра было бы дешевле, но тяжёлые запросы просто переехали бы с SQL на HTTP — нагрузка на ядро осталась бы той же. Реплика на событиях отдаёт маркетингу собственную копию данных.',
      'Цена — eventual consistency: предложение может опоздать на несколько секунд после операции. Для маркетинга это нормально.',
    ],
    solution: {
      extract: ['offers'],
      ownDb: ['offers'],
      modes: { 'offers-accounts': 'replica', 'offers-documents': 'replica' },
      patterns: ['gateway', 'kafka', 'outbox', 'idempotentConsumer'],
    },
    solutionSteps: [
      'Strangler-фасад, Kafka, Outbox, идемпотентный консьюмер.',
      'Подготовить реплики Предложения → Счета и Предложения → Документы.',
      'Вынести Предложения со своей БД.',
    ],
  },
]

const bank: Project = {
  id: 'bank',
  title: 'Интернет-банк «Ромашка»',
  short: 'Сложный уровень: 10 модулей, тяжёлое ядро, деньги',
  intro: [
    'Интернет-банк вырос из одного приложения: ядро с клиентами и счетами, документы, а вокруг десятки модулей, которые зависят от ядра и друг от друга. Одна общая БД, интеграция с АБС синхронная, брокера сообщений нет. Релиз — раз в месяц с ночным окном.',
  ],
  entry: 'transfers',
  entryLabel: 'перевод по телефону',
  external: 'АБС',
  modules: bankModules,
  deps: bankDeps,
  missions: bankMissions,
  targets: { latency: 160, availability: 0.995, complexity: 52 },
}

// ---------------- Уровень 3: доставка еды ----------------

const foodModules: ModuleDef[] = [
  { id: 'restaurants', title: 'Рестораны и меню', icon: '🍽️', team: 'Партнёры', desc: 'Карточки ресторанов, меню, цены, часы работы', effort: 2 },
  { id: 'orders', title: 'Заказы', icon: '🧾', team: 'Заказы', desc: 'Корзина, оформление, статусы заказа', effort: 3 },
  { id: 'dispatch', title: 'Назначение курьеров', icon: '🧭', team: 'Логистика', desc: 'Подбор ближайшего свободного курьера', effort: 2 },
  { id: 'tracking', title: 'Геотрекинг', icon: '📍', team: 'Логистика', desc: 'Координаты курьеров: десятки тысяч обновлений в секунду', effort: 1 },
  { id: 'payments', title: 'Оплата', icon: '💳', team: 'Финтех', desc: 'Списание, чаевые, возвраты', effort: 2 },
  { id: 'promo', title: 'Промокоды', icon: '🏷️', team: 'Маркетинг', desc: 'Скидки, акции, первый заказ', effort: 1 },
  { id: 'reviews', title: 'Отзывы и рейтинги', icon: '⭐', team: 'Контент', desc: 'Отзывы, оценки, рейтинг ресторанов', effort: 1 },
  { id: 'notifications', title: 'Уведомления', icon: '🔔', team: 'Платформа', desc: 'Push: «курьер в пути», «заказ у двери»', effort: 1 },
]

const foodDeps: Dep[] = [
  {
    id: 'orders-restaurants',
    from: 'orders',
    to: 'restaurants',
    kind: 'read',
    critical: true,
    label: 'меню и цены',
    why: 'Заказ JOIN-ит позиции с меню, чтобы проверить цены и наличие.',
  },
  {
    id: 'orders-promo',
    from: 'orders',
    to: 'promo',
    kind: 'call',
    critical: false,
    label: 'применить промокод',
    why: 'При оформлении проверяется промокод. Если сервис промо недоступен, заказ можно оформить без скидки.',
  },
  {
    id: 'orders-payments',
    from: 'orders',
    to: 'payments',
    kind: 'tx',
    critical: true,
    label: 'списание',
    why: 'Заказ и списание денег — в одной транзакции.',
  },
  {
    id: 'orders-dispatch',
    from: 'orders',
    to: 'dispatch',
    kind: 'call',
    critical: false,
    label: 'найти курьера',
    why: 'После оплаты заказ синхронно просит назначить курьера — и ждёт.',
  },
  {
    id: 'orders-notifications',
    from: 'orders',
    to: 'notifications',
    kind: 'call',
    critical: false,
    label: 'push «заказ принят»',
    why: 'Клиенту уходит push о принятом заказе.',
  },
  {
    id: 'dispatch-tracking',
    from: 'dispatch',
    to: 'tracking',
    kind: 'read',
    critical: true,
    label: 'где сейчас курьеры',
    why: 'Чтобы найти ближайшего курьера, назначение читает таблицу координат.',
  },
  {
    id: 'dispatch-notifications',
    from: 'dispatch',
    to: 'notifications',
    kind: 'call',
    critical: false,
    label: 'push «курьер назначен»',
    why: 'Клиент и курьер получают уведомление о назначении.',
  },
  {
    id: 'reviews-orders',
    from: 'reviews',
    to: 'orders',
    kind: 'read',
    critical: false,
    label: 'был ли заказ',
    why: 'Отзыв можно оставить только на реальный заказ — проверка через таблицу заказов.',
  },
  {
    id: 'restaurants-reviews',
    from: 'restaurants',
    to: 'reviews',
    kind: 'read',
    critical: false,
    heavy: true,
    label: 'рейтинг в карточке',
    why: 'Каждая карточка ресторана считает средний рейтинг агрегатом по всем отзывам.',
  },
  {
    id: 'promo-orders',
    from: 'promo',
    to: 'orders',
    kind: 'read',
    critical: false,
    heavy: true,
    label: 'история заказов',
    why: '«Скидка на десятый заказ»: промо сканирует историю заказов клиента.',
  },
]

const foodMissions: Mission[] = [
  {
    id: 'tracking',
    title: 'Геотрекинг съедает базу',
    brief: [
      'Курьеры шлют координаты каждые 3 секунды — это 40 тысяч записей в секунду в общую базу. Она задыхается, и тормозит всё: меню, заказы, оплата. Нужно убрать этот поток из общей БД.',
    ],
    budget: 8,
    goals: [
      { text: 'Геотрекинг релизится независимо', check: (m) => m.independent.includes('tracking') },
      { text: 'Нет сломанных функций и рисков потери данных', check: noProblems },
      { text: 'Нет лишних паттернов', check: noExcess },
    ],
    debrief: [
      'Хороший первый кандидат на вынос — горячий модуль с почти отдельными данными: у геотрекинга одна входящая связь и огромный поток записей, которому в общей БД не место.',
      'Назначение курьеров теперь спрашивает координаты через API. Позже трекинг можно перевести на хранилище, созданное для такого потока (Redis Geo, Cassandra), не трогая монолит.',
    ],
    solution: {
      extract: ['tracking'],
      ownDb: ['tracking'],
      modes: { 'dispatch-tracking': 'api' },
      patterns: ['gateway'],
    },
    solutionSteps: [
      'Strangler-фасад.',
      'Подготовить: Назначение → Геотрекинг через API.',
      'Вынести Геотрекинг со своей БД.',
    ],
  },
  {
    id: 'checkout',
    title: 'Оформление заказа отвечает за всё',
    brief: [
      'Команда заказов — самая загруженная: любой релиз ресторанов, промо или логистики требует их согласования, а оформление ждёт назначения курьера. Нужно вынести Заказы — самый связанный модуль — так, чтобы оформление стало быстрее и надёжнее.',
    ],
    budget: 30,
    goals: [
      { text: 'Заказы релизятся независимо', check: (m) => m.independent.includes('orders') },
      { text: 'Оформление заказа ≤ 150 мс', check: (m) => m.flowLatency <= 150 },
      { text: 'Доступность оформления ≥ 99.6%', check: (m) => m.flowAvailability >= 0.996 },
      { text: 'Нет сломанных функций и рисков потери данных', check: noProblems },
      { text: 'Нет лишних паттернов', check: noExcess },
    ],
    debrief: [
      'Самый связанный модуль — самый дорогой распил: каждая из семи связей требует своего решения. Меню — через API, оплата — сага, курьер и push — события (клиенту не нужно ждать курьера, чтобы увидеть «заказ принят»), промокод — синхронно, но за circuit breaker.',
      'Чаще такой модуль выносят последним, когда вокруг уже есть платформа и опыт. Обратите внимание, во что вынос обошёлся по сравнению с геотрекингом.',
    ],
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
    solutionSteps: [
      'Strangler-фасад, Kafka, Outbox, идемпотентный консьюмер, circuit breaker.',
      'Подготовить: меню — API; оплата — сага; курьер и push — события; Отзывы → Заказы и Промо → Заказы — API.',
      'Вынести Заказы со своей БД.',
    ],
  },
  {
    id: 'reviews',
    title: 'Отзывы отдельно',
    brief: [
      'Каталог ресторанов открывают сотни раз в секунду, и каждая карточка считает рейтинг по всем отзывам. Команда контента хочет свои релизы (модерация, фото в отзывах), а партнёры — быструю витрину.',
    ],
    budget: 18,
    goals: [
      { text: 'Отзывы релизятся независимо', check: (m) => m.independent.includes('reviews') },
      { text: 'Рейтинг не считается по чужой БД на каждый показ', check: heavyIsolated('restaurants-reviews') },
      { text: 'Нет сломанных функций и рисков потери данных', check: noProblems },
      { text: 'Нет лишних паттернов', check: noExcess },
    ],
    debrief: [
      'Рейтинг — классическая проекция: отзывы публикуют события, а у ресторанов хранится готовое среднее, которое обновляется при каждом новом отзыве. Витрине больше не нужен агрегат на каждый показ.',
      'Проверка «был ли заказ» — точечный запрос, для него достаточно API.',
    ],
    solution: {
      extract: ['reviews'],
      ownDb: ['reviews'],
      modes: { 'restaurants-reviews': 'replica', 'reviews-orders': 'api' },
      patterns: ['gateway', 'kafka', 'outbox', 'idempotentConsumer'],
    },
    solutionSteps: [
      'Strangler-фасад, Kafka, Outbox, идемпотентный консьюмер.',
      'Подготовить: Рестораны → Отзывы — реплика; Отзывы → Заказы — API.',
      'Вынести Отзывы со своей БД.',
    ],
  },
]

const food: Project = {
  id: 'food',
  title: 'Доставка еды «Ложка»',
  short: 'Средний уровень: 8 модулей, горячие данные и логистика',
  intro: [
    'Сервис доставки вырос за два года из стартапа: один репозиторий, одна база, восемь команд. Пятничный вечер — пик, и любая проблема видна тысячам голодных клиентов.',
  ],
  entry: 'orders',
  entryLabel: 'оформление заказа',
  external: 'Эквайринг',
  modules: foodModules,
  deps: foodDeps,
  missions: foodMissions,
  targets: { latency: 150, availability: 0.996, complexity: 52 },
}

export const PROJECTS: Project[] = [shop, food, bank]
