import { EXTERNAL_API, isStorage, type BEdge, type BNode, type Result, type Workload } from './model'
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
  /** Заблокированные сервисы, у которых игрок может сменить профиль: по ходу решения их работа меняется (например, API только кладёт заявку в очередь) */
  tunable?: string[]
  goals: { text: string; check: (r: Result) => boolean }[]
  /** Обязательные пути данных: нельзя «решить» задачу, просто удалив зависимость */
  paths: { from: string; to: string; text: string }[]
  hints: string[]
  debrief: string[]
  /** Доля попаданий — свойство данных задачи, а не настройка: у новых кэшей и CDN она фиксирована */
  hitRatio: { cache?: number; cdn?: number }
  /** Эталонное решение: им проверяется, что задача решаема (npm run check) */
  solution: { nodes: BNode[]; edges: BEdge[] }
  /** Сюжет по мотивам задачи из System Design Primer: под условием — ссылка на неё, автор и лицензия (CC BY 4.0) */
  source?: { primer: PrimerDir }
}

/** System Design Primer (Donne Martin), CC BY 4.0: репозиторий, разбор задачи по каталогу в solutions/system_design и лицензия */
/** Разборы System Design Primer, по мотивам которых сделаны задачи: опечатка в каталоге — ошибка типов, а не ссылка в никуда */
export type PrimerDir = 'mint' | 'pastebin' | 'sales_rank' | 'scaling_aws' | 'social_graph' | 'twitter' | 'web_crawler'

export const PRIMER = {
  solution: (dir: string) => `https://github.com/donnemartin/system-design-primer/blob/master/solutions/system_design/${dir}/README.md`,
  license: 'https://creativecommons.org/licenses/by/4.0/',
}

/** Подписи групп задач (ключи — внутренние идентификаторы) */
export const CHALLENGE_GROUP_LABEL: Record<BuilderChallenge['group'], string> = {
  Классика: tr('Классика', 'Classics', '经典'),
  Инструменты: tr('Инструменты', 'Tools', '工具'),
  'System Design': 'System Design',
}

export const SERVICE_PROFILES = [
  { id: 'fast', title: tr('Обычный: 300 rps, 20 мс', 'Standard: 300 rps, 20 ms', '标准：300 rps，20 ms'), capacity: 300, latency: 20 },
  { id: 'light', title: tr('Лёгкий stateless: 1000 rps, 5 мс', 'Light stateless: 1000 rps, 5 ms', '轻量无状态：1000 rps，5 ms'), capacity: 1000, latency: 5 },
  { id: 'heavy', title: tr('Тяжёлый: 100 rps, 120 мс', 'Heavy: 100 rps, 120 ms', '重型：100 rps，120 ms'), capacity: 100, latency: 120 },
  { id: 'external', title: tr('Внешний API: 100 rps на соединение, 300 мс', 'External API: 100 rps per connection, 300 ms', '外部 API：每个连接 100 rps，300 ms'), ...EXTERNAL_API },
]

/** Допуск прикидки: ±25% */
export function estimateOk(e: Estimate, value: number): boolean {
  return Math.abs(value - e.answer) <= e.answer * 0.25
}

