import type { BEdge, BNode, Result } from './model'
import { tr } from '../../i18n'

export interface Estimate {
  question: string
  answer: number
  unit: string
  /** Как посчитать — показывается после верного ответа или по подсказке */
  formula: string
}

export interface BuilderChallenge {
  id: string
  title: string
  group: 'Классика' | 'Инструменты' | 'System Design'
  /** Для задач-упражнений: инструмент, без которого задача не решается */
  tool?: BNode['kind']
  /** Абзацы; **жирный** выделяется */
  brief: string[]
  /** Прикидка нагрузки: пока не сделана, нагрузка клиентов скрыта */
  estimate?: Estimate
  nodes: BNode[]
  edges: BEdge[]
  budget: number
  /** Узлы, которые нельзя удалять (исходная система) */
  locked: string[]
  goals: { text: string; check: (r: Result) => boolean }[]
  /** Обязательные пути данных: нельзя «решить» задачу, просто удалив зависимость */
  paths: { from: string; to: string; text: string }[]
  hints: string[]
  debrief: string[]
  /** Доля попаданий — свойство данных задачи, а не настройка: у новых кэшей и CDN она фиксирована */
  hitRatio: { cache?: number; cdn?: number }
  /** Эталонное решение: им проверяется, что задача решаема (npm run check) */
  solution: { nodes: BNode[]; edges: BEdge[] }
}

export const SERVICE_PROFILES = [
  { id: 'fast', title: tr('Обычный: 300 rps, 20 мс', 'Standard: 300 rps, 20 ms'), capacity: 300, latency: 20 },
  { id: 'light', title: tr('Лёгкий stateless: 1000 rps, 5 мс', 'Light stateless: 1000 rps, 5 ms'), capacity: 1000, latency: 5 },
  { id: 'heavy', title: tr('Тяжёлый: 100 rps, 120 мс', 'Heavy: 100 rps, 120 ms'), capacity: 100, latency: 120 },
  { id: 'external', title: tr('Внешний API: 100 rps, 300 мс', 'External API: 100 rps, 300 ms'), capacity: 100, latency: 300 },
]

/** Допуск прикидки: ±25% */
export function estimateOk(e: Estimate, value: number): boolean {
  return Math.abs(value - e.answer) <= e.answer * 0.25
}

export const sandboxStart: { nodes: BNode[]; edges: BEdge[] } = {
  nodes: [
    { id: 'c1', kind: 'client', label: tr('Пользователи', 'Users'), x: 40, y: 220, instances: 1, rps: 1000, workload: 'oltp' },
    { id: 's1', kind: 'service', label: tr('Монолит', 'Monolith'), x: 380, y: 220, instances: 2, capacity: 300, latency: 20 },
    { id: 'd1', kind: 'postgres', label: 'PostgreSQL', x: 760, y: 220, instances: 1 },
  ],
  edges: [
    { id: 'e1', from: 'c1', to: 's1' },
    { id: 'e2', from: 's1', to: 'd1' },
  ],
}

// ---------- помощники ----------

const n = (
  id: string,
  kind: BNode['kind'],
  label: string,
  x: number,
  y: number,
  extra: Partial<BNode> = {},
): BNode => ({ id, kind, label, x, y, instances: 1, ...extra })
const svc = (profile: 'fast' | 'light' | 'heavy' | 'external') => {
  const p = SERVICE_PROFILES.find((x) => x.id === profile)!
  return { capacity: p.capacity, latency: p.latency }
}
const chain = (...ids: string[]): BEdge[] => ids.slice(1).map((to, i) => ({ id: `s-${ids[i]}-${to}`, from: ids[i], to }))
const persisted = (...ids: string[]) => (r: Result) => ids.every((id) => r.persisted[id])
/** Латентность засчитывается, только если запросы клиента реально обслуживаются */
const lat = (id: string, ms: number) => (r: Result) =>
  (r.nodes[id]?.success ?? 0) > 0.5 && (r.nodes[id]?.latency ?? Infinity) <= ms