export const sandboxStart: { nodes: BNode[]; edges: BEdge[] } = {
  nodes: [
    { id: 'c1', kind: 'client', label: tr('Пользователи', 'Users', '用户'), x: 40, y: 220, instances: 1, rps: 1000, workload: 'oltp' },
    { id: 's1', kind: 'service', label: tr('Монолит', 'Monolith', '单体'), x: 380, y: 220, instances: 2, capacity: 300, latency: 20 },
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
/** Запросы клиента доходят до хранилища, для которого их профиль родной: «умеет, но с эффективностью ×0.05» не засчитывается */
const native = (...ids: string[]) => (r: Result) => ids.every((id) => r.persistedNative[id])
/**
 * Весь поток клиента (его профиль нагрузки) доходит до узла и обрабатывается им и всем, что за ним, в том числе за очередями:
 * не половина — клиент и балансировщик делят поток поровну между связями, — и не «дошёл и потерялся» в перегруженном блоке
 */
const flowsAll = (node: string, client: string, w: Workload, rps: number) => (r: Result) => {
  const st = r.nodes[node]
  // каждый запрос клиента проходит через узел: объём сходится и тогда, когда половина ушла в обход, а другая пришла дважды
  if (!st || !r.covered[client]?.includes(node)) return false
  const processed = st.vec[w] * Math.min(1, st.util > 0 ? 1 / st.util : 1)
  return processed >= rps * 0.99 && st.deepSuccess >= 0.999
}
/**
 * Пишут и читают одно и то же хранилище: через него проходит каждый запрос клиента-писателя и каждый запрос клиента-читателя,
 * и оно не перегружено. Не «запись в одну базу, чтение — целиком или наполовину — из другой»
 */
const sharedStore = (writer: string, reader: string) => (r: Result) =>
  Object.entries(r.nodes).some(
    ([id, st]) => isStorage(st.kind) && st.util <= 1 && !!r.covered[writer]?.includes(id) && !!r.covered[reader]?.includes(id),
  )
/** Клиент получает данные в момент запроса: весь его поток доходит до хранилища, и ни одна часть не уходит в очередь */
const syncData = (...ids: string[]) => (r: Result) => ids.every((id) => r.persistedSync[id])
/** Асинхронная обработка успевает за потоком: ничего не копится в очередях */
const noBacklog = { text: tr('Необработанные запросы не копятся', 'Unprocessed requests do not pile up', '未处理的请求不会积压'), check: (r: Result) => r.backlogGrowth < 1 }
/** Латентность засчитывается, только если запросы клиента реально обслуживаются */
const lat = (id: string, ms: number) => (r: Result) =>
  (r.nodes[id]?.success ?? 0) > 0.5 && (r.nodes[id]?.latency ?? Infinity) <= ms

// ---------- «Рост»: одна система от одного сервера до миллионов, три шага (по мотивам scaling_aws из System Design Primer).
// Каждый шаг начинается с эталона предыдущего — с теми же блоками и местами на поле, но с новой нагрузкой
const gUsers = (rps: number) => n('c1', 'client', tr('Пользователи', 'Users', '用户'), 40, 110, { rps, workload: 'oltp', writeShare: 0.01 })
// около 1% запросов к статике — пользователи загружают картинки (в «Росте 1/3» — прямо в хранилище по подписанной ссылке)
const gStatic = (rps: number) => n('c2', 'client', tr('Статика', 'Static files', '静态文件'), 40, 260, { rps, workload: 'blob', writeShare: 0.01 })
const gWeb = (extra: Partial<BNode>) => n('s1', 'service', tr('Веб-сервер', 'Web server', 'Web 服务器'), 400, 110, { ...svc('fast'), ...extra })
const gDb = (instances: number) => n('d1', 'postgres', 'PostgreSQL', 820, 110, { instances })
const gS3 = () => n('s3', 's3', 'S3', 820, 300)
const gLb = () => n('l1', 'lb', 'LB', 220, 110)
const gCache = () => n('k1', 'cache', 'Redis', 620, 10, { hitRatio: 0.8 })
const gCdn = () => n('cdn', 'cdn', 'CDN', 400, 260, { hitRatio: 0.9 })
const gUploads = () => n('c3', 'client', tr('Загрузка файлов', 'File uploads', '文件上传'), 40, 430, { rps: 300, workload: 'blob', writeShare: 1 })
const gPreviews = (instances: number) => n('pv', 'service', tr('Превью', 'Previews', '预览'), 620, 430, { ...svc('heavy'), instances })
const gPath = [{ from: 's1', to: 'd1', text: tr('Веб-сервер хранит данные в PostgreSQL', 'The web server stores its data in PostgreSQL', 'Web 服务器把数据存放在 PostgreSQL 中') }]
const gPersisted = { text: tr('Данные и файлы сохраняются', 'Data and files are persisted', '数据和文件都已持久化保存') }
/** Все запросы страниц обслуживает веб-сервер задачи, а не новый сервис рядом с ним */
const gViaWeb = (rps: number) => ({ text: tr('Веб-сервер обрабатывает все запросы страниц', 'The web server handles all page requests', '所有页面请求都由 Web 服务器处理'), check: flowsAll('s1', 'c1', 'oltp', rps) })
/** Эталон шага 1 при заданной нагрузке — он же старт шага 2 */
const growth1Solution = (users: number, statics: number) => ({
  nodes: [gUsers(users), gStatic(statics), gWeb({ instances: 3 }), gDb(1), gS3()],
  edges: [...chain('c1', 's1', 'd1'), ...chain('c2', 's3')],
})
/** Эталон шага 2 при заданной нагрузке — он же основа старта шага 3 */
const growth2Solution = (users: number, statics: number) => ({
  nodes: [gUsers(users), gStatic(statics), gLb(), gWeb({ instances: 10 }), gDb(3), gCdn(), gS3()],
  edges: [...chain('c1', 'l1', 's1', 'd1'), ...chain('c2', 'cdn', 's3')],
})

export const builderChallenges: BuilderChallenge[] = [
  // ---------------- Классика ----------------
  {
    id: 'sale',
    title: tr('Чёрная пятница', 'Black Friday', '黑色星期五'),
    group: 'Классика',
    brief: [
      tr(
        'Каталог магазина держит 300 rps, а на распродаже ожидается **3000 rps**. PostgreSQL тянет 1000 запросов в секунду на реплику. Бюджет на инфраструктуру — **$1200 в месяц**.',
        'The store catalog handles 300 rps, but the sale is expected to bring **3,000 rps**. PostgreSQL handles 1,000 queries per second per replica. The infrastructure budget is **$1200 per month**.',
        '商店目录服务能承受 300 rps，而大促预计会带来 **3,000 rps**。PostgreSQL 每个副本每秒能处理 1,000 次查询。基础设施预算为 **每月 $1200**。',
      ),
    ],
    nodes: [
      n('c1', 'client', tr('Покупатели', 'Shoppers', '顾客'), 40, 220, { rps: 3000, workload: 'oltp', writeShare: 0.05 }),
      n('s1', 'service', tr('Каталог', 'Catalog', '目录'), 380, 220, svc('fast')),
      n('d1', 'postgres', 'PostgreSQL', 760, 220),
    ],
    edges: [
      { id: 'e1', from: 'c1', to: 's1' },
      { id: 'e2', from: 's1', to: 'd1' },
    ],
    budget: 1200,
    locked: ['c1', 's1', 'd1'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.5%', 'Successful responses ≥ 99.5%', '成功响应 ≥ 99.5%'), check: (r) => r.clientSuccess >= 0.995 },
      { text: tr('Латентность ≤ 120 мс', 'Latency ≤ 120 ms', '延迟 ≤ 120 ms'), check: lat('c1', 120) },
    ],
    paths: [{ from: 's1', to: 'd1', text: tr('Каталог получает данные из PostgreSQL', 'Catalog reads its data from PostgreSQL', '目录从 PostgreSQL 读取数据') }],
    hints: [
      tr(
        'Сначала посмотрите, какой блок красный. Сервис каталога один и захлёбывается: сколько экземпляров нужно на 3000 rps с запасом? У края мощности латентность растёт нелинейно.',
        'First look at which node is red. The single catalog service is drowning: how many instances do you need for 3,000 rps with headroom? Near full capacity, latency grows non-linearly.',
        '先看看哪个组件是红色的。只有一个目录服务实例，它已经不堪重负：要扛住 3,000 rps 并留出余量，需要多少个实例？接近满负荷时，延迟会非线性增长。',
      ),
      tr(
        'Дальше упрётесь в базу. Добавлять реплики дорого. Заметьте: каталог читают гораздо чаще, чем меняют, и одни и те же товары смотрят тысячи людей.',
        'Next you hit the database. Adding replicas is expensive. Notice: the catalog is read far more often than it changes, and the same products are viewed by thousands of people.',
        '接下来瓶颈会落到数据库上。增加副本很贵。注意：目录被读取的次数远多于被修改的次数，而且同样的商品会被成千上万的人浏览。',
      ),
      tr(
        'Нужен компонент, который держит недавние ответы базы в памяти и отдаёт их сам. Ему место рядом с каталогом: каталог сначала спрашивает его, идёт в базу только при промахе и кладёт ответ ему же.',
        'You need a component that keeps recent database answers in memory and serves them itself. It belongs next to the catalog: the catalog asks it first, goes to the database only on a miss, and puts the answer into it.',
        '你需要一个组件：把数据库最近的应答保存在内存里，并直接返回。它应该放在目录服务旁边：目录先问它，未命中时才去数据库，再把结果放进去。',
      ),
    ],
    debrief: [
      tr(
        'Горизонтальное масштабирование stateless-сервиса — самое дешёвое. Узким местом почти всегда становится состояние, то есть база. Для read-heavy нагрузки кэш дешевле реплик и заодно снижает латентность.',
        'Scaling a stateless service horizontally is the cheapest option. The bottleneck is almost always state, i.e. the database. For read-heavy workloads a cache is cheaper than replicas and lowers latency too.',
        '对无状态服务做水平扩展是最便宜的。瓶颈几乎总是出在状态上，也就是数据库。对于读多写少的负载，缓存比副本更便宜，还能顺带降低延迟。',
      ),
      tr(
        'Обратите внимание на нелинейность: при загрузке 95% латентность в 20 раз выше базовой. Ёмкость планируют с запасом 30–40%.',
        'Note the non-linearity: at 95% utilization latency is 20× the baseline. Capacity is planned with 30–40% headroom.',
        '注意这种非线性：利用率达到 95% 时，延迟是基线的 20 倍。规划容量时要留出 30–40% 的余量。',
      ),
    ],
    hitRatio: { cache: 0.8 },
    solution: {
      nodes: [
        n('c1', 'client', tr('Покупатели', 'Shoppers', '顾客'), 40, 220, { rps: 3000, workload: 'oltp', writeShare: 0.05 }),
        n('s1', 'service', tr('Каталог', 'Catalog', '目录'), 380, 220, { ...svc('fast'), instances: 15 }),
        n('k1', 'cache', 'Redis', 580, 120, { hitRatio: 0.8 }),
        n('d1', 'postgres', 'PostgreSQL', 760, 220),
      ],
      edges: [...chain('c1', 's1', 'k1'), ...chain('s1', 'd1')],
    },
  },
  {
    id: 'payments',
    title: tr('Медленный платёжный провайдер', 'Slow Payment Provider', '缓慢的支付服务商'),
    group: 'Классика',
    brief: [
      tr(
        'Заказ оформляется так: сервис заказов синхронно вызывает платёжный шлюз внешнего провайдера, а тот отвечает за 300 мс. Клиенты ждут, конверсия падает. Нужно, чтобы оформление заказа отвечало **быстрее 150 мс**, причём необработанные оплаты не должны копиться. Бюджет — **$1100**.',
        'Checkout works like this: the order service synchronously calls an external provider\'s payment gateway, which takes 300 ms to respond. Customers wait and conversion drops. Checkout must respond **in under 150 ms**, and payments must be processed without a growing backlog. Budget: **$1100**.',
        '下单流程是这样的：订单服务同步调用外部服务商的支付网关，对方需要 300 ms 才能响应。顾客只能干等，转化率随之下降。下单必须在 **150 ms 以内**响应，并且支付处理不能出现越积越多的积压。预算：**$1100**。',
      ),
    ],
    nodes: [
      n('c1', 'client', tr('Покупатели', 'Shoppers', '顾客'), 30, 220, { rps: 800, workload: 'oltp', writeShare: 1 }),
      n('g1', 'gateway', 'Gateway', 220, 220),
      n('s1', 'service', tr('Заказы', 'Orders', '订单'), 420, 220, { ...svc('fast'), instances: 3 }),
      n('s2', 'service', tr('Платежи', 'Payments', '支付'), 820, 220, { ...svc('external'), instances: 8 }),
    ],
    edges: [
      { id: 'e1', from: 'c1', to: 'g1' },
      { id: 'e2', from: 'g1', to: 's1' },
      { id: 'e3', from: 's1', to: 's2' },
    ],
    budget: 1100,
    locked: ['c1', 'g1', 's1', 's2'],
    goals: [
      { text: tr('Успешных ответов ≥ 99%', 'Successful responses ≥ 99%', '成功响应 ≥ 99%'), check: (r) => r.clientSuccess >= 0.99 },
      { text: tr('Латентность ≤ 150 мс', 'Latency ≤ 150 ms', '延迟 ≤ 150 ms'), check: lat('c1', 150) },
      { text: tr('Необработанные оплаты не копятся', 'Unprocessed payments do not pile up', '未处理的支付不会积压'), check: (r) => r.backlogGrowth < 1 },
    ],
    paths: [{ from: 's1', to: 's2', text: tr('Каждый заказ доходит до Платежей', 'Every order reaches Payments', '每个订单都会到达“支付”') }],
    hints: [
      tr(
        'Сколько экземпляров платёжного шлюза ни добавляй, 300 мс провайдера никуда не денутся. Значит, покупатель не должен их ждать.',
        'No matter how many payment gateway instances you add, the provider\'s 300 ms won\'t go away. So the shopper must not wait for them.',
        '无论给支付网关加多少实例，服务商的 300 ms 都不会消失。所以不能让顾客等这 300 ms。',
      ),
      tr(
        'Нужен посредник, который принимает заявку на оплату мгновенно, надёжно её хранит и отдаёт платежам, когда те готовы её взять.',
        'You need an intermediary that accepts a payment request instantly, stores it durably and hands it to Payments when they are ready to take it.',
        '你需要一个中间环节：它立即接收支付请求，把它可靠地保存下来，等“支付”准备好接手时再交给它。',
      ),
      tr(
        'Разорвите прямую связь Заказы → Платежи и вставьте этого посредника между ними. И проверьте, что платежей хватает на весь поток, иначе необработанные заявки будут копиться.',
        'Break the direct Orders → Payments connection and put that intermediary in between. Then check that Payments can handle the whole stream, or unprocessed requests will pile up.',
        '断开“订单 → 支付”的直接连接，把这个中间环节放在两者之间。然后检查“支付”能否处理全部请求流，否则未处理的请求会越积越多。',
      ),
    ],
    debrief: [
      tr(
        'Асинхронная связь через брокер развязывает латентность: клиент получает «заказ принят» сразу, а оплата идёт в фоне. Цена — **eventual consistency**: статус «оплачен» появится позже, и UI должен это уметь показывать.',
        'Asynchronous communication through a broker decouples latency: the client gets "order accepted" immediately while payment runs in the background. The price is **eventual consistency**: the "paid" status shows up later, and the UI must be able to display that.',
        '通过 Broker 进行异步通信，可以把延迟解耦：客户端立即收到“订单已受理”，支付则在后台进行。代价是**最终一致性**：“已支付”状态会稍后才出现，UI 需要能展示这一点。',
      ),
      tr(
        'Очередь не добавляет мощности. Если потребители медленнее потока, бэклог растёт бесконечно. Асинхронность сглаживает пики, но не отменяет capacity planning.',
        'A queue adds no capacity. If consumers are slower than the incoming stream, the backlog grows forever. Asynchrony smooths out peaks but does not replace capacity planning.',
        '队列本身不会增加处理能力。如果消费者比流入的速度慢，积压就会无限增长。异步能削平峰值，但不能代替容量规划。',
      ),
      tr(
        'В реальных магазинах так асинхронно делают не всю оплату. Авторизацию карты (3-D Secure, «недостаточно средств») проводят синхронно, пока покупатель на странице, — иначе отказ придёт после «заказ принят». В фон уходят списание (capture), чек, фискализация и выгрузка в учётную систему.',
        'Real stores do not make the whole payment asynchronous. Card authorization (3-D Secure, “insufficient funds”) runs synchronously while the buyer is on the page, otherwise the decline arrives after “order accepted”. Capture, receipts, fiscal reporting and ERP export go to the background.',
        '真实的商店并不会把整个支付流程都做成异步。银行卡授权（3-D Secure、“余额不足”）要在买家还停留在页面上时同步完成，否则拒付通知会在“订单已受理”之后才到达。扣款（capture）、开具收据、税务申报和导出到 ERP 则放到后台处理。',
      ),
    ],
    hitRatio: {},
    solution: {
      nodes: [
        n('c1', 'client', tr('Покупатели', 'Shoppers', '顾客'), 30, 220, { rps: 800, workload: 'oltp', writeShare: 1 }),
        n('g1', 'gateway', 'Gateway', 220, 220),
        n('s1', 'service', tr('Заказы', 'Orders', '订单'), 420, 220, { ...svc('fast'), instances: 4 }),
        n('q1', 'queue', 'Kafka', 620, 120),
        n('s2', 'service', tr('Платежи', 'Payments', '支付'), 820, 220, { ...svc('external'), instances: 8 }),
      ],
      edges: [...chain('c1', 'g1', 's1', 'q1', 's2')],
    },
  },

  {
    id: 'catalog-search',
    title: tr('Поиск по каталогу', 'Catalog Search', '商品目录搜索'),
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
      [
        '商店在不断增长：商品页面有 **3,000 rps**，搜索有 **1,500 rps**。目前搜索是在 PostgreSQL 的商品表上做 `LIKE` 查询，数据库已经喘不过气来。',
        '商品页面必须在 **80 ms** 内打开，搜索必须在 **60 ms** 内完成。预算：**每月 $1100**。目录服务和数据库可以修改，但不能删除。',
      ],
    ),
    nodes: [
      n('c1', 'client', tr('Страницы товаров', 'Product pages', '商品页面'), 40, 120, { rps: 3000, workload: 'oltp', writeShare: 0.02 }),
      n('c2', 'client', tr('Поиск', 'Search', '搜索'), 40, 360, { rps: 1500, workload: 'search', writeShare: 0 }),
      n('s1', 'service', tr('Каталог', 'Catalog', '目录'), 380, 240, { ...svc('fast'), instances: 4 }),
      n('d1', 'postgres', 'PostgreSQL', 760, 240),
    ],
    edges: [
      { id: 'e1', from: 'c1', to: 's1' },
      { id: 'e2', from: 'c2', to: 's1' },
      { id: 'e3', from: 's1', to: 'd1' },
    ],
    budget: 1100,
    locked: ['c1', 'c2', 's1', 'd1'],
    tunable: ['s1'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%', '成功响应 ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Страница товара ≤ 80 мс', 'Product page ≤ 80 ms', '商品页面 ≤ 80 ms'), check: lat('c1', 80) },
      { text: tr('Поиск ≤ 60 мс', 'Search ≤ 60 ms', '搜索 ≤ 60 ms'), check: lat('c2', 60) },
      { text: tr('Товары и поиск обслуживаются подходящими хранилищами', 'Products and search are served by suitable storage', '商品和搜索都由合适的存储来处理'), check: persisted('c1', 'c2') },
    ],
    paths: [{ from: 's1', to: 'd1', text: tr('Каталог хранит товары в PostgreSQL', 'Catalog stores products in PostgreSQL', '目录把商品存放在 PostgreSQL 中') }],
    hints: [
      tr(
        'Откройте свойства PostgreSQL: какую долю запросов он обрабатывает неэффективно? Поиск по тексту — это не то, для чего он создан.',
        'Open PostgreSQL\'s properties: which share of requests does it handle inefficiently? Text search is not what it was built for.',
        '打开 PostgreSQL 的属性：它处理哪一部分请求的效率很低？文本搜索并不是它的设计初衷。',
      ),
      tr(
        'Для поиска нужно хранилище, которое заранее строит индекс «слово → документы» и понимает морфологию и опечатки. Найдите в палитре то, у кого в таблице «подходит для» родной профиль — поиск. Подключите его к каталогу: сервис сам отправит туда поисковые запросы.',
        'Search needs a store that builds a "word → documents" index in advance and understands word forms and typos. Find the palette item whose "good for" table lists search as native. Connect it to the catalog: the service will route search queries there by itself.',
        '搜索需要这样一种存储：它会预先建立“词 → 文档”的索引，并且能理解词形变化和拼写错误。在组件面板里找一找，哪个组件的“适合的负载”表把搜索列为“原生”。把它连接到目录服务：服务会自动把搜索请求发过去。',
      ),
      tr(
        'Бюджета на реплики не хватит. Популярные товары и запросы повторяются — поставьте рядом с сервисом то, что отвечает из памяти на повторы. И сделайте сервис лёгким.',
        'The budget won\'t cover replicas. Popular products and queries repeat — put something next to the service that answers repeats from memory. And make the service a light one.',
        '预算不够加副本。热门商品和查询会反复出现：在服务旁边放一个能从内存直接回答重复请求的东西。另外，把服务类型换成“轻量无状态”。',
      ),
    ],
    debrief: [
      tr(
        'Polyglot persistence: у каждого типа запросов — своё хранилище. Источник истины — PostgreSQL, а поисковый индекс в Elasticsearch строится из него (обычно через CDC или события) и может отставать на секунды.',
        'Polyglot persistence: each query type gets its own store. PostgreSQL is the source of truth, and the Elasticsearch index is built from it (usually via CDC or events) and may lag by seconds.',
        '多语言持久化（polyglot persistence）：每种查询都有自己的存储。PostgreSQL 是唯一可信的数据源，Elasticsearch 的索引从它构建而来（通常通过 CDC 或事件），可能会落后几秒钟。',
      ),
      tr(
        'Кэш рядом с сервисом дешевле, чем реплики: при 80% попаданий в базу и поиск доходит пятая часть запросов.',
        'A cache next to the service is cheaper than replicas: with an 80% hit ratio only a fifth of requests reach the database and search.',
        '在服务旁边加缓存，比加副本更便宜：命中率为 80% 时，只有五分之一的请求会到达数据库和搜索。',
      ),
    ],
    hitRatio: { cache: 0.8 },
    solution: {
      nodes: [
        n('c1', 'client', tr('Страницы товаров', 'Product pages', '商品页面'), 40, 120, { rps: 3000, workload: 'oltp', writeShare: 0.02 }),
        n('c2', 'client', tr('Поиск', 'Search', '搜索'), 40, 360, { rps: 1500, workload: 'search', writeShare: 0 }),
        n('s1', 'service', tr('Каталог', 'Catalog', '目录'), 380, 240, { ...svc('light'), instances: 6 }),
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
    id: 'reports-db',
    title: tr('Отчёты убивают базу заказов', 'Reports Are Killing the Orders DB', '报表拖垮了订单数据库'),
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
      [
        '订单服务要处理 **1,500 rps**。分析师把 BI 仪表盘接到了同一个数据库上：每秒只有 **40** 次查询，但每次都要对数百万行做聚合。从那以后，订单处理变慢，还频繁报错。',
        '订单必须在 **100 ms** 内完成，仪表盘必须在 **500 ms** 内完成。预算：**$1200**。“直接加副本”的方案超出预算。',
      ],
    ),
    nodes: [
      n('c1', 'client', tr('Заказы', 'Orders', '订单'), 40, 120, { rps: 1500, workload: 'oltp', writeShare: 0.5 }),
      n('c2', 'client', tr('BI-дашборды', 'BI dashboards', 'BI 仪表盘'), 40, 380, { rps: 40, workload: 'analytics', writeShare: 0 }),
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
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%', '成功响应 ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Заказы ≤ 100 мс', 'Orders ≤ 100 ms', '订单 ≤ 100 ms'), check: lat('c1', 100) },
      { text: tr('Дашборды ≤ 500 мс', 'Dashboards ≤ 500 ms', '仪表盘 ≤ 500 ms'), check: lat('c2', 500) },
      { text: tr('Данные хранятся в подходящих хранилищах', 'Data is persisted in suitable stores', '数据保存在合适的存储中'), check: persisted('c1', 'c2') },
    ],
    paths: [{ from: 's1', to: 'd1', text: tr('Заказы хранятся в PostgreSQL', 'Orders are stored in PostgreSQL', '订单存放在 PostgreSQL 中') }],
    hints: [
      tr(
        'Всего 40 запросов дашбордов роняют базу, которая держит тысячу заказов в секунду. Откройте её свойства: какой профиль она обрабатывает в двадцать раз хуже родного?',
        'Just 40 dashboard queries bring down a database that handles a thousand orders per second. Open its properties: which workload does it process twenty times worse than its native one?',
        '区区 40 个仪表盘查询，就拖垮了一个每秒能处理上千个订单的数据库。打开它的属性：哪种负载类型它处理起来比原生类型差二十倍？',
      ),
      tr(
        'Агрегат «сумма по региону за год» в строчной базе читает все поля всех строк. Нужна база, которая хранит каждое поле отдельно и сжимает его: тогда запрос читает только нужные столбцы.',
        'A "sum by region for the year" aggregate in a row store reads every field of every row. You need a database that stores each field separately and compresses it: then a query reads only the columns it needs.',
        '在按行存储的数据库里，“按地区汇总全年数据”这样的聚合要读取每一行的每一个字段。你需要一种把每个字段分开存放并加以压缩的数据库：这样查询只需读取它需要的那几列。',
      ),
      tr(
        'Подключите её к сервису заказов рядом с PostgreSQL — сервис сам отправит аналитику туда, где она обрабатывается эффективнее.',
        'Connect it to the order service next to PostgreSQL — the service will route analytics where it is processed most efficiently.',
        '把它连接到订单服务上，与 PostgreSQL 并列：服务会自动把分析查询发到处理效率最高的地方。',
      ),
    ],
    debrief: [
      tr(
        'Классическое разделение OLTP и OLAP: транзакции живут в PostgreSQL, аналитика — в колоночной базе (ClickHouse, BigQuery, Snowflake). Данные туда доставляют потоком изменений (CDC) или пакетной выгрузкой.',
        'The classic OLTP/OLAP split: transactions live in PostgreSQL, analytics in a columnar database (ClickHouse, BigQuery, Snowflake). Data gets there via a change stream (CDC) or batch exports.',
        '经典的 OLTP/OLAP 分离：事务数据放在 PostgreSQL，分析数据放在列式数据库（ClickHouse、BigQuery、Snowflake）。数据通过变更流（CDC）或批量导出同步过去。',
      ),
      tr(
        'Реплика PostgreSQL для отчётов спасает ненадолго: колоночное хранилище обрабатывает такие запросы на порядки эффективнее, а реплики приходится масштабировать вместе с аналитикой.',
        'A PostgreSQL replica for reports only helps for a while: a columnar store handles such queries orders of magnitude more efficiently, while replicas have to scale along with analytics.',
        '为报表单独准备一个 PostgreSQL 副本只能顶一阵子：列式存储处理这类查询的效率要高出几个数量级，而副本得随着分析负载一起扩展。',
      ),
    ],
    hitRatio: {},
    solution: {
      nodes: [
        n('c1', 'client', tr('Заказы', 'Orders', '订单'), 40, 120, { rps: 1500, workload: 'oltp', writeShare: 0.5 }),
        n('c2', 'client', tr('BI-дашборды', 'BI dashboards', 'BI 仪表盘'), 40, 380, { rps: 40, workload: 'analytics', writeShare: 0 }),
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
    title: tr('Профили: кэш не спасает', 'Profiles: Cache Is Not Enough', '用户资料：光靠缓存不够'),
    group: 'Классика',
    brief: tr(
      [
        'Сервис профилей отдаёт **6 000 rps**. Профилей десятки миллионов, и каждый читают редко — длинный хвост, — поэтому в кэш помещается малая часть, и он попадает только в **половине** случаев. PostgreSQL держит 1 000 rps на реплику, максимум — 5 реплик.',
        'Профиль должен открываться быстрее **50 мс**. Бюджет — **$1400**.',
      ],
      [
        'The profile service serves **6,000 rps**. There are tens of millions of profiles, each read rarely (a long tail), so only a small share fits in the cache, and it hits only **half** the time. PostgreSQL handles 1,000 rps per replica, with a maximum of 5 replicas.',
        'A profile must load in under **50 ms**. Budget: **$1400**.',
      ],
      [
        '用户资料服务承担 **6,000 rps**。资料有数千万份，每份都很少被读取（长尾），所以缓存里只放得下一小部分，命中率只有**一半**。PostgreSQL 每个副本能处理 1,000 rps，最多 5 个副本。',
        '用户资料必须在 **50 ms** 内打开。预算：**$1400**。',
      ],
    ),
    nodes: [
      n('c1', 'client', tr('Профили', 'Profiles', '用户资料'), 40, 240, { rps: 6000, workload: 'oltp', writeShare: 0.02 }),
      n('s1', 'service', 'Profile API', 380, 240, svc('fast')),
      n('d1', 'postgres', 'PostgreSQL', 760, 240),
    ],
    edges: [
      { id: 'e1', from: 'c1', to: 's1' },
      { id: 'e2', from: 's1', to: 'd1' },
    ],
    budget: 1400,
    locked: ['c1', 's1', 'd1'],
    tunable: ['s1'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%', '成功响应 ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Профиль ≤ 50 мс', 'Profile ≤ 50 ms', '用户资料 ≤ 50 ms'), check: lat('c1', 50) },
    ],
    paths: [{ from: 's1', to: 'd1', text: tr('Профили хранятся в PostgreSQL', 'Profiles are stored in PostgreSQL', '用户资料存放在 PostgreSQL 中') }],
    hints: [
      tr(
        '6 000 rps против базы с потолком 5 × 1 000 — одними репликами не справиться при любом бюджете.',
        '6,000 rps against a database capped at 5 × 1,000 — replicas alone cannot cope at any budget.',
        '6,000 rps 对上一个上限为 5 × 1,000 的数据库：无论预算多少，光靠副本都扛不住。',
      ),
      tr(
        'Половина запросов повторяется. Что-то должно отвечать на них из памяти, не доходя до базы. Тогда базе останется 3 000 rps — сколько реплик нужно, чтобы загрузка была комфортной?',
        'Half of the requests repeat. Something has to answer them from memory without reaching the database. That leaves 3,000 rps for the database — how many replicas keep utilization comfortable?',
        '有一半请求是重复的。需要有个东西直接从内存回答它们，不必访问数据库。这样数据库只剩 3,000 rps：需要多少个副本，才能让利用率保持在舒适范围？',
      ),
      tr(
        'Сервис тоже должен выдерживать 6 000 rps без перегрева — посмотрите на его профили.',
        'The service must also sustain 6,000 rps without overheating — look at its profiles.',
        '服务本身也得扛住 6,000 rps 而不过载：看看它有哪些服务类型可选。',
      ),
    ],
    debrief: [
      tr(
        'Кэш и реплики не взаимозаменяемы, а дополняют друг друга. Кэш снимает повторяющиеся чтения, реплики масштабируют то, что кэш не закрывает. При низкой доле попаданий нужны оба.',
        'Caches and replicas are not interchangeable; they complement each other. The cache absorbs repeated reads, replicas scale whatever the cache doesn\'t cover. With a low hit ratio you need both.',
        '缓存和副本不能互相替代，而是互为补充。缓存吸收重复读取，副本则扩展缓存覆盖不到的部分。命中率低时，两者都需要。',
      ),
      tr(
        'Проверьте и обратную ошибку: пять реплик без кэша дороже и всё равно не справятся с 6 000 rps.',
        'Check the opposite mistake too: five replicas without a cache cost more and still can\'t handle 6,000 rps.',
        '也检查一下相反的错误：不加缓存、只用五个副本，花费更多，却仍然扛不住 6,000 rps。',
      ),
    ],
    hitRatio: { cache: 0.5 },
    solution: {
      nodes: [
        n('c1', 'client', tr('Профили', 'Profiles', '用户资料'), 40, 240, { rps: 6000, workload: 'oltp', writeShare: 0.02 }),
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
    title: tr('Продажа билетов на концерт', 'Concert Ticket Sales', '演唱会门票开售'),
    group: 'Классика',
    brief: tr(
      [
        'Старт продаж на концерт: в первые минуты приходит **8 000** бронирований в секунду. Бронирование — транзакция: заказ берёт сразу несколько мест, и нельзя продать одно место дважды. Запись идёт только в primary PostgreSQL: обычная машина принимает около **1 000** бронирований в секунду, самая большая (×4) — около **4 000**. Реплики запись не ускоряют, а шардировать нельзя — места зала списываются в одной транзакции и живут в одной базе.',
        'Пик длится около пяти минут. Покупатель должен быстрее **100 мс** получить ответ «заявка принята», ни одна заявка не теряется, а необработанных заявок копится не больше **5 000** в секунду (за пик — около полутора миллионов, после пика разберутся). Бюджет — **$2900**.',
      ],
      [
        'Concert tickets go on sale: in the first minutes **8,000** bookings arrive per second. A booking is a transaction: an order takes several seats at once, and the same seat can\'t be sold twice. Writes go only to the PostgreSQL primary: a standard machine accepts about **1,000** bookings per second, the largest (×4) about **4,000**. Replicas do not speed up writes, and sharding is off the table: the hall\'s seats are taken in one transaction and live in one database.',
        'The peak lasts about five minutes. A buyer must get a "request accepted" response in under **100 ms**, no request may be lost, and unprocessed requests must pile up no faster than **5,000** per second (about one and a half million over the peak, drained afterwards). Budget: **$2900**.',
      ],
      [
        '演唱会门票开售：最初几分钟里，每秒涌入 **8,000** 个预订。一次预订就是一个事务：一个订单会同时占用多个座位，同一个座位不能卖两次。写入只能进入 PostgreSQL 主库（primary）：一台标准机器每秒大约能接收 **1,000** 个预订，最大的机器（×4）约 **4,000** 个。副本不能加速写入，也不能分片：场馆的座位在同一个事务里扣减，必须放在同一个数据库中。',
        '高峰大约持续五分钟。买家必须在 **100 ms** 内收到“申请已受理”的响应，任何申请都不能丢失，未处理申请的积压速度每秒不得超过 **5,000** 个（整个高峰期约一百五十万个，高峰过后再慢慢处理完）。预算：**$2900**。',
      ],
    ),
    nodes: [
      n('c1', 'client', tr('Бронирование', 'Bookings', '预订'), 30, 240, { rps: 8000, workload: 'oltp', writeShare: 1 }),
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
    tunable: ['s1'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%', '成功响应 ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Ответ «заявка принята» ≤ 100 мс', '"Request accepted" response ≤ 100 ms', '“申请已受理”响应 ≤ 100 ms'), check: lat('c1', 100) },
      { text: tr('Необработанные заявки копятся не быстрее 5 000 в секунду', 'Unprocessed requests pile up no faster than 5,000 per second', '未处理申请的积压速度不超过每秒 5,000 个'), check: (r) => r.backlogGrowth <= 5000 },
      {
        text: tr(
          'PostgreSQL загружен не больше чем на 90% — воркеры не пишут быстрее, чем база принимает',
          'PostgreSQL utilization ≤ 90% — workers don\'t write faster than the database can accept',
          'PostgreSQL 利用率 ≤ 90%：工作进程的写入速度不超过数据库的承受能力',
        ),
        check: (r) => (r.nodes['d1']?.util ?? Infinity) <= 0.9,
      },
      { text: tr('Бронирования сохраняются в БД', 'Bookings are persisted in the DB', '预订已保存到数据库'), check: persisted('c1') },
      {
        text: tr('PostgreSQL без шардов: места зала списываются в одной транзакции', 'PostgreSQL without shards: the hall\'s seats are taken in one transaction', 'PostgreSQL 不分片：场馆座位在同一个事务里扣减'),
        check: (r) => (r.nodes['d1']?.shards ?? 1) === 1,
      },
    ],
    paths: [{ from: 's1', to: 'd1', text: tr('Бронирования доходят до PostgreSQL', 'Bookings reach PostgreSQL', '预订最终写入 PostgreSQL') }],
    hints: [
      tr(
        'Запись идёт только в primary: реплики её не ускоряют, а самая большая машина принимает 4 000 в секунду — вдвое меньше пика. Значит, покупатель не должен ждать базу.',
        'Writes go only to the primary: replicas don\'t speed them up, and the largest machine accepts 4,000 per second, half the peak. So the buyer must not wait for the database.',
        '写入只能进入主库：副本无法加速写入，而最大的机器每秒也只能接收 4,000 个，只有峰值的一半。所以不能让买家等数据库。',
      ),
      tr(
        'Нужно место, куда API мгновенно кладёт заявку и сразу отвечает «заявка принята», а отдельные обработчики забирают заявки с той скоростью, которую выдерживает база.',
        'You need a place where the API drops a request instantly and immediately replies "request accepted", while separate workers pick requests up at the rate the database can sustain.',
        '你需要这样一个地方：API 把申请往里一放，立刻回复“申请已受理”；再由单独的工作进程按数据库能承受的速度把申请取出来处理。',
      ),
      tr(
        'Обработчиков должно быть ровно столько, чтобы primary не перегревался (до 90% загрузки). Заявки копятся на разницу между пиком и этой скоростью — чем быстрее принимает primary, тем меньше копится. Какой машины для этого хватит?',
        'Run just enough workers to keep the primary below 90% utilization. Requests accumulate by the difference between the peak and that rate; the faster the primary accepts, the less piles up. Which machine is enough for that?',
        '工作进程的数量要恰到好处，让主库利用率保持在 90% 以下。申请积压的速度等于峰值与这个处理速度之差：主库接收得越快，积压就越少。哪种机器足够用？',
      ),
    ],
    debrief: [
      tr(
        'Queue-based load leveling: очередь принимает пик сразу, а обработка идёт с постоянной скоростью, которую выдерживает самое узкое место. Клиент получает «заявка принята», а результат — уведомлением.',
        'Queue-based load leveling: the queue absorbs the peak immediately, while processing runs at a steady rate the narrowest bottleneck can sustain. The client gets "request accepted" and the result arrives as a notification.',
        '基于队列的削峰填谷（Queue-based load leveling）：队列立刻吸收峰值，而处理则以最窄瓶颈能承受的稳定速度进行。客户端先收到“申请已受理”，结果稍后以通知的形式送达。',
      ),
      tr(
        'Важно не дать воркерам перегрузить базу: их число ограничивают пропускной способностью primary. Реплики тут бесполезны — они масштабируют чтение, а не запись; вертикальный рост упирается в самую большую машину. На интервью добавляют виртуальную очередь ожидания на входе (waiting room) и резервирование мест с таймаутом.',
        'It\'s important not to let workers overload the database: their count is capped by the primary\'s throughput. Replicas are useless here: they scale reads, not writes, and vertical growth stops at the largest machine. In interviews, people add a virtual waiting room at the entrance and seat reservations with a timeout.',
        '关键是别让工作进程压垮数据库：它们的数量受主库吞吐量的限制。副本在这里没用：它们扩展的是读，而不是写；垂直扩展也会止步于最大的机器。面试时，人们还会在入口加一个虚拟等候室（waiting room），并给座位预留设置超时。',
      ),
    ],
    hitRatio: {},
    solution: {
      nodes: [
        n('c1', 'client', tr('Бронирование', 'Bookings', '预订'), 30, 240, { rps: 8000, workload: 'oltp', writeShare: 1 }),
        n('g1', 'gateway', 'Gateway', 220, 240, { instances: 4 }),
        n('s1', 'service', 'Booking API', 420, 240, { ...svc('light'), instances: 10 }),
        n('q1', 'queue', 'Kafka', 420, 420),
        n('w1', 'service', tr('Воркеры брони', 'Booking workers', '预订工作进程'), 620, 420, { ...svc('fast'), instances: 11 }),
        n('d1', 'postgres', 'PostgreSQL', 820, 240, { size: 4 }),
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
    id: 'slow-home',
    title: tr('Главная страница тормозит', 'The home page is slow', '首页加载缓慢'),
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
      [
        '商店首页每秒被打开 **5,000 次**，每次服务都要从 PostgreSQL 读取同样的横幅和商品推荐。数据库能处理 1,000 rps。',
        '首页必须在 **40 ms** 内打开。预算：**$650**，放不下额外的数据库副本。',
      ],
    ),
    nodes: [
      n('c1', 'client', tr('Главная страница', 'Home page', '首页'), 40, 240, { rps: 5000, workload: 'oltp', writeShare: 0 }),
      n('s1', 'service', tr('Витрина', 'Storefront', '店面'), 380, 240, { ...svc('light'), instances: 6 }),
      n('d1', 'postgres', 'PostgreSQL', 760, 240),
    ],
    edges: [
      { id: 'e1', from: 'c1', to: 's1' },
      { id: 'e2', from: 's1', to: 'd1' },
    ],
    budget: 650,
    locked: ['c1', 's1', 'd1'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%', '成功响应 ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Главная ≤ 40 мс', 'Home page ≤ 40 ms', '首页 ≤ 40 ms'), check: lat('c1', 40) },
    ],
    paths: [{ from: 's1', to: 'd1', text: tr('Витрина читает данные из PostgreSQL', 'Storefront reads its data from PostgreSQL', '店面从 PostgreSQL 读取数据') }],
    hints: [
      tr(
        'База получает 5 000 rps, а держит 1 000. Но посмотрите на данные: главная одинакова для всех и меняется раз в несколько минут.',
        'The database receives 5,000 rps but handles 1,000. Look at the data though: the home page is the same for everyone and changes every few minutes.',
        '数据库收到 5,000 rps，却只能处理 1,000。不过看看数据：首页对所有人都一样，而且每隔几分钟才变一次。',
      ),
      tr(
        'Нужен компонент, который держит готовые ответы в памяти и отвечает за миллисекунду; в базу сервис идёт только за тем, чего ещё нет в памяти. Реплики базы не влезут в бюджет.',
        'You need a component that keeps ready answers in memory and replies in a millisecond; the service goes to the database only for what is not in memory yet. Database replicas won\'t fit the budget.',
        '你需要一个组件：它把现成的应答保存在内存里，一毫秒就能回复；只有内存里还没有的内容，服务才会去数据库取。数据库副本放不进预算。',
      ),
      tr(
        'Подключите его к сервису витрины рядом с базой: сервис сначала спросит его, а при промахе пойдёт в базу.',
        'Connect it to the storefront service next to the database: the service asks it first and goes to the database on a miss.',
        '把它连接到店面服务上，与数据库并列：服务会先问它，找不到时再去查数据库。',
      ),
    ],
    debrief: [
      tr(
        'Redis — первое, что добавляют при повторяющихся чтениях: сервис сначала смотрит в кэш и идёт в базу только при промахе. 90% попаданий снимают с базы 90% нагрузки за цену одного небольшого инстанса.',
        'Redis is the first thing you add for repeated reads: the service checks the cache first and goes to the database only on a miss. A 90% hit ratio takes 90% of the load off the database for the price of one small instance.',
        '面对重复读取，Redis 是首选：服务先查缓存，未命中时才去数据库。90% 的命中率只需一台小实例的价格，就能替数据库卸掉 90% 的负载。',
      ),
      tr(
        'Главные вопросы при внедрении кэша — инвалидация и TTL: что делать, когда маркетинг поменял баннер, и сколько секунд устаревших данных допустимо.',
        'The key questions when introducing a cache are invalidation and TTL: what happens when marketing changes a banner, and how many seconds of stale data are acceptable.',
        '引入缓存时，关键问题是失效（invalidation）和 TTL：市场部换了横幅该怎么办，可以接受多少秒的过期数据。',
      ),
    ],
    hitRatio: { cache: 0.9 },
    solution: {
      nodes: [
        n('c1', 'client', tr('Главная страница', 'Home page', '首页'), 40, 240, { rps: 5000, workload: 'oltp', writeShare: 0 }),
        n('s1', 'service', tr('Витрина', 'Storefront', '店面'), 380, 240, { ...svc('light'), instances: 6 }),
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
    id: 'slow-images',
    title: tr('Картинки грузятся медленно', 'Images load slowly', '图片加载缓慢'),
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
      [
        '商品照片存放在对象存储中，来自全国各地的请求达到**每秒 20,000 次**。存储已经到了极限，图片加载缓慢。',
        '图片必须在 **20 ms** 内开始加载。预算：**$300**。',
      ],
    ),
    nodes: [
      n('c1', 'client', tr('Картинки', 'Images', '图片'), 40, 240, { rps: 20000, workload: 'blob', writeShare: 0 }),
      n('s3', 's3', 'S3', 760, 240),
    ],
    edges: [{ id: 'e1', from: 'c1', to: 's3' }],
    budget: 300,
    locked: ['c1', 's3'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%', '成功响应 ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Картинка ≤ 20 мс', 'Image ≤ 20 ms', '图片 ≤ 20 ms'), check: lat('c1', 20) },
    ],
    paths: [{ from: 'c1', to: 's3', text: tr('Оригиналы картинок остаются в хранилище', 'Original images stay in storage', '原始图片仍保留在存储中') }],
    hints: [
      tr(
        'Хранилище перегружено, но даже ещё один экземпляр не поможет: 40 мс до него никуда не денутся, а цель — 20 мс.',
        'The storage is overloaded, but even another instance won\'t help: the 40 ms to reach it won\'t go away, and the goal is 20 ms.',
        '存储已经过载，但再加一个实例也无济于事：访问它的 40 ms 不会消失，而目标是 20 ms。',
      ),
      tr(
        'Картинки одинаковы для всех и почти не меняются. Их можно держать копиями на серверах в каждом городе, рядом с покупателями.',
        'The images are the same for everyone and almost never change. Copies can be kept on servers in every city, close to the shoppers.',
        '图片对所有人都一样，而且几乎不会变化。可以在每个城市的服务器上各保存一份拷贝，离顾客更近。',
      ),
      tr(
        'Поставьте это между покупателями и хранилищем: до хранилища будут доходить только картинки, которых ещё нет рядом с пользователем.',
        'Put it between the shoppers and the storage: only images not yet near the user will reach the storage.',
        '把它放在顾客和存储之间：只有用户附近还没有的图片，请求才会到达存储。',
      ),
    ],
    debrief: [
      tr(
        'CDN кэширует статику на edge-серверах рядом с пользователями: задержка — единицы миллисекунд, а до хранилища доходит лишь доля запросов.',
        'A CDN caches static content on edge servers close to users: latency is a few milliseconds, and only a fraction of requests reach the storage.',
        'CDN 把静态内容缓存在靠近用户的边缘服务器上：延迟只有几毫秒，只有一小部分请求会到达存储。',
      ),
      tr(
        'При обновлении картинки в CDN делают версионированные URL (`photo.jpg?v=2`) или purge — иначе пользователи неделю будут видеть старую.',
        'When an image is updated, CDNs use versioned URLs (`photo.jpg?v=2`) or a purge — otherwise users will see the old one for a week.',
        '图片更新时，CDN 会使用带版本号的 URL（`photo.jpg?v=2`）或执行 purge（清除），否则用户在一周内看到的都会是旧图。',
      ),
    ],
    hitRatio: { cdn: 0.95 },
    solution: {
      nodes: [
        n('c1', 'client', tr('Картинки', 'Images', '图片'), 40, 240, { rps: 20000, workload: 'blob', writeShare: 0 }),
        n('cdn', 'cdn', 'CDN', 400, 240, { hitRatio: 0.95 }),
        n('s3', 's3', 'S3', 760, 240),
      ],
      edges: [...chain('c1', 'cdn', 's3')],
    },
  },
  {
    id: 'signup-email',
    title: tr('Регистрация ждёт письма', 'Sign-up waits for an email', '注册要等邮件'),
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
      [
        '用户注册后，服务会通过邮件服务商同步发送欢迎邮件，对方需要 **300 ms** 才能响应。注册因此变慢，而一旦服务商出故障，用户就完全无法注册。',
        '注册必须在 **100 ms** 内响应，邮件也不能积压。预算：**$700**。',
      ],
    ),
    nodes: [
      n('c1', 'client', tr('Регистрация', 'Sign-up', '注册'), 40, 240, { rps: 300, workload: 'oltp', writeShare: 1 }),
      n('s1', 'service', 'Users API', 340, 240, { ...svc('fast'), instances: 2 }),
      n('d1', 'postgres', 'PostgreSQL', 640, 420),
      n('s2', 'service', tr('Отправка писем', 'Email sender', '邮件发送'), 780, 160, { ...svc('external'), instances: 4 }),
    ],
    edges: [
      { id: 'e1', from: 'c1', to: 's1' },
      { id: 'e2', from: 's1', to: 'd1' },
      { id: 'e3', from: 's1', to: 's2' },
    ],
    budget: 700,
    locked: ['c1', 's1', 'd1', 's2'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%', '成功响应 ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Регистрация ≤ 100 мс', 'Sign-up ≤ 100 ms', '注册 ≤ 100 ms'), check: lat('c1', 100) },
      { text: tr('Письма не копятся', 'Emails don\'t pile up', '邮件不积压'), check: (r) => r.backlogGrowth < 1 },
    ],
    paths: [
      { from: 's1', to: 'd1', text: tr('Пользователи сохраняются в PostgreSQL', 'Users are stored in PostgreSQL', '用户存放在 PostgreSQL 中') },
      { from: 's1', to: 's2', text: tr('Каждый новый пользователь получает письмо', 'Every new user gets an email', '每个新用户都会收到邮件') },
    ],
    hints: [
      tr(
        'Регистрация ждёт письма 300 мс, а при сбое провайдера не проходит вовсе. Но разве пользователю нужно письмо, чтобы войти?',
        'Registration waits 300 ms for the email and fails completely when the provider is down. But does the user need the email to log in?',
        '注册要为邮件等 300 ms，服务商一宕机就彻底失败。可是，用户登录真的需要这封邮件吗？',
      ),
      tr(
        'Нужен посредник, который надёжно принимает событие «пользователь зарегистрирован» и хранит его, пока отправка писем его не заберёт — даже если провайдер лежит час.',
        'You need an intermediary that durably accepts a "user registered" event and keeps it until the email sender picks it up — even if the provider is down for an hour.',
        '你需要一个中间环节：它可靠地接收“用户已注册”事件，并一直保存，直到邮件发送服务把它取走，即使服务商宕机一小时也没关系。',
      ),
      tr(
        'Разорвите прямую связь Users API → Отправка писем и поставьте этот посредник между ними.',
        'Break the direct Users API → Email sending connection and put that intermediary in between.',
        '断开“Users API → 邮件发送”的直接连接，把这个中间环节放在两者之间。',
      ),
    ],
    debrief: [
      tr(
        'Брокер развязывает латентность и надёжность: регистрация не ждёт провайдера и не падает вместе с ним, а письмо уйдёт, когда тот поднимется.',
        'A broker decouples latency and reliability: sign-up doesn\'t wait for the provider and doesn\'t fail with it, and the email goes out once the provider is back up.',
        'Broker 把延迟和可靠性解耦：注册既不用等服务商，也不会跟着它一起失败；服务商恢复后，邮件照样会发出去。',
      ),
      tr(
        'Событие «пользователь зарегистрирован» потом пригодится и другим: аналитике, бонусной программе, антифроду — без изменений в Users API.',
        'The "user registered" event will later be useful to others too: analytics, the loyalty program, anti-fraud — with no changes to Users API.',
        '“用户已注册”事件以后对其他系统也有用：数据分析、会员积分计划、反欺诈，而且无需改动 Users API。',
      ),
    ],
    hitRatio: {},
    solution: {
      nodes: [
        n('c1', 'client', tr('Регистрация', 'Sign-up', '注册'), 40, 240, { rps: 300, workload: 'oltp', writeShare: 1 }),
        n('s1', 'service', 'Users API', 340, 240, { ...svc('fast'), instances: 2 }),
        n('d1', 'postgres', 'PostgreSQL', 640, 420),
        n('q1', 'queue', 'Kafka', 560, 80),
        n('s2', 'service', tr('Отправка писем', 'Email sender', '邮件发送'), 780, 160, { ...svc('external'), instances: 4 }),
      ],
      edges: [{ id: 'e1', from: 'c1', to: 's1' }, { id: 'e2', from: 's1', to: 'd1' }, ...chain('s1', 'q1', 's2')],
    },
  },
  {
    id: 'sensor-stream',
    title: tr('Поток показаний датчиков', 'A stream of sensor readings', '传感器读数流'),
    group: 'Инструменты',
    tool: 'cassandra',
    brief: tr(
      [
        'Сто тысяч датчиков на заводах присылают показания: **15 000 записей в секунду** по ключу «датчик + время». Транзакции и JOIN не нужны, зато поток растёт каждый месяц. Пульт диспетчера читает последнее значение конкретного датчика по ключу — быстро, точечно.',
        'Запись должна подтверждаться быстрее **50 мс**. Бюджет — **$2400**. PostgreSQL можно заменить.',
      ],
      [
        'A hundred thousand factory sensors send readings: **15,000 writes per second** keyed by "sensor + time". No transactions or JOINs are needed, but the stream grows every month. The dispatcher console reads the latest value of a specific sensor by key: fast point lookups.',
        'A write must be acknowledged in under **50 ms**. Budget: **$2400**. PostgreSQL may be replaced.',
      ],
      [
        '工厂里的十万个传感器不断发送读数：按“传感器 + 时间”为键，**每秒 15,000 次写入**。不需要事务和 JOIN，但数据流每个月都在增长。调度员控制台按键读取某个传感器的最新值：快速的单点查询。',
        '写入必须在 **50 ms** 内得到确认。预算：**$2400**。可以替换掉 PostgreSQL。',
      ],
    ),
    nodes: [
      n('c1', 'client', tr('Датчики', 'Sensors', '传感器'), 40, 240, { rps: 15000, workload: 'kv', writeShare: 1 }),
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
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%', '成功响应 ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Запись ≤ 50 мс', 'Write ≤ 50 ms', '写入 ≤ 50 ms'), check: lat('c1', 50) },
      { text: tr('Показания сохраняются', 'Readings are persisted', '读数已持久化保存'), check: persisted('c1') },
    ],
    paths: [],
    hints: [
      tr(
        'Пять реплик PostgreSQL дают на запись по ключу 4 000 rps — а нужно 15 000. Реплики масштабируют чтение, но не запись.',
        'Five PostgreSQL replicas give 4,000 rps for keyed writes — and you need 15,000. Replicas scale reads, not writes.',
        '五个 PostgreSQL 副本在按键写入上只能提供 4,000 rps，而你需要 15,000。副本扩展的是读，而不是写。',
      ),
      tr(
        'Нужна база, в которой каждый узел принимает запись, данные раскладываются по узлам по ключу, а новый узел линейно добавляет пропускную способность. JOIN и транзакции здесь не нужны.',
        'You need a database where every node accepts writes, data is spread across nodes by key, and each new node adds throughput linearly. JOINs and transactions are not needed here.',
        '你需要这样一种数据库：每个节点都能接收写入，数据按键分布到各个节点上，每增加一个节点，吞吐量就线性增长。这里不需要 JOIN 和事务。',
      ),
      tr(
        'Замените ею PostgreSQL и подберите число узлов так, чтобы загрузка была комфортной.',
        'Replace PostgreSQL with it and pick the number of nodes so that utilization stays comfortable.',
        '用它替换 PostgreSQL，并选好节点数量，让利用率保持在舒适范围。',
      ),
    ],
    debrief: [
      tr(
        'Cassandra (и ScyllaDB) созданы для огромного потока записей по ключу: каждый узел принимает запись, данные распределяются по кольцу, добавление узла добавляет пропускную способность.',
        'Cassandra (and ScyllaDB) are built for huge streams of keyed writes: every node accepts writes, data is distributed around a ring, and adding a node adds throughput.',
        'Cassandra（以及 ScyllaDB）专为海量的按键写入流而设计：每个节点都能接收写入，数据沿环分布，增加节点就能增加吞吐量。',
      ),
      tr(
        'Плата — модель данных под запросы: таблицы проектируют от того, как их будут читать (по датчику и интервалу времени), без JOIN и транзакций.',
        'The price is a query-driven data model: tables are designed around how they will be read (by sensor and time range), without JOINs or transactions.',
        '代价是数据模型要由查询驱动：表结构围绕读取方式来设计（按传感器和时间范围），不使用 JOIN 和事务。',
      ),
    ],
    hitRatio: {},
    solution: {
      nodes: [
        n('c1', 'client', tr('Датчики', 'Sensors', '传感器'), 40, 240, { rps: 15000, workload: 'kv', writeShare: 1 }),
        n('s1', 'service', 'Ingest API', 380, 240, { ...svc('light'), instances: 20 }),
        n('cs', 'cassandra', 'Cassandra', 760, 240, { instances: 5 }),
      ],
      edges: [...chain('c1', 's1', 'cs')],
    },
  },
  {
    id: 'classifieds',
    title: tr('Поиск по объявлениям', 'Classifieds search', '分类信息搜索'),
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
      [
        '一个分类信息网站：每秒有 **2,000** 次针对信息正文的全文搜索，另有 **1,000 rps** 用于查看信息卡片。目前搜索是在 PostgreSQL 上执行 `LIKE %…%`。',
        '搜索必须在 **60 ms** 内完成，信息卡片也必须在 **60 ms** 内打开。预算：**$1300**。',
      ],
    ),
    nodes: [
      n('c1', 'client', tr('Поиск', 'Search', '搜索'), 40, 120, { rps: 2000, workload: 'search', writeShare: 0 }),
      n('c2', 'client', tr('Карточки', 'Listing cards', '信息卡片'), 40, 360, { rps: 1000, workload: 'oltp', writeShare: 0.05 }),
      n('s1', 'service', tr('Объявления', 'Listings', '分类信息'), 380, 240, { ...svc('light'), instances: 4 }),
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
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%', '成功响应 ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Поиск ≤ 60 мс', 'Search ≤ 60 ms', '搜索 ≤ 60 ms'), check: lat('c1', 60) },
      { text: tr('Карточка ≤ 60 мс', 'Listing card ≤ 60 ms', '信息卡片 ≤ 60 ms'), check: lat('c2', 60) },
      { text: tr('Объявления и поиск обслуживаются подходящими хранилищами', 'Listings and search are served by suitable storage', '分类信息和搜索都由合适的存储来处理'), check: persisted('c1', 'c2') },
    ],
    paths: [{ from: 's1', to: 'd1', text: tr('Объявления хранятся в PostgreSQL', 'Listings are stored in PostgreSQL', '分类信息存放在 PostgreSQL 中') }],
    hints: [
      tr(
        '`LIKE %…%` не может использовать индекс: каждый поиск — полный проход по таблице. Посмотрите, во сколько раз PostgreSQL хуже обрабатывает этот профиль.',
        '`LIKE %…%` cannot use an index: every search is a full table scan. Check how many times worse PostgreSQL handles this workload.',
        '`LIKE %…%` 用不上索引：每次搜索都是全表扫描。看看 PostgreSQL 处理这种负载类型时效率差了多少倍。',
      ),
      tr(
        'Нужно хранилище, которое заранее раскладывает тексты на слова и строит индекс «слово → объявления», учитывает словоформы и ранжирует результаты.',
        'You need a store that splits texts into words in advance and builds a "word → listings" index, handles word forms and ranks the results.',
        '你需要这样一种存储：它预先把文本切分成词，建立“词 → 信息”的索引，能处理词形变化，并对结果进行排序。',
      ),
      tr(
        'Подключите его к сервису объявлений рядом с PostgreSQL — поиск уйдёт туда, карточки останутся в базе.',
        'Connect it to the listings service next to PostgreSQL — search goes there, cards stay in the database.',
        '把它连接到分类信息服务上，与 PostgreSQL 并列：搜索请求发往它，卡片仍留在数据库里。',
      ),
    ],
    debrief: [
      tr(
        'Elasticsearch (OpenSearch) строит инвертированный индекс: поиск по словам, морфология, опечатки, ранжирование, фасеты — то, чего реляционная база не умеет делать быстро.',
        'Elasticsearch (OpenSearch) builds an inverted index: word search, stemming, typo tolerance, ranking, facets — things a relational database can\'t do fast.',
        'Elasticsearch（OpenSearch）会构建倒排索引：按词搜索、词干提取、容错拼写、相关性排序、分面筛选，这些都是关系型数据库无法快速完成的。',
      ),
      tr(
        'Источником истины остаётся PostgreSQL, индекс наполняется из него (через CDC или события) и может отставать на секунды.',
        'PostgreSQL remains the source of truth; the index is populated from it (via CDC or events) and may lag by seconds.',
        'PostgreSQL 仍是唯一可信的数据源；索引的数据从它导入（通过 CDC 或事件），可能会落后几秒钟。',
      ),
    ],
    hitRatio: {},
    solution: {
      nodes: [
        n('c1', 'client', tr('Поиск', 'Search', '搜索'), 40, 120, { rps: 2000, workload: 'search', writeShare: 0 }),
        n('c2', 'client', tr('Карточки', 'Listing cards', '信息卡片'), 40, 360, { rps: 1000, workload: 'oltp', writeShare: 0.05 }),
        n('s1', 'service', tr('Объявления', 'Listings', '分类信息'), 380, 240, { ...svc('light'), instances: 4 }),
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
    id: 'revenue-dashboard',
    title: tr('Дашборд выручки', 'Revenue dashboard', '营收仪表盘'),
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
      [
        '一个财务仪表盘：每秒对订单历史发起 **100** 次聚合查询，按天、地区和品类统计营收。它由独立的 Analytics API 提供服务，但这个 API 读的是同一个数据库，而该数据库还要承接 **800 rps** 的订单。',
        '仪表盘必须在 **120 ms** 内响应，订单必须在 **100 ms** 内完成。预算：**$850**。',
      ],
    ),
    nodes: [
      n('c1', 'client', tr('Дашборд', 'Dashboard', '仪表盘'), 40, 120, { rps: 100, workload: 'analytics', writeShare: 0 }),
      n('c2', 'client', tr('Заказы', 'Orders', '订单'), 40, 380, { rps: 800, workload: 'oltp', writeShare: 0.5 }),
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
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%', '成功响应 ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Дашборд ≤ 120 мс', 'Dashboard ≤ 120 ms', '仪表盘 ≤ 120 ms'), check: lat('c1', 120) },
      { text: tr('Заказы ≤ 100 мс', 'Orders ≤ 100 ms', '订单 ≤ 100 ms'), check: lat('c2', 100) },
      { text: tr('Данные хранятся в подходящих хранилищах', 'Data is persisted in suitable stores', '数据保存在合适的存储中'), check: persisted('c1', 'c2') },
    ],
    paths: [{ from: 's1', to: 'd1', text: tr('Заказы хранятся в PostgreSQL', 'Orders are stored in PostgreSQL', '订单存放在 PostgreSQL 中') }],
    hints: [
      tr(
        'Агрегат «выручка по регионам за год» в строчной базе читает все поля всех строк. Посмотрите, насколько PostgreSQL хуже обрабатывает этот профиль.',
        'A "revenue by region for the year" aggregate in a row store reads every field of every row. Check how much worse PostgreSQL handles this workload.',
        '在按行存储的数据库里，“按地区统计全年营收”这样的聚合要读取每一行的每一个字段。看看 PostgreSQL 处理这种负载类型时效率差了多少。',
      ),
      tr(
        'Нужна база, которая хранит каждый столбец отдельно и сжатым: запрос читает только два-три нужных столбца из сотни. Поисковое хранилище тоже умеет агрегаты, но для тяжёлой аналитики оно медленнее.',
        'You need a database that stores each column separately and compressed: a query reads only the two or three columns it needs out of a hundred. A search store can aggregate too, but it is slower for heavy analytics.',
        '你需要一种把每一列分开存放并压缩的数据库：查询只需从上百列中读取它需要的两三列。搜索类存储也能做聚合，但做重型分析时更慢。',
      ),
      tr(
        'Подключите её к Analytics API вместо PostgreSQL.',
        'Connect it to the Analytics API instead of PostgreSQL.',
        '把它连接到 Analytics API，替代 PostgreSQL。',
      ),
    ],
    debrief: [
      tr(
        'ClickHouse — колоночная OLAP-база: агрегаты по миллиардам строк за доли секунды. Данные в неё обычно льются потоком из Kafka или через CDC из основной базы.',
        'ClickHouse is a columnar OLAP database: aggregates over billions of rows in fractions of a second. Data usually streams into it from Kafka or via CDC from the primary database.',
        'ClickHouse 是一款列式 OLAP 数据库：对数十亿行做聚合只需零点几秒。数据通常从 Kafka 流入，或通过 CDC 从主数据库同步过来。',
      ),
      tr(
        'Elasticsearch тоже умеет агрегации, но на тяжёлой аналитике по большим таблицам колоночное хранилище заметно быстрее и дешевле.',
        'Elasticsearch can do aggregations too, but for heavy analytics over large tables a columnar store is noticeably faster and cheaper.',
        'Elasticsearch 也能做聚合，但在大表上做重型分析时，列式存储明显更快、更便宜。',
      ),
    ],
    hitRatio: {},
    solution: {
      nodes: [
        n('c1', 'client', tr('Дашборд', 'Dashboard', '仪表盘'), 40, 120, { rps: 100, workload: 'analytics', writeShare: 0 }),
        n('c2', 'client', tr('Заказы', 'Orders', '订单'), 40, 380, { rps: 800, workload: 'oltp', writeShare: 0.5 }),
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
    id: 'doc-scans',
    title: tr('Сканы документов в базе', 'Document scans in the database', '文档扫描件存在数据库里'),
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
      [
        '客户上传和下载护照、合同的扫描件：**每秒 300 个文件**，另有 **200 rps** 用于文档卡片（谁上传的、何时上传、审核状态）。目前文件以 `bytea` 列的形式存放在 PostgreSQL 中。',
        '每个文件必须在 **100 ms** 内完成；预算：**$500**。',
      ],
    ),
    nodes: [
      n('c1', 'client', tr('Файлы', 'Files', '文件'), 40, 120, { rps: 300, workload: 'blob', writeShare: 0.3 }),
      n('c2', 'client', tr('Карточки', 'Document cards', '文档卡片'), 40, 360, { rps: 200, workload: 'oltp', writeShare: 0.05 }),
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
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%', '成功响应 ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Файл ≤ 100 мс', 'File ≤ 100 ms', '文件 ≤ 100 ms'), check: lat('c1', 100) },
      { text: tr('Файлы и карточки хранятся', 'Files and cards are persisted', '文件和卡片都已持久化保存'), check: persisted('c1', 'c2') },
    ],
    paths: [{ from: 's1', to: 'd1', text: tr('Карточки документов хранятся в PostgreSQL', 'Document cards are stored in PostgreSQL', '文档卡片存放在 PostgreSQL 中') }],
    hints: [
      tr(
        'Откройте свойства PostgreSQL: файлы он обрабатывает в пятьдесят раз хуже обычных строк, а ещё они раздувают бэкапы и репликацию.',
        'Open PostgreSQL\'s properties: it handles files fifty times worse than regular rows, and they also bloat backups and replication.',
        '打开 PostgreSQL 的属性：它处理文件的效率比普通行差五十倍，而且文件还会让备份和复制变得臃肿。',
      ),
      tr(
        'Нужно хранилище, которое кладёт файл целиком по ключу — дёшево, надёжно и без ограничений по объёму. В базе останется только ключ файла и метаданные.',
        'You need a store that keeps a whole file by key — cheaply, durably and without size limits. The database keeps only the file key and metadata.',
        '你需要这样一种存储：按键保存整个文件，便宜、可靠，而且没有容量限制。数据库里只保留文件的键和元数据。',
      ),
      tr(
        'Подключите его к Documents API рядом с PostgreSQL: файлы уйдут туда, карточки останутся в базе.',
        'Connect it to the Documents API next to PostgreSQL: files go there, cards stay in the database.',
        '把它连接到 Documents API 上，与 PostgreSQL 并列：文件发往它，卡片仍留在数据库里。',
      ),
    ],
    debrief: [
      tr(
        'Объектное хранилище (S3, MinIO, Yandex Object Storage) — правильное место для файлов: дёшево, надёжно, безгранично по объёму. В базе остаются метаданные и ключ объекта.',
        'Object storage (S3, MinIO, Yandex Object Storage) is the right place for files: cheap, durable, virtually unlimited in size. The database keeps the metadata and the object key.',
        '对象存储（S3、MinIO、Yandex Object Storage）才是存放文件的正确位置：便宜、可靠，容量几乎无限。数据库里保留元数据和对象的键。',
      ),
      tr(
        'Обычно файл даже не идёт через сервис: клиент получает предподписанную ссылку и загружает напрямую в S3.',
        'Usually the file doesn\'t even go through the service: the client gets a presigned URL and uploads directly to S3.',
        '通常文件甚至不经过服务：客户端拿到一个预签名 URL，直接上传到 S3。',
      ),
    ],
    hitRatio: {},
    solution: {
      nodes: [
        n('c1', 'client', tr('Файлы', 'Files', '文件'), 40, 120, { rps: 300, workload: 'blob', writeShare: 0.3 }),
        n('c2', 'client', tr('Карточки', 'Document cards', '文档卡片'), 40, 360, { rps: 200, workload: 'oltp', writeShare: 0.05 }),
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
    title: tr('Сокращатель ссылок', 'URL Shortener', '短链接服务'),
    group: 'System Design',
    source: { primer: 'pastebin' },
    brief: tr(
      [
        'Сервис коротких ссылок: пользователи создают **10 млн** ссылок в сутки, по каждой в среднем **10 переходов**. В пике трафик вдвое выше среднего. Переход по ссылке должен открываться быстрее **60 мс**, каждую ссылку нужно надёжно хранить. Бюджет — **$800 в месяц**.',
        'Нагрузка — это чтение и запись по ключу (короткий код → длинный URL). Транзакции и JOIN не нужны.',
      ],
      [
        'A URL shortening service: users create **10M** links per day, each followed **10 times** on average. Peak traffic is twice the average. A redirect must complete in under **60 ms**, and every link must be stored durably. Budget: **$800 per month**.',
        'The workload is keyed reads and writes (short code → long URL). No transactions or JOINs are needed.',
      ],
      [
        '一个短链接服务：用户每天创建 **10M** 个链接，每个链接平均被访问 **10 次**。峰值流量是平均值的两倍。跳转必须在 **60 ms** 内完成，每个链接都必须可靠地保存。预算：**每月 $800**。',
        '负载是按键读写（短码 → 长 URL）。不需要事务和 JOIN。',
      ],
    ),
    estimate: {
      question: tr('Сколько переходов в секунду в пике?', 'How many redirects per second at peak?', '峰值时每秒有多少次跳转？'),
      answer: 2315,
      unit: 'rps',
      formula: tr(
        '10 млн ссылок × 10 переходов = 100 млн в сутки; ÷ 86 400 с ≈ 1157 rps в среднем; × 2 в пике ≈ 2300 rps',
        '10M links × 10 redirects = 100M per day; ÷ 86,400 s ≈ 1,157 rps on average; × 2 at peak ≈ 2,300 rps',
        '10M 个链接 × 10 次跳转 = 每天 100M 次；÷ 86,400 s ≈ 平均 1,157 rps；峰值 × 2 ≈ 2,300 rps',
      ),
    },
    nodes: [
      n('c1', 'client', tr('Переходы', 'Redirects', '跳转'), 40, 140, { rps: 2315, workload: 'kv', writeShare: 0 }),
      n('c2', 'client', tr('Создание ссылок', 'Link creation', '创建链接'), 40, 340, { rps: 232, workload: 'kv', writeShare: 1 }),
    ],
    edges: [],
    budget: 800,
    locked: ['c1', 'c2'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%', '成功响应 ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Переход ≤ 60 мс', 'Redirect ≤ 60 ms', '跳转 ≤ 60 ms'), check: lat('c1', 60) },
      { text: tr('Ссылки сохраняются в хранилище', 'Links are persisted in storage', '链接已保存到存储中'), check: persisted('c1', 'c2') },
    ],
    paths: [],
    hints: [
      tr(
        'Начните с того, кто принимает трафик: сколько экземпляров сервиса нужно на ~2 500 rps с запасом, и какой профиль сервиса здесь уместен?',
        'Start with what takes the traffic: how many service instances do you need for ~2,500 rps with headroom, and which service profile fits here?',
        '先从承接流量的部分入手：要扛住约 2,500 rps 并留出余量，需要多少个服务实例？哪种服务类型适合这里？',
      ),
      tr(
        'Данные — пары «короткий код → длинный адрес»: только чтение и запись по ключу, без транзакций и JOIN, а объём растёт каждый день. Какое хранилище в палитре называет такую нагрузку родной?',
        'The data is "short code → long URL" pairs: only reads and writes by key, no transactions or JOINs, and the volume grows every day. Which storage in the palette lists this workload as native?',
        '数据是一对对“短码 → 长 URL”：只有按键读写，没有事务和 JOIN，而且数据量每天都在增长。组件面板里哪种存储把这种负载列为“原生”？',
      ),
      tr(
        'Переходов в 10 раз больше, чем созданий, и популярные ссылки открывают снова и снова. То, что отвечает на повторы из памяти, снимет почти всю нагрузку с хранилища.',
        'There are 10× more redirects than creations, and popular links are opened again and again. Something that answers repeats from memory will take almost all the load off the storage.',
        '跳转次数是创建次数的 10 倍，热门链接会被一遍又一遍地打开。一个能从内存直接回答重复请求的东西，可以替存储卸掉几乎全部负载。',
      ),
    ],
    debrief: [
      tr(
        'Классический read-heavy сервис: соотношение чтения к записи 10:1, данные не меняются после создания — идеально для кэша. Хранилище ключ-значение (Cassandra, DynamoDB) масштабируется линейно; PostgreSQL тоже справится, но на больших объёмах его придётся шардировать вручную.',
        'A classic read-heavy service: a 10:1 read-to-write ratio, and data never changes after creation — ideal for a cache. A key-value store (Cassandra, DynamoDB) scales linearly; PostgreSQL would cope too, but at large volumes you\'d have to shard it manually.',
        '典型的读多写少服务：读写比为 10:1，数据创建后就不再变化，非常适合缓存。键值存储（Cassandra、DynamoDB）可以线性扩展；PostgreSQL 也能应付，但数据量大了以后就得手动分片。',
      ),
      tr(
        'На интервью отдельно обсуждают генерацию короткого кода: счётчик + base62, хэш с проверкой коллизий или заранее сгенерированные коды.',
        'Interviews also discuss short code generation separately: a counter + base62, a hash with collision checks, or pre-generated codes.',
        '面试中还会单独讨论短码的生成方式：计数器 + base62、带冲突检查的哈希，或者预先生成的短码。',
      ),
    ],
    hitRatio: { cache: 0.9 },
    solution: {
      nodes: [
        n('c1', 'client', tr('Переходы', 'Redirects', '跳转'), 40, 140, { rps: 2315, workload: 'kv', writeShare: 0 }),
        n('c2', 'client', tr('Создание ссылок', 'Link creation', '创建链接'), 40, 340, { rps: 232, workload: 'kv', writeShare: 1 }),
        n('l1', 'lb', 'LB', 220, 240),
        n('s1', 'service', 'Shortener', 420, 240, { ...svc('light'), instances: 5 }),
        n('k1', 'cache', 'Redis', 620, 140, { hitRatio: 0.9 }),
        n('d1', 'cassandra', 'Cassandra', 820, 240),
      ],
      edges: [
        { id: 'a1', from: 'c1', to: 'l1' },
        { id: 'a2', from: 'c2', to: 'l1' },
        ...chain('l1', 's1', 'k1'),
        ...chain('s1', 'd1'),
      ],
    },
  },
  {
    id: 'feed',
    title: tr('Лента новостей', 'News Feed', '信息流'),
    group: 'System Design',
    source: { primer: 'twitter' },
    brief: [
      tr(
        'Соцсеть: **50 млн** активных пользователей в день, каждый открывает ленту **10 раз**. В пике нагрузка вдвое выше средней. Публикуют посты гораздо реже — около **120 в секунду** в пике, но каждый пост нужно разложить по лентам подписчиков, а их у автора в среднем **200**. Лента должна открываться быстрее **50 мс**. Бюджет — **$3400**.',
        'A social network: **50M** daily active users, each opening the feed **10 times**. Peak load is twice the average. Posts are published far less often — about **120 per second** at peak — but each post must be fanned out to followers\' feeds, and an author has **200** followers on average. The feed must load in under **50 ms**. Budget: **$3400**.',
        '一个社交网络：日活用户 **50M**，每人每天打开信息流 **10 次**。峰值负载是平均值的两倍。发帖要少得多，峰值约**每秒 120 条**，但每条帖子都要分发到关注者的信息流中，而每位作者平均有 **200** 个关注者。信息流必须在 **50 ms** 内打开。预算：**$3400**。',
      ),
    ],
    estimate: {
      question: tr('Сколько открытий ленты в секунду в пике?', 'How many feed opens per second at peak?', '峰值时每秒打开多少次信息流？'),
      answer: 11574,
      unit: 'rps',
      formula: tr(
        '50 млн × 10 = 500 млн открытий в сутки; ÷ 86 400 ≈ 5787 rps; × 2 в пике ≈ 11 600 rps',
        '50M × 10 = 500M opens per day; ÷ 86,400 ≈ 5,787 rps; × 2 at peak ≈ 11,600 rps',
        '50M × 10 = 每天打开 500M 次；÷ 86,400 ≈ 5,787 rps；峰值 × 2 ≈ 11,600 rps',
      ),
    },
    nodes: [
      n('c1', 'client', tr('Чтение ленты', 'Feed reads', '读取信息流'), 40, 140, { rps: 11574, workload: 'kv', writeShare: 0 }),
      n('c2', 'client', tr('Публикация постов', 'Post publishing', '发布帖子'), 40, 380, { rps: 120, workload: 'oltp', writeShare: 1, fanout: 200 }),
    ],
    edges: [],
    budget: 3400,
    locked: ['c1', 'c2'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%', '成功响应 ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Лента ≤ 50 мс', 'Feed ≤ 50 ms', '信息流 ≤ 50 ms'), check: lat('c1', 50) },
      { text: tr('Публикация не ждёт рассылки по лентам (≤ 100 мс)', 'Publishing doesn\'t wait for posts to reach followers\' feeds (≤ 100 ms)', '发布不必等帖子送达关注者的信息流（≤ 100 ms）'), check: lat('c2', 100) },
      { text: tr('Каждый пост разложен по лентам подписчиков', 'Every post is fanned out to followers’ feeds', '每条帖子都分发到了关注者的信息流'), check: (r) => r.fanoutDelivered },
      { text: tr('Раскладка постов по лентам не отстаёт', 'Distributing posts to feeds keeps up', '帖子分发到信息流的速度跟得上'), check: (r) => r.backlogGrowth < 1 },
      { text: tr('Посты и ленты сохраняются', 'Posts and feeds are persisted', '帖子和信息流都已持久化保存'), check: persisted('c1', 'c2') },
    ],
    paths: [],
    hints: [
      tr(
        'Чтение и запись здесь — разные задачи. Ленту читают по ключу (id пользователя) 11 тысяч раз в секунду, а посты — это транзакционные данные. Хранить их в одном месте не обязательно. Посчитайте и запись в ленты: 120 постов × 200 подписчиков.',
        'Reads and writes are different jobs here. Feeds are read by key (user id) 11,000 times per second, while posts are transactional data. They don\'t have to live in the same place. Count the feed writes too: 120 posts × 200 followers.',
        '这里的读和写是两回事。信息流按键（用户 id）每秒读取 11,000 次，而帖子是事务性数据。它们不必存在同一个地方。也算一算写入信息流的量：120 条帖子 × 200 个关注者。',
      ),
      tr(
        'Публикация не должна ждать, пока пост разложат по лентам всех подписчиков. Ей нужно отдать работу кому-то, кто сделает это позже, но гарантированно.',
        'Publishing must not wait until the post is placed into every follower\'s feed. It needs to hand the work to someone who will do it later, but reliably.',
        '发布不能等到帖子放进每个关注者的信息流之后才返回。它需要把这项工作交给别人，由对方稍后完成，但必须可靠地完成。',
      ),
      tr(
        'Для 11 тысяч rps на чтение нужны лёгкие сервисы и то, что отвечает на повторяющиеся запросы лент из памяти, чтобы до хранилища лент доходили только промахи.',
        'For 11,000 read rps you need light services and something that answers repeated feed requests from memory, so that only misses reach the feed store.',
        '要支撑每秒 11,000 次读取，你需要“轻量无状态”类型的服务，还需要一个能从内存直接回答重复请求的东西，让只有未命中的请求才到达信息流存储。',
      ),
    ],
    debrief: [
      tr(
        'Это CQRS в чистом виде: путь записи (пост в PostgreSQL, событие в очередь, воркеры раскладывают по лентам) и путь чтения (готовая лента из кэша и Cassandra) масштабируются независимо. Цена готовых лент — усиление записи: 120 постов превращаются в 24 000 записей в секунду, поэтому хранилище лент должно масштабировать запись узлами, а не репликами.',
        'This is CQRS in its purest form: the write path (post to PostgreSQL, event to a queue, workers fan out to feeds) and the read path (precomputed feed from the cache and Cassandra) scale independently. The price of precomputed feeds is write amplification: 120 posts become 24,000 writes per second, so the feed store must scale writes with nodes, not replicas.',
        '这是最纯粹的 CQRS：写路径（帖子写入 PostgreSQL，事件进入队列，工作进程把帖子分发到各个信息流）和读路径（从缓存和 Cassandra 读取预先算好的信息流）各自独立扩展。预先计算信息流的代价是写放大：120 条帖子会变成每秒 24,000 次写入，所以信息流存储必须靠增加节点来扩展写入，而不是靠副本。',
      ),
      tr(
        'На интервью обязательно всплывают знаменитости с миллионами подписчиков: для них fan-out on write слишком дорог, их посты подмешивают в ленту при чтении (гибридная модель).',
        'Celebrities with millions of followers always come up in interviews: fan-out on write is too expensive for them, so their posts are merged into the feed at read time (hybrid model).',
        '面试中一定会问到拥有数百万关注者的名人：对他们来说，写时扩散（fan-out on write）代价太高，所以他们的帖子在读取时再合并进信息流（混合模式）。',
      ),
    ],
    hitRatio: { cache: 0.9 },
    solution: {
      nodes: [
        n('c1', 'client', tr('Чтение ленты', 'Feed reads', '读取信息流'), 40, 140, { rps: 11574, workload: 'kv', writeShare: 0 }),
        n('c2', 'client', tr('Публикация постов', 'Post publishing', '发布帖子'), 40, 380, { rps: 120, workload: 'oltp', writeShare: 1, fanout: 200 }),
        n('l1', 'lb', 'LB', 220, 140),
        n('s1', 'service', 'Feed API', 400, 140, { ...svc('light'), instances: 14 }),
        n('k1', 'cache', 'Redis', 600, 60, { hitRatio: 0.9 }),
        n('d1', 'cassandra', tr('Ленты', 'Feeds', '信息流'), 820, 160, { instances: 8 }),
        n('s2', 'service', 'Post API', 220, 380, svc('fast')),
        n('d2', 'postgres', tr('Посты', 'Posts', '帖子'), 420, 460),
        n('q1', 'queue', 'Kafka', 420, 300),
        n('s3', 'service', 'Fan-out', 620, 300, svc('fast')),
      ],
      edges: [
        ...chain('c1', 'l1', 's1', 'k1'),
        ...chain('s1', 'd1'),
        ...chain('c2', 's2', 'd2'),
        ...chain('s2', 'q1', 's3', 'd1'),
      ],
    },
  },
  {
    id: 'notifications',
    title: tr('Система уведомлений', 'Notification System', '通知系统'),
    group: 'System Design',
    brief: [
      tr(
        'Единый сервис уведомлений для всей компании: push, SMS и email. В сутки уходит **10 млн** уведомлений, но маркетинговые рассылки дают пики в **25 раз** выше среднего. Внешние провайдеры отвечают по 300 мс и держат 100 запросов в секунду на соединение. Сервисы-отправители должны получать ответ «принято» быстрее **50 мс**, ни одно уведомление не теряется, журнал отправок хранится. Бюджет — **$2800**.',
        'A single notification service for the whole company: push, SMS and email. **10M** notifications go out per day, but marketing campaigns cause peaks **25×** above average. External providers take 300 ms to respond and handle 100 requests per second per connection. Sender services must get an "accepted" response in under **50 ms**, no notification may be lost, and a delivery log is persisted. Budget: **$2800**.',
        '一个面向全公司的统一通知服务：推送、短信和邮件。每天发出 **10M** 条通知，但营销活动会带来比平均值高 **25 倍**的峰值。外部服务商响应需要 300 ms，每个连接每秒能处理 100 个请求。发送方服务必须在 **50 ms** 内收到“已受理”的响应，任何通知都不能丢失，并且要保存发送日志。预算：**$2800**。',
      ),
    ],
    estimate: {
      question: tr('Сколько уведомлений в секунду в пике?', 'How many notifications per second at peak?', '峰值时每秒有多少条通知？'),
      answer: 2894,
      unit: tr('в секунду', 'per second', '条/秒'),
      formula: tr(
        '10 млн ÷ 86 400 ≈ 116 в секунду в среднем; × 25 в пике рассылки ≈ 2900',
        '10M ÷ 86,400 ≈ 116 per second on average; × 25 at campaign peak ≈ 2,900',
        '10M ÷ 86,400 ≈ 平均每秒 116 条；营销高峰 × 25 ≈ 2,900',
      ),
    },
    nodes: [n('c1', 'client', tr('Сервисы-отправители', 'Sender services', '发送方服务'), 40, 240, { rps: 2894, workload: 'kv', writeShare: 1 })],
    edges: [],
    budget: 2800,
    locked: ['c1'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%', '成功响应 ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Ответ «принято» ≤ 50 мс', '"Accepted" response ≤ 50 ms', '“已受理”响应 ≤ 50 ms'), check: lat('c1', 50) },
      { text: tr('Неотправленные уведомления не копятся', 'Undelivered notifications do not pile up', '未发送的通知不会积压'), check: (r) => r.backlogGrowth < 1 },
      { text: tr('Журнал отправок сохраняется', 'Delivery log is persisted', '发送日志已持久化保存'), check: persisted('c1') },
    ],
    paths: [],
    hints: [
      tr(
        'Отправителю не нужно ждать провайдера 300 мс — ему нужно только «принято». Что разрывает синхронную цепочку и гарантирует, что уведомление не потеряется?',
        'The sender does not need to wait 300 ms for the provider — it only needs "accepted". What breaks the synchronous chain and guarantees the notification is not lost?',
        '发送方不需要等服务商 300 ms，它只需要一句“已受理”。什么东西能切断这条同步调用链，同时保证通知不会丢失？',
      ),
      tr(
        'Провайдер держит 100 запросов в секунду на соединение, и упираетесь вы в соединения, а не в процессор: у воркеров отправки профиль «внешний API». Сколько соединений нужно, чтобы не отставать от пика?',
        'The provider handles 100 requests per second per connection, and you are limited by connections, not CPU: delivery workers use the "external API" profile. How many connections do you need to keep up with the peak?',
        '服务商每个连接每秒能处理 100 个请求，瓶颈在连接数而不是 CPU：发送工作进程的服务类型是“外部 API”。要跟上峰值，需要多少个连接？',
      ),
      tr(
        'Журнал отправок — огромный непрерывный поток записей по ключу, которые почти никогда не меняются. Выберите хранилище, для которого это родной профиль, и подумайте, кто знает, что уведомление действительно ушло.',
        'The delivery log is a huge continuous stream of keyed writes that almost never change. Pick the storage for which this is the native workload, and think about who knows the notification actually went out.',
        '发送日志是一股持续不断的海量按键写入流，写入后几乎不再修改。选一种把这种负载当作原生类型的存储，再想一想：谁才知道通知真的发出去了？',
      ),
    ],
    debrief: [
      tr(
        'Очередь здесь и буфер для пиков, и гарантия доставки: уведомление записано в Kafka — значит, оно уже не потеряется. Это единственная запись при приёме: если API писал бы ещё и в базу, получилась бы двойная запись без outbox — одна из двух может не случиться. Журнал пишут воркеры после ответа провайдера, тогда в нём правда, а не намерение.',
        'Here the queue is both a peak buffer and a delivery guarantee: once a notification is written to Kafka, it won\'t be lost. That is the only write on intake: if the API also wrote to the database, you would have a dual write without an outbox, and one of the two might not happen. Workers write the log after the provider responds, so it records facts, not intentions.',
        '这里的队列既是峰值缓冲，也是送达保证：通知一旦写入 Kafka，就不会再丢失。这是接收阶段唯一的一次写入：如果 API 还同时写数据库，就成了没有 Outbox 的双写，两次写入中可能有一次没有发生。日志由工作进程在服务商响应之后写入，所以记录的是事实，而不是意图。',
      ),
      tr(
        'На интервью добавляют ретраи с backoff, дедупликацию (одно уведомление дважды раздражает), лимиты частоты на пользователя и приоритеты: код подтверждения важнее рассылки.',
        'In interviews, add retries with backoff, deduplication (the same notification twice is annoying), per-user rate limits and priorities: a verification code matters more than a campaign.',
        '面试时还可以补充：带退避（backoff）的重试、去重（同一条通知收到两次会让人厌烦）、按用户的频率限制，以及优先级：验证码比营销推送更重要。',
      ),
    ],
    hitRatio: {},
    solution: {
      nodes: [
        n('c1', 'client', tr('Сервисы-отправители', 'Sender services', '发送方服务'), 40, 240, { rps: 2894, workload: 'kv', writeShare: 1 }),
        n('s1', 'service', 'Notification API', 240, 240, { ...svc('light'), instances: 5 }),
        n('d1', 'cassandra', tr('Журнал', 'Log', '日志'), 440, 400),
        n('q1', 'queue', 'Kafka', 440, 140),
        n('s2', 'service', tr('Воркеры отправки', 'Delivery workers', '发送工作进程'), 700, 140, { ...svc('external'), instances: 30 }),
      ],
      edges: [...chain('c1', 's1', 'q1', 's2', 'd1')],
    },
  },
  {
    id: 'video',
    title: tr('Видеохостинг', 'Video Hosting', '视频网站'),
    group: 'System Design',
    brief: [
      tr(
        '**5 млн** зрителей в день смотрят в среднем по **30 минут**. Видео отдаётся сегментами по **10 секунд**, вечерний пик втрое выше среднего. Загружают немного — около 5 видео в секунду, но каждое нужно перекодировать в несколько качеств: это минуты процессора на видео, своя ферма обошлась бы дороже всего бюджета. Перекодирование отдают облачному транскодеру — это внешний API: он принимает задание за 300 мс, а готовые файлы сам кладёт в хранилище. Каталог (названия, описания, лайки) — ещё **1500 rps**. Сегмент должен начинать отдаваться быстрее **30 мс**. Бюджет — **$1600**.',
        '**5M** viewers per day watch **30 minutes** on average. Video is served in **10-second** segments, and the evening peak is three times the average. Uploads are few — about 5 videos per second — but each must be transcoded into several qualities: minutes of CPU per video, and an in-house farm would cost more than the whole budget. Transcoding is handed to a cloud transcoder, an external API: it accepts a job in 300 ms and puts the finished files into storage itself. The catalog (titles, descriptions, likes) adds another **1,500 rps**. A segment must start streaming in under **30 ms**. Budget: **$1600**.',
        '每天有 **5M** 名观众，平均每人观看 **30 分钟**。视频切成每段 **10 秒**的片段传输，晚间高峰是平均值的三倍。上传量不大，每秒约 5 个视频，但每个视频都要转码成多种清晰度：每个视频要耗费几分钟 CPU，自建转码集群的花费会超过整个预算。转码交给云转码服务，它是一个外部 API：300 ms 内接受任务，转好的文件由它自己放进存储。目录（标题、简介、点赞）还要再加 **1,500 rps**。视频片段必须在 **30 ms** 内开始传输。预算：**$1600**。',
      ),
    ],
    estimate: {
      question: tr('Сколько видеосегментов в секунду отдаётся в пике?', 'How many video segments per second are served at peak?', '峰值时每秒要传输多少个视频片段？'),
      answer: 31250,
      unit: tr('в секунду', 'per second', '条/秒'),
      formula: tr(
        '30 мин = 180 сегментов на зрителя; 5 млн × 180 = 900 млн в сутки; ÷ 86 400 ≈ 10 400; × 3 в пике ≈ 31 000',
        '30 min = 180 segments per viewer; 5M × 180 = 900M per day; ÷ 86,400 ≈ 10,400; × 3 at peak ≈ 31,000',
        '30 min = 每位观众 180 个片段；5M × 180 = 每天 900M 个；÷ 86,400 ≈ 10,400；峰值 × 3 ≈ 31,000',
      ),
    },
    nodes: [
      n('c1', 'client', tr('Просмотр', 'Viewing', '观看'), 40, 100, { rps: 31250, workload: 'blob', writeShare: 0 }),
      n('c2', 'client', tr('Загрузка', 'Uploads', '上传'), 40, 260, { rps: 5, workload: 'blob', writeShare: 1 }),
      n('c3', 'client', tr('Каталог', 'Catalog', '目录'), 40, 420, { rps: 1500, workload: 'oltp', writeShare: 0.02 }),
    ],
    edges: [],
    budget: 1600,
    locked: ['c1', 'c2', 'c3'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%', '成功响应 ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Сегмент ≤ 30 мс', 'Segment ≤ 30 ms', '视频片段 ≤ 30 ms'), check: lat('c1', 30) },
      { text: tr('Перекодирование не копится', 'Transcoding doesn\'t pile up', '转码任务不积压'), check: (r) => r.backlogGrowth < 1 },
      { text: tr('Видео и каталог сохраняются', 'Videos and catalog are persisted', '视频和目录都已持久化保存'), check: persisted('c1', 'c2', 'c3') },
    ],
    paths: [],
    hints: [
      tr(
        'Видео — это файлы по мегабайту и больше. Посмотрите в таблицах «подходит для», какое хранилище считает файлы родными.',
        'Videos are files of a megabyte and more. Check the "good for" tables to see which storage treats files as native.',
        '视频是一兆字节甚至更大的文件。查看各组件的“适合的负载”表，找出哪种存储把文件当作原生类型。',
      ),
      tr(
        '31 тысяча сегментов в секунду из одного места — медленно и дорого, а цель — 30 мс. Популярное видео смотрят миллионы раз — его копии стоит держать рядом со зрителями.',
        '31,000 segments per second from a single place is slow and expensive, and the goal is 30 ms. Popular videos are watched millions of times — keep copies close to the viewers.',
        '从同一个地方每秒传输 31,000 个片段，又慢又贵，而目标是 30 ms。热门视频会被观看数百万次：把它们的拷贝放在离观众近的地方。',
      ),
      tr(
        'Перекодирование занимает минуты. Загрузка должна передать эту работу дальше и сразу ответить, а обработчик — отдавать задания транскодеру в своём темпе.',
        'Transcoding takes minutes. The upload must pass that work on and reply immediately, while a worker hands jobs to the transcoder at its own pace.',
        '转码要花好几分钟。上传应当把这项工作转交出去并立即回复，再由一个工作进程按自己的节奏把任务交给转码服务。',
      ),
    ],
    debrief: [
      tr(
        'Почти весь трафик видеохостинга обслуживает CDN: популярные сегменты лежат рядом со зрителем, в хранилище доходят только промахи. Метаданные живут отдельно, в обычной БД с кэшем.',
        'Almost all video hosting traffic is served by the CDN: popular segments sit close to the viewer, and only misses reach the storage. Metadata lives separately, in a regular DB with a cache.',
        '视频网站几乎所有的流量都由 CDN 承担：热门片段就在观众附近，只有未命中的请求才会到达存储。元数据单独存放，放在带缓存的普通数据库里。',
      ),
      tr(
        'Загрузка — асинхронный конвейер: файл в S3, событие в очередь, воркеры перекодируют в разные качества. На интервью обсуждают адаптивный битрейт (HLS/DASH), предподписанные ссылки на загрузку и стоимость трафика CDN.',
        'Upload is an asynchronous pipeline: file to S3, event to a queue, workers transcode into different qualities. Interviews cover adaptive bitrate (HLS/DASH), presigned upload URLs and CDN traffic costs.',
        '上传是一条异步流水线：文件存入 S3，事件进入队列，工作进程把视频转码成不同清晰度。面试中会讨论自适应码率（HLS/DASH）、预签名上传 URL 以及 CDN 流量成本。',
      ),
      tr(
        'Бюджет схемы — это серверы. Главные статьи расходов настоящего видеохостинга в него не вошли: перекодирование (минуты процессора или GPU на каждое видео) и трафик CDN — 31 тысяча сегментов в секунду это десятки гигабайт в секунду, счёт на сотни тысяч долларов в месяц.',
        'The diagram budget covers servers. The main costs of a real video host are not in it: transcoding (minutes of CPU or GPU per video) and CDN traffic, where 31,000 segments per second is tens of gigabytes per second and a bill in the hundreds of thousands of dollars a month.',
        '架构图里的预算只涵盖服务器。真实视频网站的主要成本并不在其中：转码（每个视频要耗费几分钟 CPU 或 GPU）和 CDN 流量。每秒 31,000 个片段意味着每秒几十 GB 的流量，每月账单高达数十万美元。',
      ),
    ],
    hitRatio: { cache: 0.8, cdn: 0.95 },
    solution: {
      nodes: [
        n('c1', 'client', tr('Просмотр', 'Viewing', '观看'), 40, 100, { rps: 31250, workload: 'blob', writeShare: 0 }),
        n('c2', 'client', tr('Загрузка', 'Uploads', '上传'), 40, 260, { rps: 5, workload: 'blob', writeShare: 1 }),
        n('c3', 'client', tr('Каталог', 'Catalog', '目录'), 40, 420, { rps: 1500, workload: 'oltp', writeShare: 0.02 }),
        n('cdn', 'cdn', 'CDN', 260, 60, { hitRatio: 0.95 }),
        n('s3', 's3', 'S3', 820, 120),
        n('up', 'service', 'Upload API', 260, 260, svc('fast')),
        n('q1', 'queue', 'Kafka', 460, 260),
        n('tr', 'service', tr('Облачный транскодер', 'Cloud transcoder', '云转码服务'), 640, 260, svc('external')),
        n('ms', 'service', 'Catalog API', 260, 420, { ...svc('fast'), instances: 8 }),
        n('k1', 'cache', 'Redis', 460, 420, { hitRatio: 0.8 }),
        n('pg', 'postgres', 'PostgreSQL', 660, 440),
      ],
      edges: [
        ...chain('c1', 'cdn', 's3'),
        ...chain('c2', 'up', 's3'),
        ...chain('up', 'q1', 'tr', 's3'),
        ...chain('c3', 'ms', 'k1'),
        ...chain('ms', 'pg'),
      ],
    },
  },
  {
    id: 'autocomplete',
    title: tr('Подсказки поиска', 'Search Autocomplete', '搜索自动补全'),
    group: 'System Design',
    brief: [
      tr(
        'Поисковая строка с подсказками: **20 млн** пользователей в день делают по **5 поисков**, и пока человек печатает, уходит в среднем **4 запроса** подсказок. Пик вдвое выше среднего. Подсказки должны появляться быстрее **40 мс**. Кроме того, аналитики строят тренды запросов — это **50** тяжёлых агрегирующих запросов в секунду. Бюджет — **$2400**.',
        'A search bar with autocomplete: **20M** users per day run **5 searches** each, and while a person types, an average of **4 suggestion requests** go out. Peak is twice the average. Suggestions must appear in under **40 ms**. In addition, analysts build query trends — **50** heavy aggregate queries per second. Budget: **$2400**.',
        '一个带自动补全的搜索框：每天 **20M** 名用户，每人搜索 **5 次**，用户输入时平均会发出 **4 次补全建议请求**。峰值是平均值的两倍。补全建议必须在 **40 ms** 内出现。此外，分析师还要统计搜索趋势：每秒 **50** 次重型聚合查询。预算：**$2400**。',
      ),
    ],
    estimate: {
      question: tr('Сколько запросов подсказок в секунду в пике?', 'How many suggestion requests per second at peak?', '峰值时每秒有多少次补全建议请求？'),
      answer: 9259,
      unit: 'rps',
      formula: tr(
        '20 млн × 5 × 4 = 400 млн в сутки; ÷ 86 400 ≈ 4630; × 2 в пике ≈ 9300 rps',
        '20M × 5 × 4 = 400M per day; ÷ 86,400 ≈ 4,630; × 2 at peak ≈ 9,300 rps',
        '20M × 5 × 4 = 每天 400M 次；÷ 86,400 ≈ 4,630；峰值 × 2 ≈ 9,300 rps',
      ),
    },
    nodes: [
      n('c1', 'client', tr('Подсказки', 'Suggestions', '补全建议'), 40, 160, { rps: 9259, workload: 'search', writeShare: 0 }),
      n('c2', 'client', tr('Аналитика трендов', 'Trend analytics', '趋势分析'), 40, 400, { rps: 50, workload: 'analytics', writeShare: 0 }),
    ],
    edges: [],
    budget: 2400,
    locked: ['c1', 'c2'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%', '成功响应 ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Подсказки ≤ 40 мс', 'Suggestions ≤ 40 ms', '补全建议 ≤ 40 ms'), check: lat('c1', 40) },
      { text: tr('Аналитика ≤ 500 мс', 'Analytics ≤ 500 ms', '分析 ≤ 500 ms'), check: lat('c2', 500) },
      { text: tr('Данные хранятся в подходящих хранилищах', 'Data is persisted in suitable stores', '数据保存在合适的存储中'), check: persisted('c1', 'c2') },
    ],
    paths: [],
    hints: [
      tr(
        'Поиск по префиксу в PostgreSQL — это `LIKE` и полный проход по таблице. Посмотрите, какое хранилище считает поиск родным профилем.',
        'Prefix search in PostgreSQL means `LIKE` and a full table scan. Check which storage treats search as its native workload.',
        '在 PostgreSQL 里做前缀搜索，就意味着 `LIKE` 加全表扫描。看看哪种存储把搜索当作原生负载类型。',
      ),
      tr(
        'Популярные префиксы повторяются у миллионов людей: «пого…» → «погода». Ответы на них можно держать в памяти, чтобы поиск видел только промахи.',
        'Popular prefixes repeat across millions of people: "weat…" → "weather". Answers to them can be kept in memory so that search sees only the misses.',
        '热门前缀在数百万人之间反复出现：“天气…” → “天气预报”。这些前缀的答案可以放在内存里，让搜索只处理未命中的请求。',
      ),
      tr(
        'Тренды — это агрегаты по миллиардам запросов. Для них нужна база, которая читает только нужные столбцы, а не все строки целиком.',
        'Trends are aggregates over billions of queries. They need a database that reads only the columns it needs, not entire rows.',
        '趋势是对数十亿次查询的聚合。它需要一种只读取所需列、而不是读取整行的数据库。',
      ),
    ],
    debrief: [
      tr(
        'Разные запросы — разные хранилища (polyglot persistence): поиск по префиксам в Elasticsearch или специализированном trie-сервисе, тренды в ClickHouse. Одна универсальная БД обслуживала бы всё плохо.',
        'Different queries, different stores (polyglot persistence): prefix search in Elasticsearch or a dedicated trie service, trends in ClickHouse. A single general-purpose DB would serve everything poorly.',
        '不同的查询，用不同的存储（polyglot persistence，多语言持久化）：前缀搜索交给 Elasticsearch 或专门的 trie 服务，趋势交给 ClickHouse。用一个通用数据库包揽一切，结果只会样样都做不好。',
      ),
      tr(
        'На интервью строят trie с топ-N подсказок в каждом узле, обновляемый пакетно раз в час по данным аналитики, и обсуждают фильтрацию нежелательных подсказок.',
        'In interviews you build a trie with the top-N suggestions at each node, rebuilt in batch hourly from analytics data, and discuss filtering out inappropriate suggestions.',
        '面试中通常会构建一棵 trie，在每个节点上保存前 N 条补全建议，每小时根据分析数据批量重建一次，并讨论如何过滤不当的建议。',
      ),
    ],
    hitRatio: { cache: 0.8 },
    solution: {
      nodes: [
        n('c1', 'client', tr('Подсказки', 'Suggestions', '补全建议'), 40, 160, { rps: 9259, workload: 'search', writeShare: 0 }),
        n('c2', 'client', tr('Аналитика трендов', 'Trend analytics', '趋势分析'), 40, 400, { rps: 50, workload: 'analytics', writeShare: 0 }),
        n('l1', 'lb', 'LB', 220, 160),
        n('s1', 'service', 'Suggest API', 400, 160, { ...svc('light'), instances: 16 }),
        n('k1', 'cache', 'Redis', 600, 80, { hitRatio: 0.8 }),
        n('es', 'elastic', 'Elasticsearch', 800, 160, { instances: 2 }),
        n('s2', 'service', 'Analytics API', 400, 400, svc('fast')),
        n('ch', 'clickhouse', 'ClickHouse', 700, 400),
      ],
      edges: [...chain('c1', 'l1', 's1', 'k1'), ...chain('s1', 'es'), ...chain('c2', 's2', 'ch')],
    },
  },

  // ---------------- По мотивам System Design Primer ----------------
  {
    id: 'growth-1',
    title: tr('Рост 1/3: один сервер не справляется', 'Growth 1/3: One Server Is Not Enough', '增长 1/3：一台服务器不够用了'),
    group: 'System Design',
    source: { primer: 'scaling_aws' },
    brief: [
      tr(
        'Небольшой сервис взлетел. Пока всё устроено просто: один веб-сервер и одна база PostgreSQL, а картинки, скрипты и стили лежат прямо в базе и отдаются через тот же веб-сервер. Сейчас приходит **600 rps** на страницы и API (записей — около 1%) и **400 rps** на статические файлы; около 1% из них — пользователи загружают свои картинки.',
        'A small service has taken off. So far everything is simple: one web server and one PostgreSQL database, with images, scripts and stylesheets stored right in the database and served by that same web server. Traffic is now **600 rps** to pages and the API (about 1% are writes) and **400 rps** to static files, about 1% of which are users uploading their images.',
        '一个小服务火了起来。目前一切都很简单：一台 Web 服务器加一个 PostgreSQL 数据库，图片、脚本和样式表直接存在数据库里，也由同一台 Web 服务器对外提供。现在页面和 API 的流量是 **600 rps**（约 1% 是写入），静态文件的流量是 **400 rps**，其中约 1% 是用户上传自己的图片。',
      ),
      tr(
        'Страницы должны открываться быстрее **100 мс**, статика — быстрее **60 мс**. Бюджет — **$500 в месяц**. Это первый шаг из трёх: следующие начнутся с эталонного решения этого.',
        'Pages must load in under **100 ms**, static files in under **60 ms**. Budget: **$500 per month**. This is the first of three steps: the next ones start from this step\'s reference solution.',
        '页面必须在 **100 ms** 内打开，静态文件必须在 **60 ms** 内返回。预算：**每月 $500**。这是三步中的第一步：后面两步都从这一步的参考答案开始。',
      ),
    ],
    nodes: [gUsers(600), gStatic(400), gWeb({}), gDb(1)],
    edges: [...chain('c1', 's1', 'd1'), { id: 'e-static', from: 'c2', to: 's1' }],
    budget: 500,
    locked: ['c1', 'c2', 's1', 'd1'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.5%', 'Successful responses ≥ 99.5%', '成功响应 ≥ 99.5%'), check: (r) => r.clientSuccess >= 0.995 },
      { text: tr('Страницы ≤ 100 мс', 'Pages ≤ 100 ms', '页面 ≤ 100 ms'), check: lat('c1', 100) },
      { text: tr('Статика ≤ 60 мс', 'Static files ≤ 60 ms', '静态文件 ≤ 60 ms'), check: lat('c2', 60) },
      gViaWeb(600),
      noBacklog,
      { ...gPersisted, check: persisted('c1', 'c2') },
    ],
    paths: gPath,
    hints: [
      tr(
        'Посмотрите, какой блок красный. PostgreSQL тратит почти все силы на картинки и скрипты: откройте его свойства — насколько хуже он работает с файлами, чем с обычными запросами?',
        'See which block is red. PostgreSQL spends almost all its effort on images and scripts: open its properties. How much worse does it handle files than ordinary queries?',
        '看看哪个组件是红色的。PostgreSQL 几乎把全部力气都花在了图片和脚本上：打开它的属性，看看它处理文件比处理普通查询差多少？',
      ),
      tr(
        'Файлам нужно своё хранилище — дешёвое и рассчитанное на файлы любого размера. Найдите в палитре то, у кого в таблице «подходит для» родной профиль — файлы. Браузер может забирать статику оттуда напрямую и туда же загружать картинки, не нагружая веб-сервер.',
        'Files need their own storage, cheap and built for files of any size. Find the palette item whose "good for" table lists files as native. The browser can fetch static files from there directly and upload images there too, without loading the web server.',
        '文件需要自己的存储：便宜，而且能存放任意大小的文件。在组件面板里找一找，哪个组件的“适合的负载”表把文件列为“原生”。浏览器可以直接从那里获取静态文件，也可以直接把图片上传到那里，不必经过 Web 服务器。',
      ),
      tr(
        'Один экземпляр веб-сервера держит 300 rps, а на страницы приходит 600. Сколько экземпляров нужно, чтобы остался запас примерно в треть?',
        'One web server instance handles 300 rps, and pages get 600. How many instances do you need to keep roughly a third in reserve?',
        '一个 Web 服务器实例能处理 300 rps，而页面流量有 600 rps。要留出大约三分之一的余量，需要多少个实例？',
      ),
    ],
    debrief: [
      tr(
        'Первый шаг роста почти всегда один и тот же: развести то, что мешает друг другу. Статика уходит в объектное хранилище (S3): оно дешёвое, масштабируется само и отдаёт файлы прямо браузеру. Веб-сервер становится легче и растёт экземплярами, а база занимается только данными.',
        'The first growth step is almost always the same: separate the things that get in each other\'s way. Static files move to object storage (S3): it is cheap, scales on its own and serves files straight to the browser. The web server gets lighter and grows by adding instances, while the database deals only with data.',
        '增长的第一步几乎总是一样的：把互相拖累的东西拆开。静态文件搬到对象存储（S3）：它便宜、能自己扩展，还能直接把文件发给浏览器。Web 服务器因此变轻，可以靠增加实例来扩展，数据库则只管数据。',
      ),
      tr(
        'Как файлы попадают в S3, в Primer не сказано — это наше дополнение. Скрипты и стили кладёт в бакет сборка при каждом релизе. Картинки, которые уже лежат в базе, один раз переносят скриптом, а в базе оставляют только ключи. Новые картинки пользователей идут мимо веб-сервера: он проверяет права и подписывает ссылку на загрузку своим ключом (к S3 при этом не обращается), а браузер кладёт файл по этой ссылке прямо в бакет. Поэтому на схеме нет связи «веб-сервер → S3»: и чтение, и загрузка идут по связи «Статика → S3».',
        'Primer does not say how files get into S3; this part is our addition. Scripts and stylesheets are put into the bucket by the build on every release. Images already stored in the database are moved once by a script, and the database keeps only their keys. New user images bypass the web server: it checks permissions and signs an upload URL with its own key (without calling S3), and the browser puts the file straight into the bucket via that URL. That is why the diagram has no "web server → S3" connection: both reads and uploads go along "Static files → S3".',
        'Primer 没有讲文件是怎么进入 S3 的，这部分是我们补充的。脚本和样式表由每次发布时的构建流程放进存储桶。已经存在数据库里的图片用脚本一次性迁移过去，数据库里只保留它们的 key。用户新上传的图片不经过 Web 服务器：服务器检查权限，用自己的密钥为上传链接签名（这一步不需要访问 S3），浏览器再通过这个链接把文件直接放进存储桶。所以图上没有“Web 服务器 → S3”的连接：读取和上传都走“静态文件 → S3”这条连接。',
      ),
      tr(
        'В System Design Primer на этом шаге ещё выносят базу на отдельную машину (здесь она уже отдельный блок) и прячут всё, кроме веб-сервера, в приватную сеть. Вертикальное масштабирование — машина побольше — помогает ненадолго: цена растёт быстрее мощности, и скоро упираешься в потолок.',
        'In System Design Primer this step also moves the database to its own machine (here it is already a separate block) and hides everything except the web server in a private network. Vertical scaling, a bigger machine, helps only for a while: the price grows faster than the capacity, and you soon hit the ceiling.',
        '在 System Design Primer 中，这一步还会把数据库搬到单独的机器上（这里它已经是一个独立组件），并把 Web 服务器之外的所有组件藏进私有网络。垂直扩展，也就是换一台更大的机器，只能顶一阵子：价格涨得比处理能力快，很快就会碰到上限。',
      ),
    ],
    hitRatio: { cache: 0.8, cdn: 0.9 },
    solution: growth1Solution(600, 400),
  },
  {
    id: 'growth-2',
    title: tr('Рост 2/3: сотни тысяч пользователей', 'Growth 2/3: Hundreds of Thousands of Users', '增长 2/3：数十万用户'),
    group: 'System Design',
    source: { primer: 'scaling_aws' },
    brief: [
      tr(
        'Прошло полгода, и схема первого шага уже не тянет: на страницы и API приходит **2000 rps** (записей всё так же около 1%), на статику — **12 000 rps**, и пользователи теперь со всей страны. Веб-сервер захлёбывается, база упирается в чтения, а статика из одного места идёт медленно.',
        'Six months later, the design from step one can no longer cope: pages and the API get **2,000 rps** (still about 1% writes), static files get **12,000 rps**, and users now come from all over the country. The web server is drowning, the database is maxed out on reads, and static files served from a single place are slow.',
        '半年过去了，第一步的方案已经撑不住：页面和 API 的流量达到 **2,000 rps**（写入仍然约占 1%），静态文件达到 **12,000 rps**，而且用户现在来自全国各地。Web 服务器不堪重负，数据库的读取到了极限，静态文件从同一个地方发出也很慢。',
      ),
      tr(
        'Страницы — быстрее **90 мс**, статика — быстрее **20 мс**, успешных ответов — не меньше 99.9%. Бюджет — **$1400**.',
        'Pages must load in under **90 ms** and static files in under **20 ms**, with at least 99.9% successful responses. Budget: **$1400**.',
        '页面必须在 **90 ms** 内打开，静态文件必须在 **20 ms** 内返回，成功响应不低于 99.9%。预算：**$1400**。',
      ),
    ],
    ...growth1Solution(2000, 12000),
    budget: 1400,
    locked: ['c1', 'c2', 's1', 'd1', 's3'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%', '成功响应 ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Страницы ≤ 90 мс', 'Pages ≤ 90 ms', '页面 ≤ 90 ms'), check: lat('c1', 90) },
      { text: tr('Статика ≤ 20 мс', 'Static files ≤ 20 ms', '静态文件 ≤ 20 ms'), check: lat('c2', 20) },
      gViaWeb(2000),
      noBacklog,
      { ...gPersisted, check: persisted('c1', 'c2') },
    ],
    paths: gPath,
    hints: [
      tr(
        'Начните с веб-сервера: 2000 rps при 300 на экземпляр. Сколько экземпляров нужно с запасом? Перед ними пригодится блок, который делит входящий трафик поровну: с ним экземпляры можно добавлять и убирать незаметно для пользователей.',
        'Start with the web server: 2,000 rps at 300 per instance. How many instances do you need with headroom? A block in front of them that splits incoming traffic evenly helps: with it, instances can be added and removed without users noticing.',
        '先从 Web 服务器入手：2,000 rps，每个实例 300。留出余量需要多少个实例？在它们前面放一个把流入流量平均分配的组件会很有用：有了它，增减实例时用户不会察觉。',
      ),
      tr(
        'База упирается в чтения, а записей всего 1%. Её копии могут отвечать на чтения, пока все записи идут в основную. Откройте свойства PostgreSQL: что значат экземпляры сверх первого?',
        'The database is limited by reads, and writes are only 1%. Copies of it can answer reads while all writes go to the main one. Open PostgreSQL\'s properties: what do instances beyond the first mean?',
        '数据库卡在读取上，而写入只占 1%。它的副本可以分担读取，所有写入仍然进入主库。打开 PostgreSQL 的属性：第一个之外的实例意味着什么？',
      ),
      tr(
        'Из одного хранилища статика не уложится в 20 мс: само хранилище отвечает за 40 мс, и это ещё без дороги через всю страну. Всем нужны одни и те же скрипты и картинки — пусть их копии лежат на серверах рядом с пользователями, а в хранилище идут только промахи.',
        'Static files cannot fit into 20 ms from a single store: the store alone takes 40 ms, before the trip across the country. Everyone needs the same scripts and images, so keep copies on servers close to users and send only misses to the store.',
        '静态文件从同一个存储返回，做不到 20 ms：存储本身就要 40 ms，还没算横跨全国的路程。所有人需要的都是同样的脚本和图片，那就把它们的拷贝放在离用户近的服务器上，只有未命中的请求才去存储。',
      ),
    ],
    debrief: [
      tr(
        'Это шаг Primer «Users++»: балансировщик и несколько веб-серверов вместо одного, статика — через CDN. Балансировщик заодно убирает единую точку отказа: экземпляр можно перезапустить, и пользователи этого не заметят.',
        'This is the Primer "Users++" step: a load balancer and several web servers instead of one, static files via a CDN. The balancer also removes a single point of failure: an instance can be restarted without users noticing.',
        '这是 Primer 中的“Users++”这一步：用负载均衡器加多台 Web 服务器替代一台，静态文件改走 CDN。负载均衡器还顺带消除了单点故障：重启某个实例，用户也察觉不到。',
      ),
      tr(
        'Реплики чтения в эталоне — честный, но не самый дешёвый ответ: кэш рядом с веб-сервером решил бы этот шаг дешевле. Он понадобится на следующем шаге, где реплик уже не хватит. Цена реплик — отставание: только что записанное может прочитаться со старой копии, поэтому чтение своих же свежих записей направляют в primary.',
        'Read replicas in the reference are an honest but not the cheapest answer: a cache next to the web server would solve this step for less. You will need it in the next step, where replicas are no longer enough. The price of replicas is lag: something just written may be read from a stale copy, so reads of your own fresh writes are sent to the primary.',
        '参考答案用的是只读副本，这个答案没错，但不是最便宜的：在 Web 服务器旁边加缓存，能用更少的钱解决这一步。下一步就会用到缓存，那时副本已经不够了。副本的代价是复制延迟：刚写入的数据可能从旧副本上读出来，所以读取自己刚写入的数据时要发往 primary。',
      ),
    ],
    hitRatio: { cache: 0.8, cdn: 0.9 },
    solution: growth2Solution(2000, 12000),
  },
  {
    id: 'growth-3',
    title: tr('Рост 3/3: миллионы пользователей', 'Growth 3/3: Millions of Users', '增长 3/3：数百万用户'),
    group: 'System Design',
    source: { primer: 'scaling_aws' },
    brief: [
      tr(
        'Сервис вырос до **5 млн** пользователей в день, каждый делает в среднем **100** запросов страниц и API; пик вдвое выше среднего, записей по-прежнему около 1%. Статика — **30 000 rps**. Появилась новая функция: пользователи загружают файлы (**300** в секунду), и для каждого нужно построить превью. Это тяжёлая работа: экземпляр строит 100 превью в секунду, по 120 мс на каждое.',
        'The service has grown to **5M** users a day, each making **100** page and API requests on average; the peak is twice the average, and writes are still about 1%. Static files get **30,000 rps**. There is a new feature: users upload files (**300** per second), and each one needs a preview. That is heavy work: an instance builds 100 previews per second at 120 ms each.',
        '服务已经增长到每天 **5M** 名用户，每人平均发出 **100** 次页面和 API 请求；峰值是平均值的两倍，写入仍然约占 1%。静态文件的流量是 **30,000 rps**。还上线了一个新功能：用户上传文件（每秒 **300** 个），每个文件都要生成预览。这是重活：一个实例每秒能生成 100 个预览，每个耗时 120 ms。',
      ),
      tr(
        'Веб-серверы по-прежнему хранят сессии пользователей у себя в памяти, поэтому каждый держит немного запросов, и добавлять их бесконечно нельзя. Страницы — быстрее **50 мс**, статика — быстрее **20 мс**, загрузка файла — быстрее **150 мс**, превью не должны копиться. Бюджет — **$2300**.',
        'The web servers still keep user sessions in their own memory, so each one handles few requests, and they cannot be added forever. Pages must load in under **50 ms**, static files in under **20 ms**, a file upload must finish in under **150 ms**, and previews must not pile up. Budget: **$2300**.',
        'Web 服务器仍然把用户会话保存在自己的内存里，所以每台服务器能承担的请求不多，也不能无限增加。页面必须在 **50 ms** 内打开，静态文件必须在 **20 ms** 内返回，文件上传必须在 **150 ms** 内完成，预览不能积压。预算：**$2300**。',
      ),
    ],
    estimate: {
      question: tr('Сколько запросов страниц и API в секунду в пике?', 'How many page and API requests per second at peak?', '峰值时页面和 API 每秒有多少个请求？'),
      answer: 11574,
      unit: 'rps',
      formula: tr(
        '5 млн × 100 = 500 млн в сутки; ÷ 86 400 ≈ 5787 rps; × 2 в пике ≈ 11 600 rps',
        '5M × 100 = 500M per day; ÷ 86,400 ≈ 5,787 rps; × 2 at peak ≈ 11,600 rps',
        '5M × 100 = 每天 500M 次；÷ 86,400 ≈ 5,787 rps；峰值 × 2 ≈ 11,600 rps',
      ),
    },
    nodes: [...growth2Solution(11574, 30000).nodes, gUploads(), gPreviews(1)],
    edges: growth2Solution(11574, 30000).edges,
    budget: 2300,
    // веб-сервер заблокирован (его не удалить — путь «Веб-сервер хранит данные в PostgreSQL» проверяется по нему),
    // но профиль у него меняется: в этом и есть ход задачи
    locked: ['c1', 'c2', 'c3', 's1', 'd1', 's3', 'pv'],
    tunable: ['s1'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%', '成功响应 ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Страницы ≤ 50 мс', 'Pages ≤ 50 ms', '页面 ≤ 50 ms'), check: lat('c1', 50) },
      { text: tr('Статика ≤ 20 мс', 'Static files ≤ 20 ms', '静态文件 ≤ 20 ms'), check: lat('c2', 20) },
      { text: tr('Загрузка файла ≤ 150 мс', 'File upload ≤ 150 ms', '文件上传 ≤ 150 ms'), check: lat('c3', 150) },
      { text: tr('Загруженный файл сохраняется до ответа', 'An uploaded file is stored before the response', '上传的文件在响应之前就已保存'), check: (r) => r.persistedDirect.c3 },
      { text: tr('Для каждого загруженного файла строится превью', 'Every uploaded file gets a preview', '每个上传的文件都会生成预览'), check: flowsAll('pv', 'c3', 'blob', 300) },
      { text: tr('Превью не копятся', 'Previews do not pile up', '预览任务不积压'), check: (r) => r.backlogGrowth < 1 },
      { ...gPersisted, check: persisted('c1', 'c2', 'c3') },
    ],
    paths: [
      ...gPath,
      { from: 'pv', to: 's3', text: tr('Готовые превью хранятся рядом с файлами', 'Finished previews are stored next to the files', '生成的预览与文件存放在一起') },
    ],
    hints: [
      tr(
        'Посчитайте веб-серверы: 40 экземпляров по 300 rps — это 12 000 rps, впритык к пику, и больше не поставить. Загрузка под 100%, а значит, страницы будут открываться сотни миллисекунд. Держать мало запросов серверы заставляют сессии в памяти каждого из них. Если вынести сессии в общее быстрое хранилище, серверы станут лёгкими и взаимозаменяемыми — в свойствах сервиса есть такой профиль.',
        'Count the web servers: 40 instances at 300 rps make 12,000 rps, barely above the peak, and you cannot add more. Utilization near 100% means pages take hundreds of milliseconds to load. What keeps each server\'s capacity low is the sessions in its memory. Move the sessions to a shared fast store, and the servers become light and interchangeable: the service properties have such a profile.',
        '算一算 Web 服务器：40 个实例、每个 300 rps，合计 12,000 rps，刚刚超过峰值，而且不能再多了。利用率接近 100%，页面打开就要几百毫秒。让每台服务器承担不了多少请求的，正是它内存里的会话。把会话移到一个共享的快速存储里，服务器就会变得轻量、可以互相替换：服务的属性里就有这样的类型。',
      ),
      tr(
        'Реплик у базы максимум пять, а чтений больше десяти тысяч в секунду. Большинство из них одинаковые: популярные страницы смотрят миллионы людей. Ответы на повторы можно держать в памяти рядом с веб-сервером: он сначала спросит память и пойдёт в базу только за тем, чего там нет, — до базы дойдёт лишь малая часть.',
        'The database has at most five replicas, while there are more than ten thousand reads per second. Most of them are identical: millions of people view the same popular pages. Answers to repeats can be kept in memory next to the web server: it asks the memory first and goes to the database only for what is missing, so only a small share reaches the database.',
        '数据库最多只有五个副本，而每秒的读取超过一万次。其中大部分是重复的：数百万人看的是同样的热门页面。可以把这些重复请求的答案放在 Web 服务器旁边的内存里：服务器先查内存，只有内存里没有的才去数据库取，这样只有一小部分请求会到达数据库。',
      ),
      tr(
        'Превью строится 120 мс, а загрузка должна ответить за 150 мс вместе с сохранением файла. Пусть загрузка сохранит файл, передаст работу дальше и сразу ответит, а превью строит отдельный обработчик в своём темпе.',
        'A preview takes 120 ms to build, while an upload must respond within 150 ms including saving the file. Let the upload save the file, hand the work on and reply immediately, while a separate worker builds previews at its own pace.',
        '生成一个预览要 120 ms，而上传连同保存文件必须在 150 ms 内响应。让上传先保存文件、把工作转交出去并立即回复，再由一个单独的工作进程按自己的节奏生成预览。',
      ),
    ],
    debrief: [
      tr(
        'Это шаги Primer с «Users+++» по «Users+++++». Кэш рядом с веб-серверами снимает основную нагрузку чтения: сервер сначала спрашивает кэш, а в базу (на реплики) идёт только при промахе. Сессии уходят из веб-серверов в общее хранилище: серверы становятся stateless, и их можно добавлять и убирать автоматически — по нагрузке или по времени суток. Модель конструктора считает установившийся поток, поэтому автомасштабирования здесь не видно, но возможным его делает именно stateless.',
        'These are the Primer steps "Users+++" through "Users+++++". A cache next to the web servers takes the bulk of the read load: a server asks the cache first and goes to the database (its replicas) only on a miss. Sessions move out of the web servers into a shared store: the servers become stateless and can be added and removed automatically, by load or by time of day. The builder model computes a steady flow, so autoscaling is not visible here, but statelessness is exactly what makes it possible.',
        '这对应 Primer 中从“Users+++”到“Users+++++”的几步。Web 服务器旁边的缓存承担了大部分读取负载：服务器先查缓存，未命中时才去数据库（副本）。会话从 Web 服务器移到共享存储：服务器变成无状态，可以按负载或按时段自动增减（自动扩缩容，autoscaling）。构建器的模型计算的是稳定流量，所以这里看不到自动扩缩容，但正是无状态让它成为可能。',
      ),
      tr(
        'Тяжёлую работу, которую не обязательно делать во время запроса, отдают очереди и воркерам: загрузка сохраняет файл и ставит задание, превью появится через секунду-другую. Дальше по этой дороге — шардирование или NoSQL, когда запись перестанет помещаться в один primary, и отдельное хранилище для аналитики вместо отчётов по рабочей базе.',
        'Heavy work that does not have to happen during the request goes to a queue and workers: the upload saves the file and enqueues a job, and the preview appears a second or two later. Further down this road come sharding or NoSQL, once writes no longer fit into one primary, and a separate analytics store instead of reports over the production database.',
        '不必在请求过程中完成的重活，交给队列和工作进程：上传先保存文件并把任务放进队列，预览会在一两秒后出现。沿着这条路继续走下去，还会遇到分片或 NoSQL（当一个 primary 装不下全部写入时），以及用单独的分析存储代替在生产数据库上跑报表。',
      ),
      tr(
        'Загрузку файлов здесь принимает Upload API: ему нужно сразу поставить задание на превью. В жизни и такие файлы часто грузят прямо в S3 по подписанной ссылке, как картинки в первом шаге, а задание ставит событие бакета (S3 Event Notifications). В конструкторе хранилища никого не вызывают, поэтому этот путь показан через сервис.',
        'Here file uploads are accepted by the Upload API because it has to enqueue the preview job right away. In real life such files are also often uploaded straight to S3 via a signed URL, like the images in step one, and a bucket event (S3 Event Notifications) enqueues the job. In the builder, stores never call anyone, so this path is shown through a service.',
        '这里由 Upload API 接收文件上传，因为它需要立刻把生成预览的任务放进队列。现实中，这类文件也经常像第一步里的图片那样，通过签名链接直接上传到 S3，再由存储桶事件（S3 Event Notifications）把任务放进队列。在构建器里，存储不会调用任何组件，所以这条路径是通过服务来表示的。',
      ),
    ],
    hitRatio: { cache: 0.8, cdn: 0.9 },
    solution: (() => {
      const base = growth2Solution(11574, 30000)
      return {
        nodes: [
          ...base.nodes.map((x) => (x.id === 's1' ? { ...x, ...svc('light'), instances: 16 } : x)),
          gCache(),
          gUploads(),
          n('up', 'service', 'Upload API', 220, 430, { ...svc('fast'), instances: 2 }),
          n('q1', 'queue', 'Kafka', 420, 430),
          gPreviews(4),
        ],
        edges: [
          ...base.edges,
          ...chain('s1', 'k1'),
          ...chain('c3', 'up', 's3'),
          ...chain('up', 'q1', 'pv', 's3'),
        ],
      }
    })(),
  },
  {
    id: 'sales-rank',
    title: tr('Рейтинг продаж', 'Sales Rank', '销量排行'),
    group: 'System Design',
    source: { primer: 'sales_rank' },
    brief: [
      tr(
        'Маркетплейс показывает «хиты продаж» в каждой из **1000** категорий — топ товаров по продажам за неделю. Страницы рейтинга открывают **10 млрд** раз в месяц, пик вдвое выше среднего, ответ нужен быстрее **40 мс**. Рейтинг пересчитывается раз в час и всё это время одинаков для всех.',
        'A marketplace shows "best sellers" in each of its **1,000** categories: the top products by sales over the week. Rank pages are opened **10B** times a month, the peak is twice the average, and a response is needed in under **40 ms**. The rank is recalculated once an hour and is the same for everyone in between.',
        '一个电商平台在全部 **1,000** 个类目中都展示“畅销榜”：按一周销量排出的热门商品。排行榜页面每月被打开 **10B** 次，峰值是平均值的两倍，响应必须在 **40 ms** 以内。排行每小时重新计算一次，两次计算之间对所有人都一样。',
      ),
      tr(
        'Каждая покупка (**100** в секунду) записывается в журнал продаж, магазину нужен ответ быстрее **300 мс**. Рейтинг каждой категории обновляется раз в час, но считают его по регионам и для нескольких окон (час, сутки, неделя), а аналитики строят по тому же журналу свои срезы — вместе это **120** тяжёлых агрегатов в секунду, на каждый есть до **500 мс**. Бюджет — **$1250**.',
        'Every purchase (**100** per second) is recorded in the sales log, and the store needs a response in under **300 ms**. Each category\'s rank is refreshed once an hour, but it is computed per region and for several windows (an hour, a day, a week), and analysts run their own slices over the same log: together that is **120** heavy aggregates per second, each allowed up to **500 ms**. Budget: **$1250**.',
        '每笔购买（每秒 **100** 笔）都会记入销售日志，商店要求在 **300 ms** 内得到响应。每个类目的排行每小时更新一次，但要按地区、针对多个时间窗口（一小时、一天、一周）分别计算，分析师还会在同一份日志上做自己的切片：合计每秒 **120** 次重型聚合，每次最多可用 **500 ms**。预算：**$1250**。',
      ),
    ],
    estimate: {
      question: tr('Сколько просмотров рейтинга в секунду в пике?', 'How many rank page views per second at peak?', '峰值时排行榜每秒被浏览多少次？'),
      answer: 7716,
      unit: 'rps',
      formula: tr(
        '10 млрд ÷ 30 дней ÷ 86 400 с ≈ 3858 rps; × 2 в пике ≈ 7700 rps',
        '10B ÷ 30 days ÷ 86,400 s ≈ 3,858 rps; × 2 at peak ≈ 7,700 rps',
        '10B ÷ 30 天 ÷ 86,400 s ≈ 3,858 rps；峰值 × 2 ≈ 7,700 rps',
      ),
    },
    nodes: [
      n('c1', 'client', tr('Рейтинг продаж', 'Sales rank pages', '销量排行榜'), 40, 100, { rps: 7716, workload: 'kv', writeShare: 0 }),
      n('c2', 'client', tr('Покупки', 'Purchases', '购买'), 40, 300, { rps: 100, workload: 'analytics', writeShare: 1 }),
      n('c3', 'client', tr('Пересчёт рейтинга', 'Rank recalculation', '重新计算排行'), 40, 460, { rps: 120, workload: 'analytics', writeShare: 0 }),
    ],
    edges: [],
    budget: 1250,
    locked: ['c1', 'c2', 'c3'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%', '成功响应 ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Рейтинг ≤ 40 мс', 'Rank page ≤ 40 ms', '排行榜 ≤ 40 ms'), check: lat('c1', 40) },
      { text: tr('Покупка записана ≤ 300 мс', 'Purchase recorded ≤ 300 ms', '购买记录 ≤ 300 ms'), check: lat('c2', 300) },
      { text: tr('Пересчёт ≤ 500 мс', 'Recalculation ≤ 500 ms', '重新计算 ≤ 500 ms'), check: lat('c3', 500) },
      noBacklog,
      { text: tr('Рейтинг и продажи хранятся в подходящих хранилищах', 'Rank and sales are persisted in suitable stores', '排行和销售数据都保存在合适的存储中'), check: persisted('c1', 'c2', 'c3') },
      {
        text: tr('Журнал продаж и пересчёт — в хранилище, для которого агрегаты — родной профиль', 'The sales log and recalculation live in a store where aggregates are the native workload', '销售日志和重新计算都放在把聚合当作原生负载的存储中'),
        check: native('c2', 'c3'),
      },
    ],
    paths: [],
    hints: [
      tr(
        'Посчитайте сервисы на 7700 rps. Рейтинг категории целый час одинаков для всех — сколько раз его на самом деле нужно доставать из базы?',
        'Count the services needed for 7,700 rps. A category\'s rank is the same for everyone for a whole hour, so how many times does it really need to be fetched from the database?',
        '算一算 7,700 rps 需要多少服务实例。一个类目的排行在整整一小时内对所有人都一样，那它真正需要从数据库取几次？',
      ),
      tr(
        'Готовый рейтинг — маленькая таблица «категория → топ товаров», её читают по ключу. Журнал продаж и пересчёт — совсем другая нагрузка: запись событий и агрегаты по миллионам строк. Держать их в одной базе с рейтингом не обязательно.',
        'The finished rank is a small "category → top products" table, read by key. The sales log and the recalculation are a completely different workload: event writes and aggregates over millions of rows. They do not have to live in the same database as the rank.',
        '算好的排行是一张小表：“类目 → 热门商品”，按键读取。而销售日志和重新计算是完全不同的负载：写入事件，以及对数百万行做聚合。它们不必和排行放在同一个数据库里。',
      ),
      tr(
        'Агрегатам по неделе продаж нужна база, которая хранит каждый столбец отдельно и сжатым: запрос «сумма продаж по товарам» читает два столбца из десятков.',
        'Aggregates over a week of sales need a database that stores each column separately and compressed: a "total sales by product" query reads two columns out of dozens.',
        '对一周的销售做聚合，需要一种把每一列分开存放并压缩的数据库：“按商品汇总销量”的查询只需读取几十列中的两列。',
      ),
    ],
    debrief: [
      tr(
        'Главная идея — не считать рейтинг на каждый просмотр. Пересчёт идёт по расписанию (в Primer — MapReduce раз в час по журналам продаж в объектном хранилище, здесь — агрегаты в ClickHouse), готовый результат кладут в обычную таблицу (на схеме — связь задачи пересчёта с «Рейтингом»; запись раз в час модель не считает), а миллионы просмотров обслуживает кэш: тысяча категорий целиком помещается в память.',
        'The key idea is not to compute the rank on every view. Recalculation runs on a schedule (in Primer, an hourly MapReduce over sales logs in object storage; here, aggregates in ClickHouse), the finished result goes into an ordinary table (on the diagram, the link from the rank job to "Rank"; the model does not count this hourly write), and a cache serves the millions of views: a thousand categories fit into memory entirely.',
        '核心思路是不要在每次浏览时计算排行。重新计算按计划执行（Primer 中是每小时对存放在对象存储里的销售日志跑一次 MapReduce；这里是在 ClickHouse 里做聚合），算好的结果放进普通的表（架构图上就是重算任务到“排行”的连接；这种每小时一次的写入模型不计入），数百万次浏览由缓存承担：一千个类目可以整体装进内存。',
      ),
      tr(
        'Тот же приём встречается повсюду: счётчики просмотров, топы, рекомендации. Цена — свежесть: рейтинг отстаёт до часа, и популярным категориям могут понадобиться пересчёты чаще. На интервью обсуждают окно (неделя или сутки), вес свежих продаж и защиту от накруток.',
        'The same trick appears everywhere: view counters, top lists, recommendations. The price is freshness: the rank lags by up to an hour, and popular categories may need more frequent recalculation. Interviews discuss the window (a week or a day), the weight of recent sales and protection against manipulation.',
        '同样的手法随处可见：浏览计数、各类榜单、推荐。代价是新鲜度：排行最多会落后一小时，热门类目可能需要更频繁地重新计算。面试中会讨论统计窗口（一周还是一天）、近期销量的权重，以及如何防止刷榜。',
      ),
    ],
    hitRatio: { cache: 0.95 },
    solution: {
      nodes: [
        n('c1', 'client', tr('Рейтинг продаж', 'Sales rank pages', '销量排行榜'), 40, 100, { rps: 7716, workload: 'kv', writeShare: 0 }),
        n('c2', 'client', tr('Покупки', 'Purchases', '购买'), 40, 300, { rps: 100, workload: 'analytics', writeShare: 1 }),
        n('c3', 'client', tr('Пересчёт рейтинга', 'Rank recalculation', '重新计算排行'), 40, 460, { rps: 120, workload: 'analytics', writeShare: 0 }),
        n('l1', 'lb', 'LB', 220, 100),
        n('s1', 'service', 'Rank API', 400, 100, { ...svc('light'), instances: 10 }),
        n('k1', 'cache', 'Redis', 600, 40, { hitRatio: 0.95 }),
        n('d1', 'postgres', tr('Рейтинг', 'Rank', '排行'), 800, 140),
        n('s2', 'service', 'Sales API', 300, 300, svc('fast')),
        n('s3', 'service', tr('Задача пересчёта', 'Rank job', '重算任务'), 300, 460, svc('fast')),
        n('ch', 'clickhouse', 'ClickHouse', 660, 390),
      ],
      // задача пересчёта кладёт готовый рейтинг в таблицу «Рейтинг»: запись раз в час, модель её не считает
      edges: [...chain('c1', 'l1', 's1', 'd1'), ...chain('s1', 'k1'), ...chain('c2', 's2', 'ch'), ...chain('c3', 's3', 'ch'), ...chain('s3', 'd1')],
    },
  },
  {
    id: 'finance',
    title: tr('Агрегатор личных финансов', 'Personal Finance Aggregator', '个人财务聚合服务'),
    group: 'System Design',
    source: { primer: 'mint' },
    brief: [
      tr(
        'Сервис учёта личных финансов: пользователи подключают банковские счета, а сервис сам забирает операции, раскладывает их по категориям по продавцу и сверяет с бюджетом. Подключено **20 млн** счетов, по каждому в среднем **6** операций в день. Банки присылают их в течение суток, и банку нужен ответ «принято» быстрее **50 мс**. Разбор операции (продавец, категория, бюджет) — около 20 мс работы обычного сервиса.',
        'A personal finance service: users connect their bank accounts, and the service pulls in transactions by itself, assigns categories by merchant and checks them against the budget. **20M** accounts are connected, with **6** transactions per account per day on average. Banks send them throughout the day and need an "accepted" response in under **50 ms**. Processing a transaction (merchant, category, budget) takes about 20 ms of a standard service.',
        '一个个人理财服务：用户绑定自己的银行账户，服务会自动拉取交易记录，按商户归入类别，并与预算比对。目前绑定了 **20M** 个账户，每个账户平均每天 **6** 笔交易。银行全天陆续发送这些交易，并要求在 **50 ms** 内收到“已受理”的响应。处理一笔交易（商户、类别、预算）大约需要一个标准服务 20 ms 的工作量。',
      ),
      tr(
        'Читают куда реже, чем пишут: экран бюджета открывают **140** раз в секунду, ответ нужен быстрее **150 мс**. Отчёты «расходы по категориям за месяц» строятся **220** раз в секунду — их смотрят в приложении и рассылают пользователям, — и каждый можно ждать до **500 мс**. Бюджет — **$1650**.',
        'Reads are far rarer than writes: the budget screen is opened **140** times per second and must respond in under **150 ms**. "Spending by category for the month" reports are built **220** times per second, since users view them in the app and receive them by email, and each may take up to **500 ms**. Budget: **$1650**.',
        '读取远比写入少：预算页面每秒被打开 **140** 次，必须在 **150 ms** 内响应。“本月分类支出”报表每秒要生成 **220** 份：用户会在 App 里查看，也会通过邮件收到，每份最多可以等 **500 ms**。预算：**$1650**。',
      ),
    ],
    estimate: {
      question: tr('Сколько операций в секунду приходит из банков?', 'How many transactions per second arrive from banks?', '每秒从银行传来多少笔交易？'),
      answer: 1389,
      unit: tr('в секунду', 'per second', '笔/秒'),
      formula: tr(
        '20 млн счетов × 6 = 120 млн операций в сутки; ÷ 86 400 ≈ 1389 в секунду',
        '20M accounts × 6 = 120M transactions per day; ÷ 86,400 ≈ 1,389 per second',
        '20M 个账户 × 6 = 每天 120M 笔交易；÷ 86,400 ≈ 每秒 1,389 笔',
      ),
    },
    nodes: [
      n('c1', 'client', tr('Операции из банков', 'Bank transactions', '银行交易'), 40, 100, { rps: 1389, workload: 'oltp', writeShare: 1 }),
      n('c2', 'client', tr('Экран бюджета', 'Budget screen', '预算页面'), 40, 300, { rps: 140, workload: 'oltp', writeShare: 0.1 }),
      n('c3', 'client', tr('Расходы по категориям', 'Spending by category', '分类支出'), 40, 460, { rps: 220, workload: 'analytics', writeShare: 0 }),
      n('w1', 'service', tr('Категоризация', 'Categorization', '分类服务'), 640, 100, svc('fast')),
    ],
    edges: [],
    budget: 1650,
    locked: ['c1', 'c2', 'c3', 'w1'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%', '成功响应 ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Банк получает «принято» ≤ 50 мс', 'The bank gets "accepted" ≤ 50 ms', '银行收到“已受理” ≤ 50 ms'), check: lat('c1', 50) },
      { text: tr('Экран бюджета ≤ 150 мс', 'Budget screen ≤ 150 ms', '预算页面 ≤ 150 ms'), check: lat('c2', 150) },
      { text: tr('Отчёты ≤ 500 мс', 'Reports ≤ 500 ms', '报表 ≤ 500 ms'), check: lat('c3', 500) },
      { text: tr('Экран бюджета и отчёты получают данные в момент запроса', 'The budget screen and reports get their data at request time', '预算页面和报表在请求时就拿到数据'), check: syncData('c2', 'c3') },
      {
        text: tr('Экран бюджета читает ту же базу, куда записываются операции', 'The budget screen reads the same database the transactions are written to', '预算页面读取的正是写入交易的那个数据库'),
        check: sharedStore('c1', 'c2'),
      },
      { text: tr('Каждая операция проходит категоризацию и сохраняется', 'Every transaction is categorized and stored', '每笔交易都经过分类并已保存'), check: flowsAll('w1', 'c1', 'oltp', 1389) },
      { text: tr('Необработанные операции не копятся', 'Unprocessed transactions do not pile up', '未处理的交易不会积压'), check: (r) => r.backlogGrowth < 1 },
      { text: tr('Операции и отчёты хранятся в подходящих хранилищах', 'Transactions and reports are persisted in suitable stores', '交易和报表都保存在合适的存储中'), check: persisted('c1', 'c2', 'c3') },
      { text: tr('Отчёты строятся в хранилище, для которого агрегаты — родной профиль', 'Reports are built in a store where aggregates are the native workload', '报表在把聚合当作原生负载的存储中生成'), check: native('c3') },
    ],
    paths: [],
    hints: [
      tr(
        'Банку нужен ответ за 50 мс, а категоризация на пике сама по себе занимает дольше. Но банку не нужен результат разбора, ему нужно только «принято». Что примет операцию мгновенно, надёжно её сохранит и отдаст категоризации в её темпе?',
        'The bank needs a response within 50 ms, while categorization alone takes longer at peak. But the bank does not need the result of processing, only "accepted". What will accept a transaction instantly, keep it safe and hand it to categorization at its own pace?',
        '银行要求 50 ms 内响应，而高峰时光是分类本身就要更久。但银行并不需要处理结果，它只需要一句“已受理”。什么东西能立即接收交易、可靠地保存下来，再按分类服务自己的节奏交给它？',
      ),
      tr(
        'В базу операций пишут в десять раз чаще, чем читают из неё: 1389 записей в секунду против примерно 130 чтений экрана бюджета. Копии базы для чтения и ответы из памяти не помогут — вся запись идёт в одну основную машину. Как её разгрузить: взять машину крупнее или разделить данные по пользователям на несколько частей?',
        'The transactions database is written ten times more often than it is read: 1,389 writes per second against about 130 budget screen reads. Read copies of the database and answers from memory will not help, since all writes go to a single main machine. How do you relieve it: take a bigger machine, or split the data by user into several parts?',
        '交易数据库的写入是读取的十倍：每秒 1,389 次写入，而预算页面的读取只有约 130 次。数据库的只读副本和内存里的答案都帮不上忙：所有写入都进入同一台主机器。怎么给它减负：换一台更大的机器，还是把数据按用户拆成几部分？',
      ),
      tr(
        'Отчёт «расходы по категориям за месяц» — агрегат по миллионам строк. В строчной базе он мешает операциям; нужна база, которая читает только нужные столбцы.',
        'A "spending by category for the month" report is an aggregate over millions of rows. In a row-oriented database it gets in the way of transactions; you need a database that reads only the columns it needs.',
        '“本月分类支出”报表是对数百万行数据的聚合。放在按行存储的数据库里，它会妨碍交易处理；你需要一种只读取所需列的数据库。',
      ),
    ],
    debrief: [
      tr(
        'Агрегатор финансов — редкий write-heavy сервис: в базу операций пишут на порядок чаще, чем читают из неё. Реплики и кэш здесь почти бесполезны, масштабировать приходится запись. Машина крупнее даёт передышку, шардирование по user_id — запас на годы: все операции пользователя живут в одном шарде. Primer предлагает ещё федерацию, денормализацию и перенос части данных в NoSQL.',
        'A finance aggregator is a rare write-heavy service: its transactions database is written an order of magnitude more often than it is read. Replicas and caches are almost useless here; it is writes that must scale. A bigger machine buys a breather, and sharding by user_id gives room for years: all of a user\'s transactions live on one shard. Primer also suggests federation, denormalization and moving part of the data to NoSQL.',
        '财务聚合服务是少见的写多读少（write-heavy）服务：交易数据库的写入比读取多一个数量级。副本和缓存在这里几乎没用，需要扩展的是写入。换更大的机器能喘口气，按 user_id 分片则能撑上好几年：同一用户的所有交易都在同一个分片里。Primer 还提出了联邦拆分（federation）、反规范化，以及把部分数据迁移到 NoSQL。',
      ),
      tr(
        'Приём через очередь развязывает банки и разбор: банк сразу получает «принято», а пик утренних выгрузок сглаживается. Отчёты по категориям считают в колоночной базе (ClickHouse, Redshift, BigQuery). В жизни операции приходят туда потоком из той же очереди; на схеме этот поток за кадром. Уведомления о превышении бюджета не обязаны быть мгновенными — их тоже отправляют асинхронно.',
        'Intake through a queue decouples banks from processing: the bank gets "accepted" right away, and the peak of morning exports is smoothed out. Category reports are computed in a columnar database (ClickHouse, Redshift, BigQuery). In real life transactions arrive there as a stream from the same queue; the diagram leaves that stream out. Over-budget notifications do not have to be instant, so they are sent asynchronously too.',
        '通过队列接收交易，把银行和处理环节解耦：银行立刻收到“已受理”，早间批量导出的峰值也被削平。分类报表在列式数据库（ClickHouse、Redshift、BigQuery）里计算。现实中，交易会以流的形式从同一个队列进入那里；架构图里省略了这条数据流。超预算提醒不必是即时的，所以同样异步发送。',
      ),
    ],
    hitRatio: {},
    solution: {
      nodes: [
        n('c1', 'client', tr('Операции из банков', 'Bank transactions', '银行交易'), 40, 100, { rps: 1389, workload: 'oltp', writeShare: 1 }),
        n('c2', 'client', tr('Экран бюджета', 'Budget screen', '预算页面'), 40, 300, { rps: 140, workload: 'oltp', writeShare: 0.1 }),
        n('c3', 'client', tr('Расходы по категориям', 'Spending by category', '分类支出'), 40, 460, { rps: 220, workload: 'analytics', writeShare: 0 }),
        n('s1', 'service', 'Intake API', 240, 100, { ...svc('light'), instances: 2 }),
        n('q1', 'queue', 'Kafka', 440, 100),
        n('w1', 'service', tr('Категоризация', 'Categorization', '分类服务'), 640, 100, { ...svc('fast'), instances: 6 }),
        n('d1', 'postgres', 'PostgreSQL', 820, 220, { shards: 3 }),
        n('s2', 'service', 'Budget API', 300, 300, svc('fast')),
        n('s3', 'service', 'Reports API', 300, 460, { ...svc('fast'), instances: 2 }),
        n('ch', 'clickhouse', 'ClickHouse', 640, 460),
      ],
      edges: [...chain('c1', 's1', 'q1', 'w1', 'd1'), ...chain('c2', 's2', 'd1'), ...chain('c3', 's3', 'ch')],
    },
  },
  {
    id: 'social-graph',
    title: tr('Граф друзей', 'Social Graph', '社交关系图'),
    group: 'System Design',
    source: { primer: 'social_graph' },
    brief: [
      tr(
        'Соцсеть на **100 млн** человек, у каждого в среднем **50** друзей — это **5 млрд** связей, и на одну машину они не помещаются. Функция «как я связан с этим человеком» ищет кратчайшую цепочку знакомств обходом в ширину: в месяц **500 млн** поисков, пик втрое выше среднего, и каждый поиск запрашивает в среднем **20** списков друзей.',
        'A social network of **100M** people with **50** friends each on average: **5B** connections that do not fit on one machine. The "how am I connected to this person" feature finds the shortest chain of acquaintances with a breadth-first search: **500M** searches a month, a peak three times the average, and each search fetches **20** friend lists on average.',
        '一个拥有 **100M** 用户的社交网络，每人平均有 **50** 个好友：共 **5B** 条关系，一台机器装不下。“我和这个人是怎么认识的”功能用广度优先搜索寻找最短的认识链：每月 **500M** 次搜索，峰值是平均值的三倍，每次搜索平均要查询 **20** 个好友列表。',
      ),
      tr(
        'Список друзей должен отдаваться быстрее **40 мс**, иначе поиск в несколько шагов затянется. Новые дружбы появляются **300** раз в секунду и должны сохраняться. Бюджет — **$1400**.',
        'A friend list must be returned in under **40 ms**, or a multi-step search will drag on. New friendships appear **300** times per second and must be persisted. Budget: **$1400**.',
        '好友列表必须在 **40 ms** 内返回，否则多步搜索会拖得很久。每秒新增 **300** 条好友关系，必须持久化保存。预算：**$1400**。',
      ),
    ],
    estimate: {
      question: tr('Сколько запросов списков друзей в секунду в пике?', 'How many friend list lookups per second at peak?', '峰值时每秒要查询多少次好友列表？'),
      answer: 11574,
      unit: 'rps',
      formula: tr(
        '500 млн ÷ 30 дней ÷ 86 400 с ≈ 193 поиска в секунду; × 3 в пике × 20 списков ≈ 11 600 rps',
        '500M ÷ 30 days ÷ 86,400 s ≈ 193 searches per second; × 3 at peak × 20 lists ≈ 11,600 rps',
        '500M ÷ 30 天 ÷ 86,400 s ≈ 每秒 193 次搜索；峰值 × 3 × 20 个列表 ≈ 11,600 rps',
      ),
    },
    nodes: [
      n('c1', 'client', tr('Поиск через друзей', 'Friend path search', '好友路径搜索'), 40, 140, { rps: 11574, workload: 'kv', writeShare: 0 }),
      n('c2', 'client', tr('Новые дружбы', 'New friendships', '新增好友关系'), 40, 360, { rps: 300, workload: 'kv', writeShare: 1 }),
    ],
    edges: [],
    budget: 1400,
    locked: ['c1', 'c2'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%', '成功响应 ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Список друзей ≤ 40 мс', 'Friend list ≤ 40 ms', '好友列表 ≤ 40 ms'), check: lat('c1', 40) },
      { text: tr('Списки друзей читаются оттуда же, куда записываются новые дружбы', 'Friend lists are read from where new friendships are written', '好友列表从写入新好友关系的地方读取'), check: sharedStore('c2', 'c1') },
      noBacklog,
      { text: tr('Дружбы сохраняются в хранилище', 'Friendships are persisted in storage', '好友关系已保存到存储中'), check: persisted('c1', 'c2') },
    ],
    paths: [],
    hints: [
      tr(
        'Один поиск — это двадцать запросов списков друзей, поэтому нагрузка в двадцать раз больше числа поисков. Сколько лёгких сервисов нужно на 11 600 rps с запасом?',
        'One search means twenty friend list lookups, so the load is twenty times the number of searches. How many light services do you need for 11,600 rps with headroom?',
        '一次搜索就是二十次好友列表查询，所以负载是搜索次数的二十倍。要扛住 11,600 rps 并留出余量，需要多少个轻量服务实例？',
      ),
      tr(
        'Поиски снова и снова проходят через одних и тех же людей с тысячами друзей, их списки запрашивают постоянно. Держите ответы на повторы в памяти рядом с сервисом: он сначала спрашивает память и идёт в хранилище только при промахе.',
        'Searches keep passing through the same people with thousands of friends, whose lists are requested all the time. Keep answers to repeats in memory next to the service: it asks the memory first and goes to the storage only on a miss.',
        '搜索总会一再经过同一批拥有成千上万好友的人，他们的列表一直在被查询。把这些重复请求的答案放在服务旁边的内存里：服务先查内存，未命中时才去存储。',
      ),
      tr(
        'Граф — это пары «человек → список друзей», только чтение и запись по ключу, а на одну машину он не помещается. Копии одной большой базы не помогут: каждая хранила бы весь граф. Нужно хранилище, которое само делит данные между узлами.',
        'The graph is "person → friend list" pairs, read and written only by key, and it does not fit on one machine. Copies of one big database will not help, since each would hold the whole graph. You need a storage that splits the data across nodes by itself.',
        '这张图就是一对对“人 → 好友列表”，只按键读写，而且一台机器装不下。一个大数据库的多个副本帮不上忙：每个副本都得存下整张图。你需要一种能自己把数据分散到多个节点上的存储。',
      ),
    ],
    debrief: [
      tr(
        'В Primer граф живёт на шардированных «Person Servers», а Lookup Service знает, на каком сервере какой человек. Здесь эту роль играет хранилище, которое шардирует данные само (Cassandra, DynamoDB). В жизни подошёл бы и PostgreSQL с шардами по user_id, но на этих числах ему нужно семь шардов (или меньше, но с репликами и на машинах крупнее), и в бюджет он не укладывается ни так, ни так. Кэш берёт на себя самых связанных людей — через них проходит большинство поисков.',
        'In Primer the graph lives on sharded "Person Servers", and a Lookup Service knows which server holds which person. Here that role is played by a store that shards data by itself (Cassandra, DynamoDB). In real life PostgreSQL sharded by user_id would also do, but with these numbers it needs seven shards (or fewer, with replicas and bigger machines), and neither way fits the budget. The cache takes the most connected people, since most searches pass through them.',
        '在 Primer 中，社交图存放在分片的“Person Server”上，由 Lookup Service 记录每个人在哪台服务器上。这里由能自己分片的存储（Cassandra、DynamoDB）来扮演这个角色。现实中按 user_id 分片的 PostgreSQL 也可以，但按这里的数字它需要七个分片（或者分片少一些，但要加副本、换更大的机器），无论哪种都超出预算。缓存负责那些人脉最广的人，因为大多数搜索都会经过他们。',
      ),
      tr(
        'Сам обход в ширину на интервью ускоряют так: идут с двух концов навстречу, начинают с людей с большим числом друзей, группируют запросы к одному серверу, ограничивают глубину и заранее считают частые цепочки офлайн. Графовые базы (Neo4j) в этой задаче Primer нарочно запрещает.',
        'In interviews the breadth-first search itself is sped up like this: search from both ends towards each other, start from people with many friends, batch lookups to the same server, limit the depth and precompute frequent chains offline. Primer deliberately rules out graph databases (Neo4j) in this problem.',
        '面试中，广度优先搜索本身可以这样加速：从两端相向搜索，从好友多的人开始，把发往同一台服务器的查询合并成批，限制搜索深度，以及离线预先计算常见的认识链。在这道题里，Primer 有意禁止使用图数据库（Neo4j）。',
      ),
    ],
    hitRatio: { cache: 0.7 },
    solution: {
      nodes: [
        n('c1', 'client', tr('Поиск через друзей', 'Friend path search', '好友路径搜索'), 40, 140, { rps: 11574, workload: 'kv', writeShare: 0 }),
        n('c2', 'client', tr('Новые дружбы', 'New friendships', '新增好友关系'), 40, 360, { rps: 300, workload: 'kv', writeShare: 1 }),
        n('l1', 'lb', 'LB', 220, 240),
        n('s1', 'service', 'Graph API', 400, 240, { ...svc('light'), instances: 15 }),
        n('k1', 'cache', 'Redis', 600, 140, { hitRatio: 0.7 }),
        n('d1', 'cassandra', 'Cassandra', 800, 240, { instances: 2 }),
      ],
      edges: [{ id: 'a1', from: 'c1', to: 'l1' }, { id: 'a2', from: 'c2', to: 'l1' }, ...chain('l1', 's1', 'd1'), ...chain('s1', 'k1')],
    },
  },
  {
    id: 'crawler',
    title: tr('Поисковый робот', 'Web Crawler', '网络爬虫'),
    group: 'System Design',
    source: { primer: 'web_crawler' },
    brief: [
      tr(
        'Поисковик по интернету: индекс охватывает **400 млн** страниц, и каждую нужно обходить заново раз в неделю, чтобы результаты были свежими. Вежливый робот заходит на один сайт не чаще раза в несколько секунд, поэтому обходчик работает со многими сайтами сразу: скачать страницу, разобрать её и записать результат — около 120 мс, и экземпляр успевает около 100 страниц в секунду (профиль «тяжёлый»).',
        'A web search engine: the index covers **400M** pages, and each one must be recrawled once a week to keep results fresh. A polite robot visits any one site no more than once every few seconds, so a crawler works on many sites at once: fetching a page, parsing it and writing the result takes about 120 ms, and one instance manages about 100 pages per second (the "heavy" profile).',
        '一个面向互联网的搜索引擎：索引覆盖 **400M** 个页面，为了让结果保持新鲜，每个页面每周都要重新抓取一次。有礼貌的爬虫访问同一个网站的频率不超过每几秒一次，所以一个抓取进程会同时处理很多网站：下载页面、解析并写入结果大约需要 120 ms，一个实例每秒大约能抓取 100 个页面（“重型”类型）。',
      ),
      tr(
        'Найденная ссылка должна приниматься в работу быстрее **50 мс**, необойдённые ссылки не должны копиться. До и после обхода робот сверяет отпечатки страниц, чтобы не ходить по кругу и не хранить копии, — это два запроса по ключу на каждую страницу, ответ нужен быстрее **30 мс**. Пользователи ищут **5000** раз в секунду и ждут не дольше **50 мс**. Бюджет — **$2050**.',
        'A newly found link must be accepted for crawling in under **50 ms**, and uncrawled links must not pile up. Before and after a crawl the robot compares page fingerprints so it does not go in circles or store copies: that is two key lookups per page, each answered in under **30 ms**. Users search **5,000** times per second and wait no longer than **50 ms**. Budget: **$2050**.',
        '新发现的链接必须在 **50 ms** 内被接收进抓取流程，未抓取的链接不能积压。抓取前后，爬虫都会比对页面指纹，避免绕圈子，也避免保存重复的副本：每个页面要做两次按键查询，每次必须在 **30 ms** 内返回。用户每秒搜索 **5,000** 次，最多等 **50 ms**。预算：**$2050**。',
      ),
    ],
    estimate: {
      question: tr('Сколько страниц в секунду нужно обходить?', 'How many pages per second must be crawled?', '每秒需要抓取多少个页面？'),
      answer: 661,
      unit: tr('в секунду', 'per second', '页/秒'),
      formula: tr(
        '400 млн страниц ÷ 7 дней ÷ 86 400 с ≈ 661 страница в секунду',
        '400M pages ÷ 7 days ÷ 86,400 s ≈ 661 pages per second',
        '400M 个页面 ÷ 7 天 ÷ 86,400 s ≈ 每秒 661 个页面',
      ),
    },
    nodes: [
      n('c1', 'client', tr('Поиск', 'Search', '搜索'), 40, 80, { rps: 5000, workload: 'search', writeShare: 0 }),
      n('c2', 'client', tr('Ссылки на обход', 'Links to crawl', '待抓取链接'), 40, 280, { rps: 661, workload: 'search', writeShare: 1 }),
      n('c3', 'client', tr('Проверка дублей', 'Duplicate checks', '重复检查'), 40, 460, { rps: 1322, workload: 'kv', writeShare: 0.5 }),
      n('w1', 'service', tr('Обходчики', 'Crawlers', '抓取进程'), 640, 280, svc('heavy')),
    ],
    edges: [],
    budget: 2050,
    locked: ['c1', 'c2', 'c3', 'w1'],
    goals: [
      { text: tr('Успешных ответов ≥ 99.9%', 'Successful responses ≥ 99.9%', '成功响应 ≥ 99.9%'), check: (r) => r.clientSuccess >= 0.999 },
      { text: tr('Поиск ≤ 50 мс', 'Search ≤ 50 ms', '搜索 ≤ 50 ms'), check: lat('c1', 50) },
      { text: tr('Ссылка принимается ≤ 50 мс', 'A link is accepted ≤ 50 ms', '链接接收 ≤ 50 ms'), check: lat('c2', 50) },
      { text: tr('Проверка дублей ≤ 30 мс', 'Duplicate check ≤ 30 ms', '重复检查 ≤ 30 ms'), check: lat('c3', 30) },
      { text: tr('Каждая ссылка обходится, а страница сохраняется', 'Every link is crawled and its page is stored', '每个链接都被抓取，页面都已保存'), check: flowsAll('w1', 'c2', 'search', 661) },
      {
        text: tr('Пользователи ищут там же, куда обходчики пишут страницы', 'Users search the same place the crawlers write pages to', '用户搜索的正是抓取进程写入页面的地方'),
        check: sharedStore('c2', 'c1'),
      },
      { text: tr('Необойдённые ссылки не копятся', 'Uncrawled links do not pile up', '未抓取的链接不积压'), check: (r) => r.backlogGrowth < 1 },
      { text: tr('Индекс и отпечатки сохраняются', 'The index and fingerprints are persisted', '索引和指纹都已持久化保存'), check: persisted('c1', 'c2', 'c3') },
    ],
    paths: [],
    hints: [
      tr(
        'Обход одной страницы занимает около 120 мс. Если тот, кто раздаёт ссылки, будет ждать обходчика, в 50 мс не уложиться. Нужен посредник, который надёжно примет ссылку сразу, а обходчики будут забирать ссылки в своём темпе — так заодно проще не перегружать сайты.',
        'Crawling one page takes about 120 ms. If whoever hands out links waits for the crawler, 50 ms is out of reach. You need an intermediary that reliably accepts a link immediately, while crawlers take links at their own pace, which also makes it easier not to overload sites.',
        '抓取一个页面大约需要 120 ms。如果分发链接的一方要等抓取进程，就不可能在 50 ms 内完成。你需要一个中间环节：它立即可靠地接收链接，抓取进程再按自己的节奏取走链接。这样也更容易避免压垮网站。',
      ),
      tr(
        'Сколько обходчиков нужно на 661 страницу в секунду, по 100 на каждого? Обойдённая страница должна попасть туда, где по ней можно искать: в хранилище, для которого полнотекстовый поиск — родной профиль. Туда же идут и запросы пользователей.',
        'How many crawlers do you need for 661 pages per second at 100 each? A crawled page must land where it can be searched: the storage for which full-text search is the native workload. User queries go there too.',
        '每个抓取进程每秒 100 个页面，要抓取每秒 661 个页面需要多少个？抓取好的页面必须进入能被搜索的地方：一种把全文搜索当作原生负载的存储。用户的查询也发往那里。',
      ),
      tr(
        'Одни запросы задают миллионы людей, другие — единожды: ответы на популярные можно держать в памяти. А отпечатки страниц — огромный поток коротких чтений и записей по ключу без транзакций: выберите для них хранилище, которое считает такой поток родным.',
        'Some queries are asked by millions of people, others only once: answers to popular ones can be kept in memory. Page fingerprints, meanwhile, are a huge stream of short key reads and writes with no transactions: pick a storage that treats such a stream as native.',
        '有些查询有数百万人在搜，有些只出现一次：热门查询的答案可以放在内存里。而页面指纹是海量的、按键进行的短小读写，不需要事务：为它们选一种把这类负载当作原生类型的存储。',
      ),
    ],
    debrief: [
      tr(
        'Схема поискового робота: граница обхода (frontier) — очередь ссылок с приоритетами; обходчики берут из неё работу, сверяют отпечаток страницы с уже виденными (чтобы не ходить по кругу и не хранить дубли) и кладут текст в обратный индекс. Поиск пользователей читает тот же индекс, популярные запросы отдаёт кэш.',
        'The crawler design: the crawl frontier is a prioritized queue of links; crawlers take work from it, compare the page fingerprint with ones already seen (so they do not go in circles or store duplicates) and put the text into a reverse index. User search reads the same index, and a cache serves popular queries.',
        '网络爬虫的架构：抓取边界（frontier）是一个带优先级的链接队列；抓取进程从中取出任务，把页面指纹与已见过的指纹比对（避免绕圈子，也避免保存重复内容），再把文本放进倒排索引。用户搜索读取的是同一个索引，热门查询由缓存返回。',
      ),
      tr(
        'Вежливость — отдельная тема на интервью: очереди по сайтам, пауза между заходами, `robots.txt`. Primer добавляет свой DNS-кэш, пул соединений и шардирование индекса и хранилища документов. Сами страницы (по 500 КБ) хранят в объектном хранилище: 400 млн страниц — это сотни терабайт.',
        'Politeness is a separate interview topic: per-site queues, a pause between visits, `robots.txt`. Primer adds a local DNS cache, connection pooling and sharding of the index and the document store. The pages themselves (500 KB each) are kept in object storage: 400M pages come to hundreds of terabytes.',
        '礼貌抓取是面试中的一个独立话题：按网站划分的队列、两次访问之间的间隔、`robots.txt`。Primer 还补充了自建的 DNS 缓存、连接池，以及对索引和文档存储做分片。页面本身（每个 500 KB）存放在对象存储中：400M 个页面就是数百 TB。',
      ),
    ],
    hitRatio: { cache: 0.7 },
    solution: {
      nodes: [
        n('c1', 'client', tr('Поиск', 'Search', '搜索'), 40, 80, { rps: 5000, workload: 'search', writeShare: 0 }),
        n('c2', 'client', tr('Ссылки на обход', 'Links to crawl', '待抓取链接'), 40, 280, { rps: 661, workload: 'search', writeShare: 1 }),
        n('c3', 'client', tr('Проверка дублей', 'Duplicate checks', '重复检查'), 40, 460, { rps: 1322, workload: 'kv', writeShare: 0.5 }),
        n('s1', 'service', 'Search API', 240, 80, { ...svc('light'), instances: 7 }),
        n('k1', 'cache', 'Redis', 440, 20, { hitRatio: 0.7 }),
        n('es', 'elastic', tr('Индекс', 'Index', '索引'), 820, 160, { instances: 2 }),
        n('s2', 'service', 'Frontier API', 240, 280, svc('light')),
        n('q1', 'queue', 'Kafka', 440, 280),
        n('w1', 'service', tr('Обходчики', 'Crawlers', '抓取进程'), 640, 280, { ...svc('heavy'), instances: 8 }),
        n('s3', 'service', 'Dedup API', 240, 460, { ...svc('light'), instances: 2 }),
        n('cs', 'cassandra', tr('Отпечатки', 'Fingerprints', '指纹'), 640, 460),
      ],
      edges: [...chain('c1', 's1', 'es'), ...chain('s1', 'k1'), ...chain('c2', 's2', 'q1', 'w1', 'es'), ...chain('c3', 's3', 'cs')],
    },
  },
]