export const builderChallenges: BuilderChallenge[] = [
  // ---------------- Классика ----------------
  {
    id: 'sale',
    title: tr('Чёрная пятница', 'Black Friday'),
    group: 'Классика',
    brief: [
      tr(
        'Каталог магазина держит 300 rps, а на распродаже ожидается **3000 rps**. PostgreSQL тянет 1000 запросов в секунду на реплику. Бюджет на инфраструктуру — **$1200 в месяц**.',
        'The store catalog handles 300 rps, but the sale is expected to bring **3,000 rps**. PostgreSQL handles 1,000 queries per second per replica. The infrastructure budget is **$1200 per month**.',
      ),
    ],
    nodes: [
      n('c1', 'client', tr('Покупатели', 'Shoppers'), 40, 220, { rps: 3000, workload: 'oltp' }),
      n('s1', 'service', tr('Каталог', 'Catalog'), 380, 220, svc('fast')),
      n('d1', 'postgres', 'PostgreSQL', 760, 220),
    ],
    edges: [
      { id: 'e1', from: 'c1', to: 's1' },
      { id: 'e2', from: 's1', to: 'd1' },
    ],
    budget: 1200,
    locked: ['c1', 's1', 'd1'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.5%', 'Successful responses ≥ 99.5%'), check: (r) => r.clientSuccess >= 0.995 },
      { text: tr('Латентность ≤ 120 мс', 'Latency ≤ 120 ms'), check: lat('c1', 120) },
    ],
    paths: [{ from: 's1', to: 'd1', text: tr('Каталог получает данные из PostgreSQL', 'Catalog reads its data from PostgreSQL') }],
    hints: [
      tr(
        'Сначала посмотрите, какой блок красный. Сервис каталога один и захлёбывается: сколько экземпляров нужно на 3000 rps с запасом? У края мощности латентность растёт нелинейно.',
        'First look at which node is red. The single catalog service is drowning: how many instances do you need for 3,000 rps with headroom? Near full capacity, latency grows non-linearly.',
      ),
      tr(
        'Дальше упрётесь в базу. Добавлять реплики дорого. Заметьте: каталог читают гораздо чаще, чем меняют, и одни и те же товары смотрят тысячи людей.',
        'Next you hit the database. Adding replicas is expensive. Notice: the catalog is read far more often than it changes, and the same products are viewed by thousands of people.',
      ),
      tr(
        'Нужен компонент, который запоминает недавние ответы базы и отдаёт их из памяти, а в базу пропускает только то, чего ещё не видел. Ему место между каталогом и базой.',
        'You need a component that remembers recent database answers and serves them from memory, passing only unseen requests through to the database. It belongs between the catalog and the database.',
      ),
    ],
    debrief: [
      tr(
        'Горизонтальное масштабирование stateless-сервиса — самое дешёвое. Узким местом почти всегда становится состояние, то есть база. Для read-heavy нагрузки кэш дешевле реплик и заодно снижает латентность.',
        'Scaling a stateless service horizontally is the cheapest option. The bottleneck is almost always state, i.e. the database. For read-heavy workloads a cache is cheaper than replicas and lowers latency too.',
      ),
      tr(
        'Обратите внимание на нелинейность: при загрузке 95% латентность в 20 раз выше базовой. Ёмкость планируют с запасом 30–40%.',
        'Note the non-linearity: at 95% utilization latency is 20× the baseline. Capacity is planned with 30–40% headroom.',
      ),
    ],
    hitRatio: { cache: 0.8 },
    solution: {
      nodes: [
        n('c1', 'client', tr('Покупатели', 'Shoppers'), 40, 220, { rps: 3000, workload: 'oltp' }),
        n('s1', 'service', tr('Каталог', 'Catalog'), 380, 220, { ...svc('fast'), instances: 15 }),
        n('k1', 'cache', 'Redis', 580, 120, { hitRatio: 0.8 }),
        n('d1', 'postgres', 'PostgreSQL', 760, 220),
      ],
      edges: [...chain('c1', 's1', 'k1', 'd1')],
    },
  },
  {
    id: 'payments',
    title: tr('Медленный платёжный провайдер', 'Slow Payment Provider'),
    group: 'Классика',
    brief: [
      tr(
        'Заказ оформляется так: сервис заказов синхронно вызывает платёжный шлюз внешнего провайдера, а тот отвечает за 300 мс. Клиенты ждут, конверсия падает. Нужно, чтобы оформление заказа отвечало **быстрее 150 мс**, причём необработанные оплаты не должны копиться. Бюджет — **$1100**.',
        'Checkout works like this: the order service synchronously calls an external provider\'s payment gateway, which takes 300 ms to respond. Customers wait and conversion drops. Checkout must respond **in under 150 ms**, and payments must be processed without a growing backlog. Budget: **$1100**.',
      ),
    ],
    nodes: [
      n('c1', 'client', tr('Покупатели', 'Shoppers'), 30, 220, { rps: 800, workload: 'oltp' }),
      n('g1', 'gateway', 'Gateway', 220, 220),
      n('s1', 'service', tr('Заказы', 'Orders'), 420, 220, { ...svc('fast'), instances: 3 }),
      n('s2', 'service', tr('Платежи', 'Payments'), 820, 220, { ...svc('external'), instances: 8 }),
    ],
    edges: [
      { id: 'e1', from: 'c1', to: 'g1' },
      { id: 'e2', from: 'g1', to: 's1' },
      { id: 'e3', from: 's1', to: 's2' },
    ],
    budget: 1100,
    locked: ['c1', 'g1', 's1', 's2'],
    goals: [
      { text: tr('Успешных ответов ≥ 99%', 'Successful responses ≥ 99%'), check: (r) => r.clientSuccess >= 0.99 },
      { text: tr('Латентность ≤ 150 мс', 'Latency ≤ 150 ms'), check: lat('c1', 150) },
      { text: tr('Необработанные оплаты не копятся', 'Unprocessed payments do not pile up'), check: (r) => r.backlogGrowth < 1 },
    ],
    paths: [{ from: 's1', to: 's2', text: tr('Каждый заказ доходит до Платежей', 'Every order reaches Payments') }],
    hints: [
      tr(
        'Сколько экземпляров платёжного шлюза ни добавляй, 300 мс провайдера никуда не денутся. Значит, покупатель не должен их ждать.',
        'No matter how many payment gateway instances you add, the provider\'s 300 ms won\'t go away. So the shopper must not wait for them.',
      ),
      tr(
        'Нужен посредник, который принимает заявку на оплату мгновенно, надёжно её хранит и отдаёт платежам, когда те готовы её взять.',
        'You need an intermediary that accepts a payment request instantly, stores it durably and hands it to Payments when they are ready to take it.',
      ),
      tr(
        'Разорвите прямую связь Заказы → Платежи и вставьте этого посредника между ними. И проверьте, что платежей хватает на весь поток, иначе необработанные заявки будут копиться.',
        'Break the direct Orders → Payments connection and put that intermediary in between. Then check that Payments can handle the whole stream, or unprocessed requests will pile up.',
      ),
    ],
    debrief: [
      tr(
        'Асинхронная связь через брокер развязывает латентность: клиент получает «заказ принят» сразу, а оплата идёт в фоне. Цена — **eventual consistency**: статус «оплачен» появится позже, и UI должен это уметь показывать.',
        'Asynchronous communication through a broker decouples latency: the client gets "order accepted" immediately while payment runs in the background. The price is **eventual consistency**: the "paid" status shows up later, and the UI must be able to display that.',
      ),
      tr(
        'Очередь не добавляет мощности. Если потребители медленнее потока, бэклог растёт бесконечно. Асинхронность сглаживает пики, но не отменяет capacity planning.',
        'A queue adds no capacity. If consumers are slower than the incoming stream, the backlog grows forever. Asynchrony smooths out peaks but does not replace capacity planning.',
      ),
    ],
    hitRatio: {},
    solution: {
      nodes: [
        n('c1', 'client', tr('Покупатели', 'Shoppers'), 30, 220, { rps: 800, workload: 'oltp' }),
        n('g1', 'gateway', 'Gateway', 220, 220),
        n('s1', 'service', tr('Заказы', 'Orders'), 420, 220, { ...svc('fast'), instances: 4 }),
        n('q1', 'queue', 'Kafka', 620, 120),
        n('s2', 'service', tr('Платежи', 'Payments'), 820, 220, { ...svc('external'), instances: 8 }),
      ],
      edges: [...chain('c1', 'g1', 's1', 'q1', 's2')],
    },
  },

  {
    id: 'catalog-search',
    title: tr('Поиск по каталогу', 'Catalog Search'),
    group: 'Классика',
    brief: tr(
      [
        'Магазин растёт: **3 000 rps** на страницы товаров и **1 500 rps** на поиск. Сейчас поиск — это `LIKE` по таблице товаров в PostgreSQL, и база задыхается.',
        'Страница товара должна открываться быстрее **80 мс**, поиск — быстрее **60 мс**. Бюджет — **$1100 в месяц**. Сервис каталога и базу трогать можно, но не убирать.',
      ],
      [
        'The store is growing: **3,000 rps** to product pages and **1,500 rps** to search. Right now search is a `LIKE` over the products table in PostgreSQL, and the database is choking.',
        'A product page must load in under **80 ms**, search in under **60 ms**. Budget: **$1100 per month**. You may change the catalog service and the database, but not remove them.',
      ],
    ),
    nodes: [
      n('c1', 'client', tr('Страницы товаров', 'Product pages'), 40, 120, { rps: 3000, workload: 'oltp' }),
      n('c2', 'client', tr('Поиск', 'Search'), 40, 360, { rps: 1500, workload: 'search' }),
      n('s1', 'service', tr('Каталог', 'Catalog'), 380, 240, { ...svc('fast'), instances: 4 }),
      n('d1', 'postgres', 'PostgreSQL', 760, 240),
    ],
    edges: [
      { id: 'e1', from: 'c1', to: 's1' },
      { id: 'e2', from: 'c2', to: 's1' },
      { id: 'e3', from: 's1', to: 'd1' },
    ],
    budget: 1100,
    locked: ['c1', 'c2', 's1', 'd1'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Страница товара ≤ 80 мс', 'Product page ≤ 80 ms'), check: lat('c1', 80) },
      { text: tr('Поиск ≤ 60 мс', 'Search ≤ 60 ms'), check: lat('c2', 60) },
      { text: tr('Товары и поиск обслуживаются подходящими хранилищами', 'Products and search are served by suitable storage'), check: persisted('c1', 'c2') },
    ],
    paths: [{ from: 's1', to: 'd1', text: tr('Каталог хранит товары в PostgreSQL', 'Catalog stores products in PostgreSQL') }],
    hints: [
      tr(
        'Откройте свойства PostgreSQL: какую долю запросов он обрабатывает неэффективно? Поиск по тексту — это не то, для чего он создан.',
        'Open PostgreSQL\'s properties: which share of requests does it handle inefficiently? Text search is not what it was built for.',
      ),
      tr(
        'Для поиска нужно хранилище, которое заранее строит индекс «слово → документы» и понимает морфологию и опечатки. Найдите в палитре то, у кого в таблице «подходит для» родной профиль — поиск. Подключите его к каталогу: сервис сам отправит туда поисковые запросы.',
        'Search needs a store that builds a "word → documents" index in advance and understands word forms and typos. Find the palette item whose "good for" table lists search as native. Connect it to the catalog: the service will route search queries there by itself.',
      ),
      tr(
        'Бюджета на реплики не хватит. Популярные товары и запросы повторяются — поставьте рядом с сервисом то, что отвечает из памяти на повторы. И сделайте сервис лёгким.',
        'The budget won\'t cover replicas. Popular products and queries repeat — put something next to the service that answers repeats from memory. And make the service a light one.',
      ),
    ],
    debrief: [
      tr(
        'Polyglot persistence: у каждого типа запросов — своё хранилище. Источник истины — PostgreSQL, а поисковый индекс в Elasticsearch строится из него (обычно через CDC или события) и может отставать на секунды.',
        'Polyglot persistence: each query type gets its own store. PostgreSQL is the source of truth, and the Elasticsearch index is built from it (usually via CDC or events) and may lag by seconds.',
      ),
      tr(
        'Кэш перед обоими хранилищами дешевле, чем реплики: при 80% попаданий в базу и поиск доходит пятая часть запросов.',
        'A cache in front of both stores is cheaper than replicas: with an 80% hit ratio only a fifth of requests reach the database and search.',
      ),
    ],
    hitRatio: { cache: 0.8 },
    solution: {
      nodes: [
        n('c1', 'client', tr('Страницы товаров', 'Product pages'), 40, 120, { rps: 3000, workload: 'oltp' }),
        n('c2', 'client', tr('Поиск', 'Search'), 40, 360, { rps: 1500, workload: 'search' }),
        n('s1', 'service', tr('Каталог', 'Catalog'), 380, 240, { ...svc('light'), instances: 6 }),
        n('k1', 'cache', 'Redis', 600, 60, { hitRatio: 0.8 }),
        n('d1', 'postgres', 'PostgreSQL', 760, 240),
        n('es', 'elastic', 'Elasticsearch', 600, 420),
      ],
      edges: [
        { id: 'e1', from: 'c1', to: 's1' },
        { id: 'e2', from: 'c2', to: 's1' },
        { id: 'e3', from: 's1', to: 'd1' },
        { id: 'a1', from: 's1', to: 'k1' },
        { id: 'a2', from: 's1', to: 'es' },
      ],
    },
  },
  {
    id: 'olap',
    title: tr('Отчёты убивают базу заказов', 'Reports Are Killing the Orders DB'),
    group: 'Классика',
    brief: tr(
      [
        'Сервис заказов обрабатывает **1 500 rps**. Аналитики подключили BI-дашборды к той же базе: всего **40** запросов в секунду, но каждый — агрегат по миллионам строк. С тех пор заказы тормозят и сыпятся ошибками.',
        'Заказы — быстрее **100 мс**, дашборды — быстрее **500 мс**. Бюджет — **$1200**. Вариант «просто добавить реплик» не пройдёт по деньгам.',
      ],
      [
        'The order service handles **1,500 rps**. Analysts connected BI dashboards to the same database: only **40** queries per second, but each is an aggregate over millions of rows. Since then orders have been slow and throwing errors.',
        'Orders must take under **100 ms**, dashboards under **500 ms**. Budget: **$1200**. "Just add replicas" won\'t fit the budget.',
      ],
    ),
    nodes: [
      n('c1', 'client', tr('Заказы', 'Orders'), 40, 120, { rps: 1500, workload: 'oltp' }),
      n('c2', 'client', tr('BI-дашборды', 'BI dashboards'), 40, 380, { rps: 40, workload: 'analytics' }),
      n('s1', 'service', 'Order Service', 380, 240, { ...svc('fast'), instances: 8 }),
      n('d1', 'postgres', 'PostgreSQL', 760, 240, { instances: 2 }),
    ],
    edges: [
      { id: 'e1', from: 'c1', to: 's1' },
      { id: 'e2', from: 'c2', to: 's1' },
      { id: 'e3', from: 's1', to: 'd1' },
    ],
    budget: 1200,
    locked: ['c1', 'c2', 's1', 'd1'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Заказы ≤ 100 мс', 'Orders ≤ 100 ms'), check: lat('c1', 100) },
      { text: tr('Дашборды ≤ 500 мс', 'Dashboards ≤ 500 ms'), check: lat('c2', 500) },
      { text: tr('Данные хранятся в подходящих хранилищах', 'Data is persisted in suitable stores'), check: persisted('c1', 'c2') },
    ],
    paths: [{ from: 's1', to: 'd1', text: tr('Заказы хранятся в PostgreSQL', 'Orders are stored in PostgreSQL') }],
    hints: [
      tr(
        'Всего 40 запросов дашбордов роняют базу, которая держит тысячу заказов в секунду. Откройте её свойства: какой профиль она обрабатывает в двадцать раз хуже родного?',
        'Just 40 dashboard queries bring down a database that handles a thousand orders per second. Open its properties: which workload does it process twenty times worse than its native one?',
      ),
      tr(
        'Агрегат «сумма по региону за год» в строчной базе читает все поля всех строк. Нужна база, которая хранит каждое поле отдельно и сжимает его: тогда запрос читает только нужные столбцы.',
        'A "sum by region for the year" aggregate in a row store reads every field of every row. You need a database that stores each field separately and compresses it: then a query reads only the columns it needs.',
      ),
      tr(
        'Подключите её к сервису заказов рядом с PostgreSQL — сервис сам отправит аналитику туда, где она обрабатывается эффективнее.',
        'Connect it to the order service next to PostgreSQL — the service will route analytics where it is processed most efficiently.',
      ),
    ],
    debrief: [
      tr(
        'Классическое разделение OLTP и OLAP: транзакции живут в PostgreSQL, аналитика — в колоночной базе (ClickHouse, BigQuery, Snowflake). Данные туда доставляют потоком изменений (CDC) или пакетной выгрузкой.',
        'The classic OLTP/OLAP split: transactions live in PostgreSQL, analytics in a columnar database (ClickHouse, BigQuery, Snowflake). Data gets there via a change stream (CDC) or batch exports.',
      ),
      tr(
        'Реплика PostgreSQL для отчётов спасает ненадолго: колоночное хранилище обрабатывает такие запросы на порядки эффективнее, а реплики приходится масштабировать вместе с аналитикой.',
        'A PostgreSQL replica for reports only helps for a while: a columnar store handles such queries orders of magnitude more efficiently, while replicas have to scale along with analytics.',
      ),
    ],
    hitRatio: {},
    solution: {
      nodes: [
        n('c1', 'client', tr('Заказы', 'Orders'), 40, 120, { rps: 1500, workload: 'oltp' }),
        n('c2', 'client', tr('BI-дашборды', 'BI dashboards'), 40, 380, { rps: 40, workload: 'analytics' }),
        n('s1', 'service', 'Order Service', 380, 240, { ...svc('fast'), instances: 8 }),
        n('d1', 'postgres', 'PostgreSQL', 760, 240, { instances: 2 }),
        n('ch', 'clickhouse', 'ClickHouse', 700, 420),
      ],
      edges: [
        { id: 'e1', from: 'c1', to: 's1' },
        { id: 'e2', from: 'c2', to: 's1' },
        { id: 'e3', from: 's1', to: 'd1' },
        { id: 'a1', from: 's1', to: 'ch' },
      ],
    },
  },
  {
    id: 'profiles',
    title: tr('Профили: кэш не спасает', 'Profiles: Cache Is Not Enough'),
    group: 'Классика',
    brief: tr(
      [
        'Сервис профилей отдаёт **6 000 rps**. Данные персональные, поэтому кэш попадает только в **половине** случаев. PostgreSQL держит 1 000 rps на реплику, максимум — 5 реплик.',
        'Профиль должен открываться быстрее **50 мс**. Бюджет — **$1400**.',
      ],
      [
        'The profile service serves **6,000 rps**. The data is personal, so the cache hits only **half** the time. PostgreSQL handles 1,000 rps per replica, with a maximum of 5 replicas.',
        'A profile must load in under **50 ms**. Budget: **$1400**.',
      ],
    ),
    nodes: [
      n('c1', 'client', tr('Профили', 'Profiles'), 40, 240, { rps: 6000, workload: 'oltp' }),
      n('s1', 'service', 'Profile API', 380, 240, svc('fast')),
      n('d1', 'postgres', 'PostgreSQL', 760, 240),
    ],
    edges: [
      { id: 'e1', from: 'c1', to: 's1' },
      { id: 'e2', from: 's1', to: 'd1' },
    ],
    budget: 1400,
    locked: ['c1', 's1', 'd1'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Профиль ≤ 50 мс', 'Profile ≤ 50 ms'), check: lat('c1', 50) },
    ],
    paths: [{ from: 's1', to: 'd1', text: tr('Профили хранятся в PostgreSQL', 'Profiles are stored in PostgreSQL') }],
    hints: [
      tr(
        '6 000 rps против базы с потолком 5 × 1 000 — одними репликами не справиться при любом бюджете.',
        '6,000 rps against a database capped at 5 × 1,000 — replicas alone cannot cope at any budget.',
      ),
      tr(
        'Половина запросов повторяется. Что-то должно отвечать на них из памяти, не доходя до базы. Тогда базе останется 3 000 rps — сколько реплик нужно, чтобы загрузка была комфортной?',
        'Half of the requests repeat. Something has to answer them from memory without reaching the database. That leaves 3,000 rps for the database — how many replicas keep utilization comfortable?',
      ),
      tr(
        'Сервис тоже должен выдерживать 6 000 rps без перегрева — посмотрите на его профили.',
        'The service must also sustain 6,000 rps without overheating — look at its profiles.',
      ),
    ],
    debrief: [
      tr(
        'Кэш и реплики не взаимозаменяемы, а дополняют друг друга. Кэш снимает повторяющиеся чтения, реплики масштабируют то, что кэш не закрывает. При низкой доле попаданий нужны оба.',
        'Caches and replicas are not interchangeable; they complement each other. The cache absorbs repeated reads, replicas scale whatever the cache doesn\'t cover. With a low hit ratio you need both.',
      ),
      tr(
        'Проверьте и обратную ошибку: пять реплик без кэша дороже и всё равно не справятся с 6 000 rps.',
        'Check the opposite mistake too: five replicas without a cache cost more and still can\'t handle 6,000 rps.',
      ),
    ],
    hitRatio: { cache: 0.5 },
    solution: {
      nodes: [
        n('c1', 'client', tr('Профили', 'Profiles'), 40, 240, { rps: 6000, workload: 'oltp' }),
        n('s1', 'service', 'Profile API', 380, 240, { ...svc('light'), instances: 8 }),
        n('k1', 'cache', 'Redis', 600, 80, { hitRatio: 0.5 }),
        n('d1', 'postgres', 'PostgreSQL', 760, 240, { instances: 4 }),
      ],
      edges: [
        { id: 'e1', from: 'c1', to: 's1' },
        { id: 'e2', from: 's1', to: 'd1' },
        { id: 'a1', from: 's1', to: 'k1' },
      ],
    },
  },
  {
    id: 'tickets',
    title: tr('Продажа билетов на концерт', 'Concert Ticket Sales'),
    group: 'Классика',
    brief: tr(
      [
        'Старт продаж на концерт: в первые минуты приходит **8 000** бронирований в секунду. Бронирование — транзакция (нельзя продать одно место дважды), а PostgreSQL даже на пяти репликах держит не больше 5 000 rps.',
        'Пик длится около пяти минут. Покупатель должен быстрее **100 мс** получить ответ «заявка принята», ни одна заявка не теряется, а необработанных заявок копится не больше **4 000** заявок в секунду (за пик — около миллиона, потом разберётся). Бюджет — **$2900**.',
      ],
      [
        'Concert tickets go on sale: in the first minutes **8,000** bookings arrive per second. A booking is a transaction (the same seat can\'t be sold twice), and PostgreSQL handles at most 5,000 rps even with five replicas.',
        'The peak lasts about five minutes. A buyer must get a "request accepted" response in under **100 ms**, no request may be lost, and unprocessed requests must pile up no faster than **4,000** requests per second (about a million over the peak, drained afterwards). Budget: **$2900**.',
      ],
    ),
    nodes: [
      n('c1', 'client', tr('Бронирование', 'Bookings'), 30, 240, { rps: 8000, workload: 'oltp' }),
      n('g1', 'gateway', 'Gateway', 220, 240),
      n('s1', 'service', 'Booking API', 420, 240, { ...svc('fast'), instances: 4 }),
      n('d1', 'postgres', 'PostgreSQL', 820, 240),
    ],
    edges: [
      { id: 'e1', from: 'c1', to: 'g1' },
      { id: 'e2', from: 'g1', to: 's1' },
      { id: 'e3', from: 's1', to: 'd1' },
    ],
    budget: 2900,
    locked: ['c1', 'g1', 's1', 'd1'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Ответ «заявка принята» ≤ 100 мс', '"Request accepted" response ≤ 100 ms'), check: lat('c1', 100) },
      { text: tr('Необработанные заявки копятся не быстрее 4 000 в секунду', 'Unprocessed requests pile up no faster than 4,000 requests/s'), check: (r) => r.backlogGrowth <= 4000 },
      {
        text: tr(
          'PostgreSQL загружен не больше чем на 90% — воркеры не пишут быстрее, чем база принимает',
          'PostgreSQL utilization ≤ 90% — workers don\'t write faster than the database can accept',
        ),
        check: (r) => (r.nodes['d1']?.util ?? Infinity) <= 0.9,
      },
      { text: tr('Бронирования сохраняются в БД', 'Bookings are persisted in the DB'), check: persisted('c1') },
    ],
    paths: [{ from: 's1', to: 'd1', text: tr('Бронирования доходят до PostgreSQL', 'Bookings reach PostgreSQL') }],
    hints: [
      tr(
        '8 000 транзакций в секунду синхронно база не примет ни при каком числе реплик. Значит, покупатель не должен ждать базу.',
        'The database cannot accept 8,000 synchronous transactions per second with any number of replicas. So the buyer must not wait for the database.',
      ),
      tr(
        'Нужно место, куда API мгновенно кладёт заявку и сразу отвечает «заявка принята», а отдельные обработчики забирают заявки с той скоростью, которую выдерживает база.',
        'You need a place where the API drops a request instantly and immediately replies "request accepted", while separate workers pick requests up at the rate the database can sustain.',
      ),
      tr(
        'Обработчиков должно быть ровно столько, чтобы база не перегревалась (до 85% загрузки). Тогда заявки копятся на разницу между пиком и этой скоростью — проверьте, что это укладывается в цель.',
        'Run just enough workers to keep the database below 85% utilization. Requests then accumulate by the difference between the peak and that rate — check that it fits the goal.',
      ),
    ],
    debrief: [
      tr(
        'Queue-based load leveling: очередь принимает пик сразу, а обработка идёт с постоянной скоростью, которую выдерживает самое узкое место. Клиент получает «заявка принята», а результат — уведомлением.',
        'Queue-based load leveling: the queue absorbs the peak immediately, while processing runs at a steady rate the narrowest bottleneck can sustain. The client gets "request accepted" and the result arrives as a notification.',
      ),
      tr(
        'Важно не дать воркерам перегрузить базу: их число ограничивают её пропускной способностью. На интервью добавляют виртуальную очередь ожидания на входе (waiting room) и резервирование мест с таймаутом.',
        'It\'s important not to let workers overload the database: their count is capped by its throughput. In interviews, people add a virtual waiting room at the entrance and seat reservations with a timeout.',
      ),
    ],
    hitRatio: {},
    solution: {
      nodes: [
        n('c1', 'client', tr('Бронирование', 'Bookings'), 30, 240, { rps: 8000, workload: 'oltp' }),
        n('g1', 'gateway', 'Gateway', 220, 240, { instances: 4 }),
        n('s1', 'service', 'Booking API', 420, 240, { ...svc('light'), instances: 10 }),
        n('q1', 'queue', 'Kafka', 420, 420),
        n('w1', 'service', tr('Воркеры брони', 'Booking workers'), 620, 420, { ...svc('fast'), instances: 14 }),
        n('d1', 'postgres', 'PostgreSQL', 820, 240, { instances: 5 }),
      ],
      edges: [
        { id: 'e1', from: 'c1', to: 'g1' },
        { id: 'e2', from: 'g1', to: 's1' },
        { id: 'a1', from: 's1', to: 'q1' },
        { id: 'a2', from: 'q1', to: 'w1' },
        { id: 'a3', from: 'w1', to: 'd1' },
      ],
    },
  },


  // ---------------- Инструменты: по одной задаче на инструмент ----------------
  {
    id: 'tool-redis',
    title: tr('Главная страница тормозит', 'The home page is slow'),
    group: 'Инструменты',
    tool: 'cache',
    brief: tr(
      [
        'Главную страницу магазина открывают **5 000 раз в секунду**, и каждый раз сервис читает из PostgreSQL одни и те же баннеры и подборки. База держит 1 000 rps.',
        'Главная должна открываться быстрее **40 мс**. Бюджет — **$650**: дополнительные реплики базы в него не помещаются.',
      ],
      [
        'The store\'s home page is opened **5,000 times per second**, and every time the service reads the same banners and collections from PostgreSQL. The database handles 1,000 rps.',
        'The home page must load in under **40 ms**. Budget: **$650** — extra database replicas don\'t fit into it.',
      ],
    ),
    nodes: [
      n('c1', 'client', tr('Главная страница', 'Home page'), 40, 240, { rps: 5000, workload: 'oltp' }),
      n('s1', 'service', tr('Витрина', 'Storefront'), 380, 240, { ...svc('light'), instances: 6 }),
      n('d1', 'postgres', 'PostgreSQL', 760, 240),
    ],
    edges: [
      { id: 'e1', from: 'c1', to: 's1' },
      { id: 'e2', from: 's1', to: 'd1' },
    ],
    budget: 650,
    locked: ['c1', 's1', 'd1'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Главная ≤ 40 мс', 'Home page ≤ 40 ms'), check: lat('c1', 40) },
    ],
    paths: [{ from: 's1', to: 'd1', text: tr('Витрина читает данные из PostgreSQL', 'Storefront reads its data from PostgreSQL') }],
    hints: [
      tr(
        'База получает 5 000 rps, а держит 1 000. Но посмотрите на данные: главная одинакова для всех и меняется раз в несколько минут.',
        'The database receives 5,000 rps but handles 1,000. Look at the data though: the home page is the same for everyone and changes every few minutes.',
      ),
      tr(
        'Нужен компонент, который держит готовые ответы в памяти и отвечает за миллисекунду, а в базу пропускает только то, чего ещё нет в памяти. Реплики базы не влезут в бюджет.',
        'You need a component that keeps ready answers in memory and replies in a millisecond, letting only what is not in memory through to the database. Database replicas won\'t fit the budget.',
      ),
      tr(
        'Подключите его к сервису витрины рядом с базой: сервис сначала спросит его, а при промахе пойдёт в базу.',
        'Connect it to the storefront service next to the database: the service asks it first and goes to the database on a miss.',
      ),
    ],
    debrief: [
      tr(
        'Redis — первое, что ставят перед базой при повторяющихся чтениях: 90% попаданий снимают с базы 90% нагрузки за цену одного небольшого инстанса.',
        'Redis is the first thing you put in front of a database for repeated reads: a 90% hit ratio takes 90% of the load off the database for the price of one small instance.',
      ),
      tr(
        'Главные вопросы при внедрении кэша — инвалидация и TTL: что делать, когда маркетинг поменял баннер, и сколько секунд устаревших данных допустимо.',
        'The key questions when introducing a cache are invalidation and TTL: what happens when marketing changes a banner, and how many seconds of stale data are acceptable.',
      ),
    ],
    hitRatio: { cache: 0.9 },
    solution: {
      nodes: [
        n('c1', 'client', tr('Главная страница', 'Home page'), 40, 240, { rps: 5000, workload: 'oltp' }),
        n('s1', 'service', tr('Витрина', 'Storefront'), 380, 240, { ...svc('light'), instances: 6 }),
        n('k1', 'cache', 'Redis', 600, 80, { hitRatio: 0.9 }),
        n('d1', 'postgres', 'PostgreSQL', 760, 240),
      ],
      edges: [
        { id: 'e1', from: 'c1', to: 's1' },
        { id: 'e2', from: 's1', to: 'd1' },
        { id: 'a1', from: 's1', to: 'k1' },
      ],
    },
  },
  {
    id: 'tool-cdn',
    title: tr('Картинки грузятся медленно', 'Images load slowly'),
    group: 'Инструменты',
    tool: 'cdn',
    brief: tr(
      [
        'Фотографии товаров лежат в объектном хранилище и запрашиваются **20 000 раз в секунду** со всей страны. Хранилище работает на пределе, картинки грузятся медленно.',
        'Картинка должна начинать грузиться быстрее **20 мс**. Бюджет — **$300**.',
      ],
      [
        'Product photos live in object storage and are requested **20,000 times per second** from all over the country. The storage is at its limit and images load slowly.',
        'An image must start loading in under **20 ms**. Budget: **$300**.',
      ],
    ),
    nodes: [
      n('c1', 'client', tr('Картинки', 'Images'), 40, 240, { rps: 20000, workload: 'blob' }),
      n('s3', 's3', 'S3', 760, 240),
    ],
    edges: [{ id: 'e1', from: 'c1', to: 's3' }],
    budget: 300,
    locked: ['c1', 's3'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Картинка ≤ 20 мс', 'Image ≤ 20 ms'), check: lat('c1', 20) },
    ],
    paths: [{ from: 'c1', to: 's3', text: tr('Оригиналы картинок остаются в хранилище', 'Original images stay in storage') }],
    hints: [
      tr(
        'Хранилище перегружено, но даже ещё один экземпляр не поможет: 40 мс до него никуда не денутся, а цель — 20 мс.',
        'The storage is overloaded, but even another instance won\'t help: the 40 ms to reach it won\'t go away, and the goal is 20 ms.',
      ),
      tr(
        'Картинки одинаковы для всех и почти не меняются. Их можно держать копиями на серверах в каждом городе, рядом с покупателями.',
        'The images are the same for everyone and almost never change. Copies can be kept on servers in every city, close to the shoppers.',
      ),
      tr(
        'Поставьте это между покупателями и хранилищем: до хранилища будут доходить только картинки, которых ещё нет рядом с пользователем.',
        'Put it between the shoppers and the storage: only images not yet near the user will reach the storage.',
      ),
    ],
    debrief: [
      tr(
        'CDN кэширует статику на edge-серверах рядом с пользователями: задержка — единицы миллисекунд, а до хранилища доходит лишь доля запросов.',
        'A CDN caches static content on edge servers close to users: latency is a few milliseconds, and only a fraction of requests reach the storage.',
      ),
      tr(
        'При обновлении картинки в CDN делают версионированные URL (`photo.jpg?v=2`) или purge — иначе пользователи неделю будут видеть старую.',
        'When an image is updated, CDNs use versioned URLs (`photo.jpg?v=2`) or a purge — otherwise users will see the old one for a week.',
      ),
    ],
    hitRatio: { cdn: 0.95 },
    solution: {
      nodes: [
        n('c1', 'client', tr('Картинки', 'Images'), 40, 240, { rps: 20000, workload: 'blob' }),
        n('cdn', 'cdn', 'CDN', 400, 240, { hitRatio: 0.95 }),
        n('s3', 's3', 'S3', 760, 240),
      ],
      edges: [...chain('c1', 'cdn', 's3')],
    },
  },
  {
    id: 'tool-kafka',
    title: tr('Регистрация ждёт письма', 'Sign-up waits for an email'),
    group: 'Инструменты',
    tool: 'queue',
    brief: tr(
      [
        'После регистрации сервис синхронно отправляет приветственное письмо через почтового провайдера, а тот отвечает **300 мс**. Регистрация из-за этого медленная, а при сбоях провайдера пользователи не могут зарегистрироваться.',
        'Регистрация должна отвечать быстрее **100 мс**, письма — не копиться. Бюджет — **$700**.',
      ],
      [
        'After sign-up the service synchronously sends a welcome email through an email provider, which takes **300 ms** to respond. Sign-up is slow because of it, and when the provider fails, users can\'t sign up at all.',
        'Sign-up must respond in under **100 ms**, and emails must not pile up. Budget: **$700**.',
      ],
    ),
    nodes: [
      n('c1', 'client', tr('Регистрация', 'Sign-up'), 40, 240, { rps: 300, workload: 'oltp' }),
      n('s1', 'service', 'Users API', 340, 240, { ...svc('fast'), instances: 2 }),
      n('d1', 'postgres', 'PostgreSQL', 640, 420),
      n('s2', 'service', tr('Отправка писем', 'Email sender'), 780, 160, { ...svc('external'), instances: 4 }),
    ],
    edges: [
      { id: 'e1', from: 'c1', to: 's1' },
      { id: 'e2', from: 's1', to: 'd1' },
      { id: 'e3', from: 's1', to: 's2' },
    ],
    budget: 700,
    locked: ['c1', 's1', 'd1', 's2'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Регистрация ≤ 100 мс', 'Sign-up ≤ 100 ms'), check: lat('c1', 100) },
      { text: tr('Письма не копятся', 'Emails don\'t pile up'), check: (r) => r.backlogGrowth < 1 },
    ],
    paths: [
      { from: 's1', to: 'd1', text: tr('Пользователи сохраняются в PostgreSQL', 'Users are stored in PostgreSQL') },
      { from: 's1', to: 's2', text: tr('Каждый новый пользователь получает письмо', 'Every new user gets an email') },
    ],
    hints: [
      tr(
        'Регистрация ждёт письма 300 мс, а при сбое провайдера не проходит вовсе. Но разве пользователю нужно письмо, чтобы войти?',
        'Registration waits 300 ms for the email and fails completely when the provider is down. But does the user need the email to log in?',
      ),
      tr(
        'Нужен посредник, который надёжно принимает событие «пользователь зарегистрирован» и хранит его, пока отправка писем его не заберёт — даже если провайдер лежит час.',
        'You need an intermediary that durably accepts a "user registered" event and keeps it until the email sender picks it up — even if the provider is down for an hour.',
      ),
      tr(
        'Разорвите прямую связь Users API → Отправка писем и поставьте этот посредник между ними.',
        'Break the direct Users API → Email sending connection and put that intermediary in between.',
      ),
    ],
    debrief: [
      tr(
        'Брокер развязывает латентность и надёжность: регистрация не ждёт провайдера и не падает вместе с ним, а письмо уйдёт, когда тот поднимется.',
        'A broker decouples latency and reliability: sign-up doesn\'t wait for the provider and doesn\'t fail with it, and the email goes out once the provider is back up.',
      ),
      tr(
        'Событие «пользователь зарегистрирован» потом пригодится и другим: аналитике, бонусной программе, антифроду — без изменений в Users API.',
        'The "user registered" event will later be useful to others too: analytics, the loyalty program, anti-fraud — with no changes to Users API.',
      ),
    ],
    hitRatio: {},
    solution: {
      nodes: [
        n('c1', 'client', tr('Регистрация', 'Sign-up'), 40, 240, { rps: 300, workload: 'oltp' }),
        n('s1', 'service', 'Users API', 340, 240, { ...svc('fast'), instances: 2 }),
        n('d1', 'postgres', 'PostgreSQL', 640, 420),
        n('q1', 'queue', 'Kafka', 560, 80),
        n('s2', 'service', tr('Отправка писем', 'Email sender'), 780, 160, { ...svc('external'), instances: 4 }),
      ],
      edges: [{ id: 'e1', from: 'c1', to: 's1' }, { id: 'e2', from: 's1', to: 'd1' }, ...chain('s1', 'q1', 's2')],
    },
  },
  {
    id: 'tool-cassandra',
    title: tr('Поток показаний датчиков', 'A stream of sensor readings'),
    group: 'Инструменты',
    tool: 'cassandra',
    brief: tr(
      [
        'Сто тысяч датчиков на заводах присылают показания: **15 000 записей в секунду** по ключу «датчик + время». Транзакции и JOIN не нужны, зато поток растёт каждый месяц.',
        'Запись должна подтверждаться быстрее **50 мс**. Бюджет — **$2400**. PostgreSQL можно заменить.',
      ],
      [
        'A hundred thousand factory sensors send readings: **15,000 writes per second** keyed by "sensor + time". No transactions or JOINs are needed, but the stream grows every month.',
        'A write must be acknowledged in under **50 ms**. Budget: **$2400**. PostgreSQL may be replaced.',
      ],
    ),
    nodes: [
      n('c1', 'client', tr('Датчики', 'Sensors'), 40, 240, { rps: 15000, workload: 'kv' }),
      n('s1', 'service', 'Ingest API', 380, 240, { ...svc('light'), instances: 20 }),
      n('d1', 'postgres', 'PostgreSQL', 760, 240, { instances: 5 }),
    ],
    edges: [
      { id: 'e1', from: 'c1', to: 's1' },
      { id: 'e2', from: 's1', to: 'd1' },
    ],
    budget: 2400,
    locked: ['c1', 's1'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Запись ≤ 50 мс', 'Write ≤ 50 ms'), check: lat('c1', 50) },
      { text: tr('Показания сохраняются', 'Readings are persisted'), check: persisted('c1') },
    ],
    paths: [],
    hints: [
      tr(
        'Пять реплик PostgreSQL дают на запись по ключу 4 000 rps — а нужно 15 000. Реплики масштабируют чтение, но не запись.',
        'Five PostgreSQL replicas give 4,000 rps for keyed writes — and you need 15,000. Replicas scale reads, not writes.',
      ),
      tr(
        'Нужна база, в которой каждый узел принимает запись, данные раскладываются по узлам по ключу, а новый узел линейно добавляет пропускную способность. JOIN и транзакции здесь не нужны.',
        'You need a database where every node accepts writes, data is spread across nodes by key, and each new node adds throughput linearly. JOINs and transactions are not needed here.',
      ),
      tr(
        'Замените ею PostgreSQL и подберите число узлов так, чтобы загрузка была комфортной.',
        'Replace PostgreSQL with it and pick the number of nodes so that utilization stays comfortable.',
      ),
    ],
    debrief: [
      tr(
        'Cassandra (и ScyllaDB) созданы для огромного потока записей по ключу: каждый узел принимает запись, данные распределяются по кольцу, добавление узла добавляет пропускную способность.',
        'Cassandra (and ScyllaDB) are built for huge streams of keyed writes: every node accepts writes, data is distributed around a ring, and adding a node adds throughput.',
      ),
      tr(
        'Плата — модель данных под запросы: таблицы проектируют от того, как их будут читать (по датчику и интервалу времени), без JOIN и транзакций.',
        'The price is a query-driven data model: tables are designed around how they will be read (by sensor and time range), without JOINs or transactions.',
      ),
    ],
    hitRatio: {},
    solution: {
      nodes: [
        n('c1', 'client', tr('Датчики', 'Sensors'), 40, 240, { rps: 15000, workload: 'kv' }),
        n('s1', 'service', 'Ingest API', 380, 240, { ...svc('light'), instances: 20 }),
        n('cs', 'cassandra', 'Cassandra', 760, 240, { instances: 5 }),
      ],
      edges: [...chain('c1', 's1', 'cs')],
    },
  },
  {
    id: 'tool-elastic',
    title: tr('Поиск по объявлениям', 'Classifieds search'),
    group: 'Инструменты',
    tool: 'elastic',
    brief: tr(
      [
        'Доска объявлений: **2 000** поисковых запросов в секунду по тексту объявлений и **1 000 rps** на просмотр карточек. Сейчас поиск — `LIKE %…%` по PostgreSQL.',
        'Поиск — быстрее **60 мс**, карточка — быстрее **60 мс**. Бюджет — **$1300**.',
      ],
      [
        'A classifieds board: **2,000** full-text search queries per second over listing text and **1,000 rps** for viewing listing cards. Right now search is `LIKE %…%` over PostgreSQL.',
        'Search must take under **60 ms**, a listing card under **60 ms**. Budget: **$1300**.',
      ],
    ),
    nodes: [
      n('c1', 'client', tr('Поиск', 'Search'), 40, 120, { rps: 2000, workload: 'search' }),
      n('c2', 'client', tr('Карточки', 'Listing cards'), 40, 360, { rps: 1000, workload: 'oltp' }),
      n('s1', 'service', tr('Объявления', 'Listings'), 380, 240, { ...svc('light'), instances: 4 }),
      n('d1', 'postgres', 'PostgreSQL', 760, 240, { instances: 2 }),
    ],
    edges: [
      { id: 'e1', from: 'c1', to: 's1' },
      { id: 'e2', from: 'c2', to: 's1' },
      { id: 'e3', from: 's1', to: 'd1' },
    ],
    budget: 1300,
    locked: ['c1', 'c2', 's1', 'd1'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Поиск ≤ 60 мс', 'Search ≤ 60 ms'), check: lat('c1', 60) },
      { text: tr('Карточка ≤ 60 мс', 'Listing card ≤ 60 ms'), check: lat('c2', 60) },
      { text: tr('Объявления и поиск обслуживаются подходящими хранилищами', 'Listings and search are served by suitable storage'), check: persisted('c1', 'c2') },
    ],
    paths: [{ from: 's1', to: 'd1', text: tr('Объявления хранятся в PostgreSQL', 'Listings are stored in PostgreSQL') }],
    hints: [
      tr(
        '`LIKE %…%` не может использовать индекс: каждый поиск — полный проход по таблице. Посмотрите, во сколько раз PostgreSQL хуже обрабатывает этот профиль.',
        '`LIKE %…%` cannot use an index: every search is a full table scan. Check how many times worse PostgreSQL handles this workload.',
      ),
      tr(
        'Нужно хранилище, которое заранее раскладывает тексты на слова и строит индекс «слово → объявления», учитывает словоформы и ранжирует результаты.',
        'You need a store that splits texts into words in advance and builds a "word → listings" index, handles word forms and ranks the results.',
      ),
      tr(
        'Подключите его к сервису объявлений рядом с PostgreSQL — поиск уйдёт туда, карточки останутся в базе.',
        'Connect it to the listings service next to PostgreSQL — search goes there, cards stay in the database.',
      ),
    ],
    debrief: [
      tr(
        'Elasticsearch (OpenSearch) строит инвертированный индекс: поиск по словам, морфология, опечатки, ранжирование, фасеты — то, чего реляционная база не умеет делать быстро.',
        'Elasticsearch (OpenSearch) builds an inverted index: word search, stemming, typo tolerance, ranking, facets — things a relational database can\'t do fast.',
      ),
      tr(
        'Источником истины остаётся PostgreSQL, индекс наполняется из него (через CDC или события) и может отставать на секунды.',
        'PostgreSQL remains the source of truth; the index is populated from it (via CDC or events) and may lag by seconds.',
      ),
    ],
    hitRatio: {},
    solution: {
      nodes: [
        n('c1', 'client', tr('Поиск', 'Search'), 40, 120, { rps: 2000, workload: 'search' }),
        n('c2', 'client', tr('Карточки', 'Listing cards'), 40, 360, { rps: 1000, workload: 'oltp' }),
        n('s1', 'service', tr('Объявления', 'Listings'), 380, 240, { ...svc('light'), instances: 4 }),
        n('d1', 'postgres', 'PostgreSQL', 760, 240, { instances: 2 }),
        n('es', 'elastic', 'Elasticsearch', 600, 420, { instances: 2 }),
      ],
      edges: [
        { id: 'e1', from: 'c1', to: 's1' },
        { id: 'e2', from: 'c2', to: 's1' },
        { id: 'e3', from: 's1', to: 'd1' },
        { id: 'a1', from: 's1', to: 'es' },
      ],
    },
  },
  {
    id: 'tool-clickhouse',
    title: tr('Дашборд выручки', 'Revenue dashboard'),
    group: 'Инструменты',
    tool: 'clickhouse',
    brief: tr(
      [
        'Финансовый дашборд: **100** агрегирующих запросов в секунду по истории заказов — выручка по дням, регионам, категориям. Его обслуживает отдельный Analytics API, но читает он ту же базу, куда пишут **800 rps** заказов.',
        'Дашборд должен отвечать быстрее **120 мс**, заказы — быстрее **100 мс**. Бюджет — **$850**.',
      ],
      [
        'A finance dashboard: **100** aggregate queries per second over order history — revenue by day, region and category. It is served by a separate Analytics API, but that API reads the same database that receives **800 rps** of orders.',
        'The dashboard must respond in under **120 ms**, orders in under **100 ms**. Budget: **$850**.',
      ],
    ),
    nodes: [
      n('c1', 'client', tr('Дашборд', 'Dashboard'), 40, 120, { rps: 100, workload: 'analytics' }),
      n('c2', 'client', tr('Заказы', 'Orders'), 40, 380, { rps: 800, workload: 'oltp' }),
      n('s2', 'service', 'Analytics API', 380, 120, svc('fast')),
      n('s1', 'service', 'Orders API', 380, 380, { ...svc('fast'), instances: 5 }),
      n('d1', 'postgres', 'PostgreSQL', 760, 240),
    ],
    edges: [
      { id: 'e1', from: 'c1', to: 's2' },
      { id: 'e2', from: 'c2', to: 's1' },
      { id: 'e3', from: 's1', to: 'd1' },
      { id: 'e4', from: 's2', to: 'd1' },
    ],
    budget: 850,
    locked: ['c1', 'c2', 's1', 's2', 'd1'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Дашборд ≤ 120 мс', 'Dashboard ≤ 120 ms'), check: lat('c1', 120) },
      { text: tr('Заказы ≤ 100 мс', 'Orders ≤ 100 ms'), check: lat('c2', 100) },
      { text: tr('Данные хранятся в подходящих хранилищах', 'Data is persisted in suitable stores'), check: persisted('c1', 'c2') },
    ],
    paths: [{ from: 's1', to: 'd1', text: tr('Заказы хранятся в PostgreSQL', 'Orders are stored in PostgreSQL') }],
    hints: [
      tr(
        'Агрегат «выручка по регионам за год» в строчной базе читает все поля всех строк. Посмотрите, насколько PostgreSQL хуже обрабатывает этот профиль.',
        'A "revenue by region for the year" aggregate in a row store reads every field of every row. Check how much worse PostgreSQL handles this workload.',
      ),
      tr(
        'Нужна база, которая хранит каждый столбец отдельно и сжатым: запрос читает только два-три нужных столбца из сотни. Поисковое хранилище тоже умеет агрегаты, но для тяжёлой аналитики оно медленнее.',
        'You need a database that stores each column separately and compressed: a query reads only the two or three columns it needs out of a hundred. A search store can aggregate too, but it is slower for heavy analytics.',
      ),
      tr(
        'Подключите её к Analytics API вместо PostgreSQL.',
        'Connect it to the Analytics API instead of PostgreSQL.',
      ),
    ],
    debrief: [
      tr(
        'ClickHouse — колоночная OLAP-база: агрегаты по миллиардам строк за доли секунды. Данные в неё обычно льются потоком из Kafka или через CDC из основной базы.',
        'ClickHouse is a columnar OLAP database: aggregates over billions of rows in fractions of a second. Data usually streams into it from Kafka or via CDC from the primary database.',
      ),
      tr(
        'Elasticsearch тоже умеет агрегации, но на тяжёлой аналитике по большим таблицам колоночное хранилище заметно быстрее и дешевле.',
        'Elasticsearch can do aggregations too, but for heavy analytics over large tables a columnar store is noticeably faster and cheaper.',
      ),
    ],
    hitRatio: {},
    solution: {
      nodes: [
        n('c1', 'client', tr('Дашборд', 'Dashboard'), 40, 120, { rps: 100, workload: 'analytics' }),
        n('c2', 'client', tr('Заказы', 'Orders'), 40, 380, { rps: 800, workload: 'oltp' }),
        n('s2', 'service', 'Analytics API', 380, 120, svc('fast')),
        n('s1', 'service', 'Orders API', 380, 380, { ...svc('fast'), instances: 5 }),
        n('d1', 'postgres', 'PostgreSQL', 760, 240),
        n('ch', 'clickhouse', 'ClickHouse', 760, 60),
      ],
      edges: [
        { id: 'e1', from: 'c1', to: 's2' },
        { id: 'e2', from: 'c2', to: 's1' },
        { id: 'e3', from: 's1', to: 'd1' },
        { id: 'a1', from: 's2', to: 'ch' },
      ],
    },
  },
  {
    id: 'tool-s3',
    title: tr('Сканы документов в базе', 'Document scans in the database'),
    group: 'Инструменты',
    tool: 's3',
    brief: tr(
      [
        'Клиенты загружают и скачивают сканы паспортов и договоров — **300 файлов в секунду**, ещё **200 rps** идёт на карточки документов (кто загрузил, когда, статус проверки). Сейчас файлы лежат в PostgreSQL в колонке `bytea`.',
        'Файл — быстрее **100 мс**, бюджет — **$500**.',
      ],
      [
        'Customers upload and download scans of passports and contracts — **300 files per second**, plus **200 rps** for document cards (who uploaded it, when, verification status). Right now files are stored in PostgreSQL in a `bytea` column.',
        'A file must take under **100 ms**; budget: **$500**.',
      ],
    ),
    nodes: [
      n('c1', 'client', tr('Файлы', 'Files'), 40, 120, { rps: 300, workload: 'blob' }),
      n('c2', 'client', tr('Карточки', 'Document cards'), 40, 360, { rps: 200, workload: 'oltp' }),
      n('s1', 'service', 'Documents API', 380, 240, { ...svc('fast'), instances: 3 }),
      n('d1', 'postgres', 'PostgreSQL', 760, 240),
    ],
    edges: [
      { id: 'e1', from: 'c1', to: 's1' },
      { id: 'e2', from: 'c2', to: 's1' },
      { id: 'e3', from: 's1', to: 'd1' },
    ],
    budget: 500,
    locked: ['c1', 'c2', 's1', 'd1'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Файл ≤ 100 мс', 'File ≤ 100 ms'), check: lat('c1', 100) },
      { text: tr('Файлы и карточки хранятся', 'Files and cards are persisted'), check: persisted('c1', 'c2') },
    ],
    paths: [{ from: 's1', to: 'd1', text: tr('Карточки документов хранятся в PostgreSQL', 'Document cards are stored in PostgreSQL') }],
    hints: [
      tr(
        'Откройте свойства PostgreSQL: файлы он обрабатывает в пятьдесят раз хуже обычных строк, а ещё они раздувают бэкапы и репликацию.',
        'Open PostgreSQL\'s properties: it handles files fifty times worse than regular rows, and they also bloat backups and replication.',
      ),
      tr(
        'Нужно хранилище, которое кладёт файл целиком по ключу — дёшево, надёжно и без ограничений по объёму. В базе останется только ключ файла и метаданные.',
        'You need a store that keeps a whole file by key — cheaply, durably and without size limits. The database keeps only the file key and metadata.',
      ),
      tr(
        'Подключите его к Documents API рядом с PostgreSQL: файлы уйдут туда, карточки останутся в базе.',
        'Connect it to the Documents API next to PostgreSQL: files go there, cards stay in the database.',
      ),
    ],
    debrief: [
      tr(
        'Объектное хранилище (S3, MinIO, Yandex Object Storage) — правильное место для файлов: дёшево, надёжно, безгранично по объёму. В базе остаются метаданные и ключ объекта.',
        'Object storage (S3, MinIO, Yandex Object Storage) is the right place for files: cheap, durable, virtually unlimited in size. The database keeps the metadata and the object key.',
      ),
      tr(
        'Обычно файл даже не идёт через сервис: клиент получает предподписанную ссылку и загружает напрямую в S3.',
        'Usually the file doesn\'t even go through the service: the client gets a presigned URL and uploads directly to S3.',
      ),
    ],
    hitRatio: {},
    solution: {
      nodes: [
        n('c1', 'client', tr('Файлы', 'Files'), 40, 120, { rps: 300, workload: 'blob' }),
        n('c2', 'client', tr('Карточки', 'Document cards'), 40, 360, { rps: 200, workload: 'oltp' }),
        n('s1', 'service', 'Documents API', 380, 240, { ...svc('fast'), instances: 3 }),
        n('d1', 'postgres', 'PostgreSQL', 760, 240),
        n('s3', 's3', 'S3', 600, 420),
      ],
      edges: [
        { id: 'e1', from: 'c1', to: 's1' },
        { id: 'e2', from: 'c2', to: 's1' },
        { id: 'e3', from: 's1', to: 'd1' },
        { id: 'a1', from: 's1', to: 's3' },
      ],
    },
  },

  // ---------------- System Design ----------------
  {
    id: 'shortener',
    title: tr('Сокращатель ссылок', 'URL Shortener'),
    group: 'System Design',
    brief: tr(
      [
        'Сервис коротких ссылок: пользователи создают **10 млн** ссылок в сутки, по каждой в среднем **10 переходов**. В пике трафик вдвое выше среднего. Переход по ссылке должен открываться быстрее **60 мс**, каждую ссылку нужно надёжно хранить. Бюджет — **$800 в месяц**.',
        'Нагрузка — это чтение и запись по ключу (короткий код → длинный URL). Транзакции и JOIN не нужны.',
      ],
      [
        'A URL shortening service: users create **10M** links per day, each followed **10 times** on average. Peak traffic is twice the average. A redirect must complete in under **60 ms**, and every link must be stored durably. Budget: **$800 per month**.',
        'The workload is keyed reads and writes (short code → long URL). No transactions or JOINs are needed.',
      ],
    ),
    estimate: {
      question: tr('Сколько переходов в секунду в пике?', 'How many redirects per second at peak?'),
      answer: 2315,
      unit: 'rps',
      formula: tr(
        '10 млн ссылок × 10 переходов = 100 млн в сутки; ÷ 86 400 с ≈ 1157 rps в среднем; × 2 в пике ≈ 2300 rps',
        '10M links × 10 redirects = 100M per day; ÷ 86,400 s ≈ 1,157 rps on average; × 2 at peak ≈ 2,300 rps',
      ),
    },
    nodes: [
      n('c1', 'client', tr('Переходы', 'Redirects'), 40, 140, { rps: 2315, workload: 'kv' }),
      n('c2', 'client', tr('Создание ссылок', 'Link creation'), 40, 340, { rps: 232, workload: 'kv' }),
    ],
    edges: [],
    budget: 800,
    locked: ['c1', 'c2'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Переход ≤ 60 мс', 'Redirect ≤ 60 ms'), check: lat('c1', 60) },
      { text: tr('Ссылки сохраняются в хранилище', 'Links are persisted in storage'), check: persisted('c1', 'c2') },
    ],
    paths: [],
    hints: [
      tr(
        'Начните с того, кто принимает трафик: сколько экземпляров сервиса нужно на ~2 500 rps с запасом, и какой профиль сервиса здесь уместен?',
        'Start with what takes the traffic: how many service instances do you need for ~2,500 rps with headroom, and which service profile fits here?',
      ),
      tr(
        'Данные — пары «короткий код → длинный адрес»: только чтение и запись по ключу, без транзакций и JOIN, а объём растёт каждый день. Какое хранилище в палитре называет такую нагрузку родной?',
        'The data is "short code → long URL" pairs: only reads and writes by key, no transactions or JOINs, and the volume grows every day. Which storage in the palette lists this workload as native?',
      ),
      tr(
        'Переходов в 10 раз больше, чем созданий, и популярные ссылки открывают снова и снова. То, что отвечает на повторы из памяти, снимет почти всю нагрузку с хранилища.',
        'There are 10× more redirects than creations, and popular links are opened again and again. Something that answers repeats from memory will take almost all the load off the storage.',
      ),
    ],
    debrief: [
      tr(
        'Классический read-heavy сервис: соотношение чтения к записи 10:1, данные не меняются после создания — идеально для кэша. Хранилище ключ-значение (Cassandra, DynamoDB) масштабируется линейно; PostgreSQL тоже справится, но на больших объёмах его придётся шардировать вручную.',
        'A classic read-heavy service: a 10:1 read-to-write ratio, and data never changes after creation — ideal for a cache. A key-value store (Cassandra, DynamoDB) scales linearly; PostgreSQL would cope too, but at large volumes you\'d have to shard it manually.',
      ),
      tr(
        'На интервью отдельно обсуждают генерацию короткого кода: счётчик + base62, хэш с проверкой коллизий или заранее сгенерированные коды.',
        'Interviews also discuss short code generation separately: a counter + base62, a hash with collision checks, or pre-generated codes.',
      ),
    ],
    hitRatio: { cache: 0.9 },
    solution: {
      nodes: [
        n('c1', 'client', tr('Переходы', 'Redirects'), 40, 140, { rps: 2315, workload: 'kv' }),
        n('c2', 'client', tr('Создание ссылок', 'Link creation'), 40, 340, { rps: 232, workload: 'kv' }),
        n('l1', 'lb', 'LB', 220, 240),
        n('s1', 'service', 'Shortener', 420, 240, { ...svc('light'), instances: 5 }),
        n('k1', 'cache', 'Redis', 620, 140, { hitRatio: 0.9 }),
        n('d1', 'cassandra', 'Cassandra', 820, 240),
      ],
      edges: [
        { id: 'a1', from: 'c1', to: 'l1' },
        { id: 'a2', from: 'c2', to: 'l1' },
        ...chain('l1', 's1', 'k1', 'd1'),
      ],
    },
  },
  {
    id: 'feed',
    title: tr('Лента новостей', 'News Feed'),
    group: 'System Design',
    brief: [
      tr(
        'Соцсеть: **50 млн** активных пользователей в день, каждый открывает ленту **10 раз**. В пике нагрузка вдвое выше средней. Публикуют посты гораздо реже — около **120 в секунду** в пике, но каждый пост нужно разложить по лентам подписчиков. Лента должна открываться быстрее **50 мс**. Бюджет — **$2400**.',
        'A social network: **50M** daily active users, each opening the feed **10 times**. Peak load is twice the average. Posts are published far less often — about **120 per second** at peak — but each post must be fanned out to followers\' feeds. The feed must load in under **50 ms**. Budget: **$2400**.',
      ),
    ],
    estimate: {
      question: tr('Сколько открытий ленты в секунду в пике?', 'How many feed opens per second at peak?'),
      answer: 11574,
      unit: 'rps',
      formula: tr(
        '50 млн × 10 = 500 млн открытий в сутки; ÷ 86 400 ≈ 5787 rps; × 2 в пике ≈ 11 600 rps',
        '50M × 10 = 500M opens per day; ÷ 86,400 ≈ 5,787 rps; × 2 at peak ≈ 11,600 rps',
      ),
    },
    nodes: [
      n('c1', 'client', tr('Чтение ленты', 'Feed reads'), 40, 140, { rps: 11574, workload: 'kv' }),
      n('c2', 'client', tr('Публикация постов', 'Post publishing'), 40, 380, { rps: 120, workload: 'oltp' }),
    ],
    edges: [],
    budget: 2400,
    locked: ['c1', 'c2'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Лента ≤ 50 мс', 'Feed ≤ 50 ms'), check: lat('c1', 50) },
      { text: tr('Публикация не ждёт рассылки по лентам (≤ 100 мс)', 'Publishing doesn\'t wait for posts to reach followers\' feeds (≤ 100 ms)'), check: lat('c2', 100) },
      { text: tr('Раскладка постов по лентам не отстаёт', 'Distributing posts to feeds keeps up'), check: (r) => r.backlogGrowth < 1 },
      { text: tr('Посты и ленты сохраняются', 'Posts and feeds are persisted'), check: persisted('c1', 'c2') },
    ],
    paths: [],
    hints: [
      tr(
        'Чтение и запись здесь — разные задачи. Ленту читают по ключу (id пользователя) 11 тысяч раз в секунду, а посты — это транзакционные данные. Хранить их в одном месте не обязательно.',
        'Reads and writes are different jobs here. Feeds are read by key (user id) 11,000 times per second, while posts are transactional data. They don\'t have to live in the same place.',
      ),
      tr(
        'Публикация не должна ждать, пока пост разложат по лентам всех подписчиков. Ей нужно отдать работу кому-то, кто сделает это позже, но гарантированно.',
        'Publishing must not wait until the post is placed into every follower\'s feed. It needs to hand the work to someone who will do it later, but reliably.',
      ),
      tr(
        'Для 11 тысяч rps на чтение нужны лёгкие сервисы и то, что отвечает на повторяющиеся запросы лент из памяти, перед хранилищем лент.',
        'For 11,000 read rps you need light services and something that answers repeated feed requests from memory, in front of the feed store.',
      ),
    ],
    debrief: [
      tr(
        'Это CQRS в чистом виде: путь записи (пост в PostgreSQL, событие в очередь, воркеры раскладывают по лентам) и путь чтения (готовая лента из кэша и Cassandra) масштабируются независимо.',
        'This is CQRS in its purest form: the write path (post to PostgreSQL, event to a queue, workers fan out to feeds) and the read path (precomputed feed from the cache and Cassandra) scale independently.',
      ),
      tr(
        'На интервью обязательно всплывают знаменитости с миллионами подписчиков: для них fan-out on write слишком дорог, их посты подмешивают в ленту при чтении (гибридная модель).',
        'Celebrities with millions of followers always come up in interviews: fan-out on write is too expensive for them, so their posts are merged into the feed at read time (hybrid model).',
      ),
    ],
    hitRatio: { cache: 0.9 },
    solution: {
      nodes: [
        n('c1', 'client', tr('Чтение ленты', 'Feed reads'), 40, 140, { rps: 11574, workload: 'kv' }),
        n('c2', 'client', tr('Публикация постов', 'Post publishing'), 40, 380, { rps: 120, workload: 'oltp' }),
        n('l1', 'lb', 'LB', 220, 140),
        n('s1', 'service', 'Feed API', 400, 140, { ...svc('light'), instances: 20 }),
        n('k1', 'cache', 'Redis', 600, 60, { hitRatio: 0.9 }),
        n('d1', 'cassandra', tr('Ленты', 'Feeds'), 820, 160),
        n('s2', 'service', 'Post API', 220, 380, svc('fast')),
        n('d2', 'postgres', tr('Посты', 'Posts'), 420, 460),
        n('q1', 'queue', 'Kafka', 420, 300),
        n('s3', 'service', 'Fan-out', 620, 300, svc('fast')),
      ],
      edges: [
        ...chain('c1', 'l1', 's1', 'k1', 'd1'),
        ...chain('c2', 's2', 'd2'),
        ...chain('s2', 'q1', 's3', 'd1'),
      ],
    },
  },
  {
    id: 'notifications',
    title: tr('Система уведомлений', 'Notification System'),
    group: 'System Design',
    brief: [
      tr(
        'Единый сервис уведомлений для всей компании: push, SMS и email. В сутки уходит **10 млн** уведомлений, но маркетинговые рассылки дают пики в **25 раз** выше среднего. Внешние провайдеры отвечают по 300 мс и держат 100 запросов в секунду на соединение. Сервисы-отправители должны получать ответ «принято» быстрее **50 мс**, ни одно уведомление не теряется, журнал отправок хранится. Бюджет — **$2800**.',
        'A single notification service for the whole company: push, SMS and email. **10M** notifications go out per day, but marketing campaigns cause peaks **25×** above average. External providers take 300 ms to respond and handle 100 requests per second per connection. Sender services must get an "accepted" response in under **50 ms**, no notification may be lost, and a delivery log is persisted. Budget: **$2800**.',
      ),
    ],
    estimate: {
      question: tr('Сколько уведомлений в секунду в пике?', 'How many notifications per second at peak?'),
      answer: 2894,
      unit: tr('в секунду', 'per second'),
      formula: tr(
        '10 млн ÷ 86 400 ≈ 116 в секунду в среднем; × 25 в пике рассылки ≈ 2900',
        '10M ÷ 86,400 ≈ 116 per second on average; × 25 at campaign peak ≈ 2,900',
      ),
    },
    nodes: [n('c1', 'client', tr('Сервисы-отправители', 'Sender services'), 40, 240, { rps: 2894, workload: 'kv' })],
    edges: [],
    budget: 2800,
    locked: ['c1'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Ответ «принято» ≤ 50 мс', '"Accepted" response ≤ 50 ms'), check: lat('c1', 50) },
      { text: tr('Неотправленные уведомления не копятся', 'Undelivered notifications do not pile up'), check: (r) => r.backlogGrowth < 1 },
      { text: tr('Журнал отправок сохраняется', 'Delivery log is persisted'), check: persisted('c1') },
    ],
    paths: [],
    hints: [
      tr(
        'Отправителю не нужно ждать провайдера 300 мс — ему нужно только «принято». Что разрывает синхронную цепочку и гарантирует, что уведомление не потеряется?',
        'The sender does not need to wait 300 ms for the provider — it only needs "accepted". What breaks the synchronous chain and guarantees the notification is not lost?',
      ),
      tr(
        'Воркеры отправки — это «внешний API»: 100 rps на экземпляр. Сколько их нужно, чтобы не отставать от пика?',
        'Delivery workers are an "external API": 100 rps per instance. How many do you need to keep up with the peak?',
      ),
      tr(
        'Журнал отправок — огромный непрерывный поток записей по ключу, которые почти никогда не меняются. Выберите хранилище, для которого это родной профиль.',
        'The delivery log is a huge continuous stream of keyed writes that almost never change. Pick the storage for which this is the native workload.',
      ),
    ],
    debrief: [
      tr(
        'Очередь здесь и буфер для пиков, и гарантия доставки: уведомление записано в Kafka — значит, оно уже не потеряется. Воркеры масштабируются под пропускную способность провайдеров.',
        'Here the queue is both a peak buffer and a delivery guarantee: once a notification is written to Kafka, it won\'t be lost. Workers scale to match provider throughput.',
      ),
      tr(
        'На интервью добавляют ретраи с backoff, дедупликацию (одно уведомление дважды раздражает), лимиты частоты на пользователя и приоритеты: код подтверждения важнее рассылки.',
        'In interviews, add retries with backoff, deduplication (the same notification twice is annoying), per-user rate limits and priorities: a verification code matters more than a campaign.',
      ),
    ],
    hitRatio: {},
    solution: {
      nodes: [
        n('c1', 'client', tr('Сервисы-отправители', 'Sender services'), 40, 240, { rps: 2894, workload: 'kv' }),
        n('s1', 'service', 'Notification API', 240, 240, { ...svc('light'), instances: 5 }),
        n('d1', 'cassandra', tr('Журнал', 'Log'), 440, 400),
        n('q1', 'queue', 'Kafka', 440, 140),
        n('s2', 'service', tr('Воркеры отправки', 'Delivery workers'), 700, 140, { ...svc('external'), instances: 30 }),
      ],
      edges: [...chain('c1', 's1', 'd1'), ...chain('s1', 'q1', 's2')],
    },
  },
  {
    id: 'video',
    title: tr('Видеохостинг', 'Video Hosting'),
    group: 'System Design',
    brief: [
      tr(
        '**5 млн** зрителей в день смотрят в среднем по **30 минут**. Видео отдаётся сегментами по **10 секунд**, вечерний пик втрое выше среднего. Загружают немного — около 5 видео в секунду, но каждое нужно перекодировать в несколько качеств. Каталог (названия, описания, лайки) — ещё **1500 rps**. Сегмент должен начинать отдаваться быстрее **30 мс**. Бюджет — **$1600**.',
        '**5M** viewers per day watch **30 minutes** on average. Video is served in **10-second** segments, and the evening peak is three times the average. Uploads are few — about 5 videos per second — but each must be transcoded into several qualities. The catalog (titles, descriptions, likes) adds another **1,500 rps**. A segment must start streaming in under **30 ms**. Budget: **$1600**.',
      ),
    ],
    estimate: {
      question: tr('Сколько видеосегментов в секунду отдаётся в пике?', 'How many video segments per second are served at peak?'),
      answer: 31250,
      unit: tr('в секунду', 'per second'),
      formula: tr(
        '30 мин = 180 сегментов на зрителя; 5 млн × 180 = 900 млн в сутки; ÷ 86 400 ≈ 10 400; × 3 в пике ≈ 31 000',
        '30 min = 180 segments per viewer; 5M × 180 = 900M per day; ÷ 86,400 ≈ 10,400; × 3 at peak ≈ 31,000',
      ),
    },
    nodes: [
      n('c1', 'client', tr('Просмотр', 'Viewing'), 40, 100, { rps: 31250, workload: 'blob' }),
      n('c2', 'client', tr('Загрузка', 'Uploads'), 40, 260, { rps: 5, workload: 'blob' }),
      n('c3', 'client', tr('Каталог', 'Catalog'), 40, 420, { rps: 1500, workload: 'oltp' }),
    ],
    edges: [],
    budget: 1600,
    locked: ['c1', 'c2', 'c3'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Сегмент ≤ 30 мс', 'Segment ≤ 30 ms'), check: lat('c1', 30) },
      { text: tr('Перекодирование не копится', 'Transcoding doesn\'t pile up'), check: (r) => r.backlogGrowth < 1 },
      { text: tr('Видео и каталог сохраняются', 'Videos and catalog are persisted'), check: persisted('c1', 'c2', 'c3') },
    ],
    paths: [],
    hints: [
      tr(
        'Видео — это файлы по мегабайту и больше. Посмотрите в таблицах «подходит для», какое хранилище считает файлы родными.',
        'Videos are files of a megabyte and more. Check the "good for" tables to see which storage treats files as native.',
      ),
      tr(
        '31 тысяча сегментов в секунду из одного места — медленно и дорого, а цель — 30 мс. Популярное видео смотрят миллионы раз — его копии стоит держать рядом со зрителями.',
        '31,000 segments per second from a single place is slow and expensive, and the goal is 30 ms. Popular videos are watched millions of times — keep copies close to the viewers.',
      ),
      tr(
        'Перекодирование занимает минуты. Загрузка должна передать эту работу дальше и сразу ответить, а тяжёлые обработчики — разбирать задания в своём темпе.',
        'Transcoding takes minutes. The upload must pass that work on and reply immediately, while heavy workers process the jobs at their own pace.',
      ),
    ],
    debrief: [
      tr(
        'Почти весь трафик видеохостинга обслуживает CDN: популярные сегменты лежат рядом со зрителем, в хранилище доходят только промахи. Метаданные живут отдельно, в обычной БД с кэшем.',
        'Almost all video hosting traffic is served by the CDN: popular segments sit close to the viewer, and only misses reach the storage. Metadata lives separately, in a regular DB with a cache.',
      ),
      tr(
        'Загрузка — асинхронный конвейер: файл в S3, событие в очередь, воркеры перекодируют в разные качества. На интервью обсуждают адаптивный битрейт (HLS/DASH), предподписанные ссылки на загрузку и стоимость трафика CDN.',
        'Upload is an asynchronous pipeline: file to S3, event to a queue, workers transcode into different qualities. Interviews cover adaptive bitrate (HLS/DASH), presigned upload URLs and CDN traffic costs.',
      ),
    ],
    hitRatio: { cache: 0.8, cdn: 0.95 },
    solution: {
      nodes: [
        n('c1', 'client', tr('Просмотр', 'Viewing'), 40, 100, { rps: 31250, workload: 'blob' }),
        n('c2', 'client', tr('Загрузка', 'Uploads'), 40, 260, { rps: 5, workload: 'blob' }),
        n('c3', 'client', tr('Каталог', 'Catalog'), 40, 420, { rps: 1500, workload: 'oltp' }),
        n('cdn', 'cdn', 'CDN', 260, 60, { hitRatio: 0.95 }),
        n('s3', 's3', 'S3', 820, 120),
        n('up', 'service', 'Upload API', 260, 260, svc('fast')),
        n('q1', 'queue', 'Kafka', 460, 260),
        n('tr', 'service', tr('Перекодирование', 'Transcoding'), 640, 260, svc('heavy')),
        n('ms', 'service', 'Catalog API', 260, 420, { ...svc('fast'), instances: 8 }),
        n('k1', 'cache', 'Redis', 460, 420, { hitRatio: 0.8 }),
        n('pg', 'postgres', 'PostgreSQL', 660, 440),
      ],
      edges: [
        ...chain('c1', 'cdn', 's3'),
        ...chain('c2', 'up', 's3'),
        ...chain('up', 'q1', 'tr', 's3'),
        ...chain('c3', 'ms', 'k1', 'pg'),
      ],
    },
  },
  {
    id: 'autocomplete',
    title: tr('Подсказки поиска', 'Search Autocomplete'),
    group: 'System Design',
    brief: [
      tr(
        'Поисковая строка с подсказками: **20 млн** пользователей в день делают по **5 поисков**, и пока человек печатает, уходит в среднем **4 запроса** подсказок. Пик вдвое выше среднего. Подсказки должны появляться быстрее **40 мс**. Кроме того, аналитики строят тренды запросов — это **50** тяжёлых агрегирующих запросов в секунду. Бюджет — **$2400**.',
        'A search bar with autocomplete: **20M** users per day run **5 searches** each, and while a person types, an average of **4 suggestion requests** go out. Peak is twice the average. Suggestions must appear in under **40 ms**. In addition, analysts build query trends — **50** heavy aggregate queries per second. Budget: **$2400**.',
      ),
    ],
    estimate: {
      question: tr('Сколько запросов подсказок в секунду в пике?', 'How many suggestion requests per second at peak?'),
      answer: 9259,
      unit: 'rps',
      formula: tr(
        '20 млн × 5 × 4 = 400 млн в сутки; ÷ 86 400 ≈ 4630; × 2 в пике ≈ 9300 rps',
        '20M × 5 × 4 = 400M per day; ÷ 86,400 ≈ 4,630; × 2 at peak ≈ 9,300 rps',
      ),
    },
    nodes: [
      n('c1', 'client', tr('Подсказки', 'Suggestions'), 40, 160, { rps: 9259, workload: 'search' }),
      n('c2', 'client', tr('Аналитика трендов', 'Trend analytics'), 40, 400, { rps: 50, workload: 'analytics' }),
    ],
    edges: [],
    budget: 2400,
    locked: ['c1', 'c2'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Подсказки ≤ 40 мс', 'Suggestions ≤ 40 ms'), check: lat('c1', 40) },
      { text: tr('Аналитика ≤ 500 мс', 'Analytics ≤ 500 ms'), check: lat('c2', 500) },
      { text: tr('Данные хранятся в подходящих хранилищах', 'Data is persisted in suitable stores'), check: persisted('c1', 'c2') },
    ],
    paths: [],
    hints: [
      tr(
        'Поиск по префиксу в PostgreSQL — это `LIKE` и полный проход по таблице. Посмотрите, какое хранилище считает поиск родным профилем.',
        'Prefix search in PostgreSQL means `LIKE` and a full table scan. Check which storage treats search as its native workload.',
      ),
      tr(
        'Популярные префиксы повторяются у миллионов людей: «пого…» → «погода». Ответы на них можно держать в памяти перед поиском.',
        'Popular prefixes repeat across millions of people: "weat…" → "weather". Answers to them can be kept in memory in front of search.',
      ),
      tr(
        'Тренды — это агрегаты по миллиардам запросов. Для них нужна база, которая читает только нужные столбцы, а не все строки целиком.',
        'Trends are aggregates over billions of queries. They need a database that reads only the columns it needs, not entire rows.',
      ),
    ],
    debrief: [
      tr(
        'Разные запросы — разные хранилища (polyglot persistence): поиск по префиксам в Elasticsearch или специализированном trie-сервисе, тренды в ClickHouse. Одна универсальная БД обслуживала бы всё плохо.',
        'Different queries, different stores (polyglot persistence): prefix search in Elasticsearch or a dedicated trie service, trends in ClickHouse. A single general-purpose DB would serve everything poorly.',
      ),
      tr(
        'На интервью строят trie с топ-N подсказок в каждом узле, обновляемый пакетно раз в час по данным аналитики, и обсуждают фильтрацию нежелательных подсказок.',
        'In interviews you build a trie with the top-N suggestions at each node, rebuilt in batch hourly from analytics data, and discuss filtering out inappropriate suggestions.',
      ),
    ],
    hitRatio: { cache: 0.8 },
    solution: {
      nodes: [
        n('c1', 'client', tr('Подсказки', 'Suggestions'), 40, 160, { rps: 9259, workload: 'search' }),
        n('c2', 'client', tr('Аналитика трендов', 'Trend analytics'), 40, 400, { rps: 50, workload: 'analytics' }),
        n('l1', 'lb', 'LB', 220, 160),
        n('s1', 'service', 'Suggest API', 400, 160, { ...svc('light'), instances: 16 }),
        n('k1', 'cache', 'Redis', 600, 80, { hitRatio: 0.8 }),
        n('es', 'elastic', 'Elasticsearch', 800, 160, { instances: 2 }),
        n('s2', 'service', 'Analytics API', 400, 400, svc('fast')),
        n('ch', 'clickhouse', 'ClickHouse', 700, 400),
      ],
      edges: [...chain('c1', 'l1', 's1', 'k1', 'es'), ...chain('c2', 's2', 'ch')],
    },
  },
]
