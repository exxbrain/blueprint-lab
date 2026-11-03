/**
 * Event Sourcing: состояние счёта — свёртка неизменяемого журнала событий.
 * Каждая задача — набор архитектурных решений; модель прогоняет журнал и показывает последствия.
 */

import { tr, locale } from '../../i18n'

export type EsTone = 'ok' | 'warn' | 'bad' | 'info'

export interface ShownEvent {
  seq: number
  type: string
  data: string
  version?: number
  mark?: 'deleted' | 'edited' | 'new' | 'upcast' | 'error' | 'snapshot'
  note?: string
}

export interface EsRun {
  events: ShownEvent[]
  facts: { label: string; value: string; tone?: EsTone }[]
  log: { tone: EsTone; text: string }[]
  /** Были ли изменены или удалены уже записанные события */
  tampered: boolean
  values: Record<string, number>
}

export interface EsOption {
  key: string
  label: string
  choices: { value: string; label: string }[]
}

export type EsConfig = Record<string, string>

export interface EsTask {
  id: string
  title: string
  brief: string[]
  options: EsOption[]
  start: EsConfig
  run: (cfg: EsConfig) => EsRun
  goals: { text: string; check: (r: EsRun, cfg: EsConfig) => boolean }[]
  hints: string[]
  debrief: string[]
  solution: EsConfig
}

const rub = (n: number) => `${n.toLocaleString(locale)} ₽`

// ---------------- 1. Ошибочное списание ----------------

const reversal: EsTask = {
  id: 'double-charge',
  title: tr('Ошибочное списание', 'Erroneous withdrawal', '错误扣款'),
  brief: tr(
    [
      'Из-за сбоя процессинга оплата в кафе на 300 ₽ списалась **дважды** (событие #4 — дубль #3). Клиент звонит в поддержку, баланс нужно исправить.',
      'Счёт ведётся через Event Sourcing: журнал — источник истины, баланс — свёртка событий. По требованию регулятора история операций должна сохраняться полностью.',
    ],
    [
      'Due to a payment processing glitch, a 300 ₽ café payment was withdrawn **twice** (event #4 duplicates #3). The customer calls support, and the balance must be fixed.',
      'The account uses Event Sourcing: the event log is the source of truth, the balance is a fold over the events. The regulator requires the full transaction history to be preserved.',
    ],
    [
      '由于支付处理故障，一笔 300 ₽ 的咖啡馆消费被扣了**两次**（事件 #4 是 #3 的重复）。客户打电话给客服，余额需要修正。',
      '这个账户采用事件溯源：事件日志是事实来源，余额是对所有事件折叠（fold）计算的结果。监管要求完整保留交易历史。',
    ],
  ),
  options: [
    {
      key: 'fix',
      label: tr('Как исправить', 'How to fix it', '如何修正'),
      choices: [
        { value: 'none', label: tr('Пока ничего не делать', 'Do nothing for now', '暂时什么也不做') },
        { value: 'delete', label: tr('Удалить событие #4 из журнала', 'Delete event #4 from the log', '从日志中删除事件 #4') },
        { value: 'edit', label: tr('Изменить сумму события #4 на 0', 'Change the amount of event #4 to 0', '把事件 #4 的金额改为 0') },
        { value: 'deposit', label: tr('Добавить событие «Пополнение 300 ₽»', 'Append a “Deposit 300 ₽” event', '追加一个“存入 300 ₽”事件') },
        { value: 'reverse', label: tr('Добавить событие «Сторно операции #4»', 'Append a “Reversal of transaction #4” event', '追加一个“冲正交易 #4”事件') },
      ],
    },
  ],
  start: { fix: 'none' },
  run: (cfg) => {
    const base: ShownEvent[] = [
      { seq: 1, type: tr('СчётОткрыт', 'AccountOpened', '账户已开立'), data: tr('владелец: Иванов', 'owner: Ivanov', '持有人：伊万诺夫') },
      { seq: 2, type: tr('Пополнен', 'Deposited', '已存入'), data: rub(1000) },
      { seq: 3, type: tr('Списан', 'Withdrawn', '已扣款'), data: tr(`${rub(300)}, кафе «Ромашка»`, `${rub(300)}, Daisy Café`, `${rub(300)}，雏菊咖啡馆`) },
      { seq: 4, type: tr('Списан', 'Withdrawn', '已扣款'), data: tr(`${rub(300)}, кафе «Ромашка»`, `${rub(300)}, Daisy Café`, `${rub(300)}，雏菊咖啡馆`), note: tr('дубль из-за сбоя', 'duplicate caused by a glitch', '故障导致的重复扣款') },
    ]
    let balance = 400
    let tampered = false
    const log: EsRun['log'] = []
    if (cfg.fix === 'delete') {
      base[3] = { ...base[3], mark: 'deleted' }
      balance = 700
      tampered = true
      log.push({ tone: 'bad', text: tr(
          'Событие удалено. Аудит больше не увидит, что списание было и его исправили: история переписана задним числом.',
          'Event deleted. An audit will no longer see that the withdrawal happened and was corrected: history has been rewritten retroactively.',
          '事件已删除。审计再也看不到这笔扣款曾经发生、后来又被修正：历史被追溯改写了。',
        ),
      })
    } else if (cfg.fix === 'edit') {
      base[3] = { ...base[3], data: tr(`${rub(0)}, кафе «Ромашка»`, `${rub(0)}, Daisy Café`, `${rub(0)}，雏菊咖啡馆`), mark: 'edited' }
      balance = 700
      tampered = true
      log.push({ tone: 'bad', text: tr(
          'Событие изменено. Проекции и подписчики, уже обработавшие исходное событие, разошлись с журналом.',
          'Event modified. Projections and subscribers that already processed the original event are now out of sync with the log.',
          '事件已修改。已经处理过原始事件的投影和订阅者，现在与日志不一致了。',
        ),
      })
    } else if (cfg.fix === 'deposit') {
      base.push({ seq: 5, type: tr('Пополнен', 'Deposited', '已存入'), data: rub(300), mark: 'new' })
      balance = 700
      log.push({ tone: 'warn', text: tr(
          'Баланс сходится, но в выписке клиент увидит пополнение из ниоткуда, а дубль списания так и останется «настоящим».',
          'The balance adds up, but the customer’s statement shows a deposit out of nowhere, and the duplicate withdrawal still looks “real”.',
          '余额对上了，但客户的账单里会出现一笔凭空而来的存入，而那笔重复扣款看起来仍然是“真实”的。',
        ),
      })
    } else if (cfg.fix === 'reverse') {
      base.push({ seq: 5, type: tr('Сторнирован', 'Reversed', '已冲正'), data: tr(`${rub(300)}, отмена операции #4`, `${rub(300)}, reverses transaction #4`, `${rub(300)}，冲正交易 #4`), mark: 'new' })
      balance = 700
      log.push({ tone: 'ok', text: tr(
          'Компенсирующее событие явно ссылается на ошибочную операцию: история цела, баланс верный, причина видна.',
          'The compensating event explicitly references the erroneous transaction: history is intact, the balance is correct, the reason is visible.',
          '补偿事件明确引用了出错的交易：历史完整，余额正确，原因一目了然。',
        ),
      })
    }
    return {
      events: base,
      facts: [
        { label: tr('Баланс (свёртка журнала)', 'Balance (fold of the log)', '余额（日志折叠结果）'), value: rub(balance), tone: balance === 700 ? 'ok' : 'bad' },
        { label: tr('История неизменна', 'History unchanged', '历史未被改动'), value: tampered ? tr('нет', 'no', '否') : tr('да', 'yes', '是'), tone: tampered ? 'bad' : 'ok' },
      ],
      log,
      tampered,
      values: { balance, reversed: cfg.fix === 'reverse' ? 1 : 0 },
    }
  },
  goals: [
    { text: tr('Баланс 700 ₽', 'Balance 700 ₽', '余额 700 ₽'), check: (r) => r.values.balance === 700 },
    { text: tr('Журнал не изменён и не урезан', 'The log is neither modified nor truncated', '日志既未被修改，也未被截断'), check: (r) => !r.tampered },
    { text: tr('В истории видно, какая операция ошибочная', 'History shows which transaction was erroneous', '历史中能看出哪笔交易是错误的'), check: (r) => r.values.reversed === 1 },
  ],
  hints: tr(
    [
      'Журнал событий append-only: в нём ничего не удаляют и не правят.',
      'Ошибка исправляется новым событием — как в бухгалтерии.',
      'Пополнение исправит сумму, но не смысл. Нужна явная отмена конкретной операции.',
    ],
    [
      'The event log is append-only: nothing in it is deleted or edited.',
      'A mistake is fixed with a new event — just like in accounting.',
      'A deposit fixes the amount but not the meaning. You need an explicit reversal of a specific transaction.',
    ],
    [
      '事件日志是 append-only（只追加）的：其中的内容既不删除，也不修改。',
      '错误要用一个新事件来修正——就像会计做账一样。',
      '存入能修正金额，却修正不了含义。需要明确地冲正某一笔具体交易。',
    ],
  ),
  debrief: tr(
    [
      'Компенсирующее событие (сторно) — способ исправлять ошибки в Event Sourcing. История остаётся полной, а любой читатель видит, что произошло и как это исправили.',
      'Удаление или правка событий ломает главное свойство журнала. Проекции и внешние подписчики уже обработали исходное событие, и источник истины перестаёт быть истиной.',
    ],
    [
      'A compensating event (reversal) is how you fix mistakes in Event Sourcing. History stays complete, and any reader can see what happened and how it was fixed.',
      'Deleting or editing events breaks the log’s key property. Projections and external subscribers have already processed the original event, and the source of truth stops being the truth.',
    ],
    [
      '补偿事件（冲正）是事件溯源中修正错误的方式。历史保持完整，任何读者都能看到发生了什么、又是如何修正的。',
      '删除或修改事件会破坏日志最重要的特性。投影和外部订阅者早已处理了原始事件，事实来源也就不再是事实。',
    ],
  ),
  solution: { fix: 'reverse' },
}

// ---------------- 2. Новый отчёт задним числом ----------------

const DEPOSITS = [
  { day: 2, amount: 5000 },
  { day: 9, amount: 1200 },
  { day: 15, amount: 800 },
  { day: 23, amount: 3000 },
  { day: 28, amount: 500 },
]
const DEPLOY_DAY = 20

const rebuild: EsTask = {
  id: 'new-report',
  title: tr('Новый отчёт задним числом', 'A new report, retroactively', '追溯生成新报表'),
  brief: tr(
    [
      'Маркетинг просит отчёт «сумма пополнений за месяц» — **за весь месяц**, а не с сегодняшнего дня. Проекцию для отчёта выкатили 20-го числа, и она уже успела посчитать пополнения с 20-го по 28-е.',
      'В CRUD-системе историю пришлось бы восстанавливать по логам. Здесь есть журнал: как правильно наполнить новую проекцию?',
    ],
    [
      'Marketing wants a “total deposits for the month” report — **for the whole month**, not from today onwards. The report projection was deployed on the 20th and has already counted deposits from the 20th to the 28th.',
      'In a CRUD system you would have to reconstruct history from logs. Here you have an event log: how do you populate the new projection correctly?',
    ],
    [
      '市场部想要一份“本月存入总额”报表——要**整个月**的，而不是从今天开始。报表投影是 20 日上线的，已经统计了 20 日到 28 日的存入。',
      '在 CRUD 系统中，历史只能靠翻查运行日志来还原。而这里有事件日志：该如何正确地填充新的投影？',
    ],
  ),
  options: [
    {
      key: 'from',
      label: tr('Читать журнал', 'Read the log', '读取日志'),
      choices: [
        { value: 'now', label: tr('с текущей позиции (только новые события)', 'from the current position (new events only)', '从当前位置开始（只读新事件）') },
        { value: 'start', label: tr('с самого начала', 'from the very beginning', '从最开始') },
      ],
    },
    {
      key: 'reset',
      label: tr('Перед перестроением', 'Before rebuilding', '重建之前'),
      choices: [
        { value: 'keep', label: tr('оставить уже посчитанное', 'keep what is already counted', '保留已统计的结果') },
        { value: 'clear', label: tr('очистить проекцию', 'clear the projection', '清空投影') },
      ],
    },
  ],
  start: { from: 'now', reset: 'keep' },
  run: (cfg) => {
    const truth = DEPOSITS.reduce((s, d) => s + d.amount, 0)
    const already = DEPOSITS.filter((d) => d.day >= DEPLOY_DAY).reduce((s, d) => s + d.amount, 0)
    let value = cfg.reset === 'clear' ? 0 : already
    const shown: ShownEvent[] = DEPOSITS.map((d, i) => {
      const replayed = cfg.from === 'start'
      const counted = replayed || d.day >= DEPLOY_DAY
      return {
        seq: i + 1,
        type: tr('Пополнен', 'Deposited', '已存入'),
        data: tr(`${rub(d.amount)}, ${d.day}-е число`, `${rub(d.amount)}, day ${d.day}`, `${rub(d.amount)}，${d.day} 日`),
        mark: counted ? 'new' : undefined,
        note: replayed
          ? cfg.reset === 'keep' && d.day >= DEPLOY_DAY
            ? tr('посчитано дважды', 'counted twice', '被统计了两次')
            : tr('проиграно заново', 'replayed', '已重放')
          : counted
            ? tr('учтено после выката', 'counted after deploy', '上线后已统计')
            : tr('не учтено', 'not counted', '未统计'),
      }
    })
    if (cfg.from === 'start') value += truth
    const log: EsRun['log'] = []
    if (cfg.from === 'now') log.push({ tone: 'bad', text: tr(`Пополнения до ${DEPLOY_DAY}-го в отчёт не попали.`, `Deposits before the ${DEPLOY_DAY}th are missing from the report.`, `${DEPLOY_DAY} 日之前的存入没有进入报表。`) })
    if (cfg.from === 'start' && cfg.reset === 'keep')
      log.push({ tone: 'bad', text: tr('Журнал проигран поверх старых данных: события после выката посчитаны дважды.', 'The log was replayed on top of old data: events after the deploy were counted twice.', '日志是在旧数据之上重放的：上线之后的事件被统计了两次。') })
    if (cfg.from === 'start' && cfg.reset === 'clear')
      log.push({ tone: 'ok', text: tr('Проекция очищена и построена заново по всей истории — как будто она была с первого дня.', 'The projection was cleared and rebuilt from the full history — as if it had existed since day one.', '投影已清空，并基于完整历史重新构建——就好像它从第一天起就存在一样。') })
    return {
      events: shown,
      facts: [
        { label: tr('Отчёт показывает', 'Report shows', '报表显示'), value: rub(value), tone: value === truth ? 'ok' : 'bad' },
        { label: tr('На самом деле', 'Actual total', '实际总额'), value: rub(truth) },
      ],
      log,
      tampered: false,
      values: { value, truth },
    }
  },
  goals: [{ text: tr('Отчёт совпадает с реальной суммой за месяц', 'The report matches the actual monthly total', '报表与本月实际总额一致'), check: (r) => r.values.value === r.values.truth }],
  hints: tr(
    [
      'Журнал хранит все пополнения с начала месяца. Новой проекции достаточно его прочитать.',
      'Если проигрывать журнал поверх уже посчитанного, часть событий учтётся дважды.',
    ],
    [
      'The log holds every deposit since the start of the month. The new projection just needs to read it.',
      'If you replay the log on top of what is already counted, some events will be counted twice.',
    ],
    [
      '日志保存了从月初开始的每一笔存入。新投影只需要读取它。',
      '如果在已统计的结果之上重放日志，一部分事件会被统计两次。',
    ],
  ),
  debrief: tr(
    [
      'Перестроение проекции (replay) — суперсила Event Sourcing: новое представление данных можно получить для всей истории, а не с момента релиза. Так же чинят проекции после багов.',
      'Проекция должна строиться с нуля или быть идемпотентной (помнить последнюю обработанную позицию журнала). Иначе повторный прогон удваивает данные.',
    ],
    [
      'Rebuilding a projection (replay) is the superpower of Event Sourcing: a new view of the data can cover the entire history, not just from the release onwards. The same technique fixes projections after bugs.',
      'A projection must be built from scratch or be idempotent (remember the last processed log position). Otherwise a second run doubles the data.',
    ],
    [
      '重建投影（replay）是事件溯源的超能力：新的数据视图可以覆盖全部历史，而不只是从发布那天开始。修复出过 bug 的投影也用同样的方法。',
      '投影必须从零开始构建，或者是幂等的（记住最后处理到的日志位置）。否则再跑一遍，数据就会翻倍。',
    ],
  ),
  solution: { from: 'start', reset: 'clear' },
}

// ---------------- 3. Снапшоты ----------------

const TOTAL = 50_000
const PER_DAY = 2_000
const PER_EVENT_MS = 0.01
const SNAPSHOT_LOAD_MS = 2

const snapshots: EsTask = {
  id: 'slow-account',
  title: tr('Медленная загрузка счёта', 'Slow account loading', '账户加载缓慢'),
  brief: tr(
    [
      'У корпоративного счёта **50 000** событий, и каждый день добавляется ещё **2 000**. Чтобы обработать команду, агрегат загружает и сворачивает весь журнал — это уже 500 мс на каждый платёж.',
      'Нужно, чтобы загрузка в худшем случае занимала не больше 15 мс. Но и снапшотов не больше четырёх в день: каждый — тяжёлая запись и место в хранилище.',
    ],
    [
      'A corporate account has **50,000** events, and another **2,000** are added every day. To handle a command, the aggregate loads and folds the entire stream — already 500 ms per payment.',
      'Worst-case loading must take no more than 15 ms. But there may be no more than four snapshots per day: each one is a heavy write and takes storage space.',
    ],
    [
      '一个企业账户有 **50,000** 个事件，每天还会新增 **2,000** 个。为了处理一条命令，聚合要加载并折叠整个事件流——现在每笔支付已经要 500 ms。',
      '最坏情况下，加载时间不能超过 15 ms。但每天的快照不能超过四个：每个快照都是一次重量级写入，还要占用存储空间。',
    ],
  ),
  options: [
    {
      key: 'every',
      label: tr('Снапшот состояния каждые', 'Take a state snapshot every', '状态快照的频率'),
      choices: [
        { value: '0', label: tr('не делать снапшоты', 'no snapshots', '不做快照') },
        { value: '100', label: tr('100 событий', '100 events', '每 100 个事件') },
        { value: '500', label: tr('500 событий', '500 events', '每 500 个事件') },
        { value: '1000', label: tr('1 000 событий', '1,000 events', '每 1,000 个事件') },
        { value: '5000', label: tr('5 000 событий', '5,000 events', '每 5,000 个事件') },
      ],
    },
  ],
  start: { every: '0' },
  run: (cfg) => {
    const every = Number(cfg.every)
    const tail = every ? every - 1 : TOTAL
    const load = (every ? SNAPSHOT_LOAD_MS : 0) + tail * PER_EVENT_MS
    const perDay = every ? PER_DAY / every : 0
    const events: ShownEvent[] = every
      ? [
          { seq: TOTAL - tail, type: tr('Снапшот', 'Snapshot', '快照'), data: tr(`состояние на событии #${TOTAL - tail}`, `state as of event #${TOTAL - tail}`, `截至事件 #${TOTAL - tail} 的状态`), mark: 'snapshot' },
          { seq: TOTAL - tail + 1, type: '…', data: tr(`ещё ${tail - 1} событий`, `${tail - 1} more events`, `另外 ${tail - 1} 个事件`), mark: 'new' },
          { seq: TOTAL, type: tr('Списан', 'Withdrawn', '已扣款'), data: tr('последнее событие', 'latest event', '最新事件'), mark: 'new' },
        ]
      : [
          { seq: 1, type: tr('СчётОткрыт', 'AccountOpened', '账户已开立'), data: tr('начало истории', 'start of history', '历史起点'), mark: 'new' },
          { seq: 2, type: '…', data: tr(`ещё ${TOTAL - 2} событий`, `${TOTAL - 2} more events`, `另外 ${TOTAL - 2} 个事件`), mark: 'new' },
          { seq: TOTAL, type: tr('Списан', 'Withdrawn', '已扣款'), data: tr('последнее событие', 'latest event', '最新事件'), mark: 'new' },
        ]
    return {
      events,
      facts: [
        { label: tr('Загрузка агрегата (худший случай)', 'Aggregate load time (worst case)', '聚合加载时间（最坏情况）'), value: tr(`${load.toFixed(1)} мс`, `${load.toFixed(1)} ms`, `${load.toFixed(1)} ms`), tone: load <= 15 ? 'ok' : 'bad' },
        { label: tr('Снапшотов в день', 'Snapshots per day', '每天快照数'), value: perDay.toFixed(perDay % 1 ? 1 : 0), tone: perDay <= 4 ? 'ok' : 'bad' },
        { label: tr('Событий читается при загрузке', 'Events read on load', '加载时读取的事件数'), value: `${tail.toLocaleString(locale)}` },
      ],
      log: [],
      tampered: false,
      values: { load, perDay },
    }
  },
  goals: [
    { text: tr('Загрузка ≤ 15 мс', 'Load time ≤ 15 ms', '加载时间 ≤ 15 ms'), check: (r) => r.values.load <= 15 },
    { text: tr('Не больше 4 снапшотов в день', 'At most 4 snapshots per day', '每天最多 4 个快照'), check: (r) => r.values.perDay <= 4 },
  ],
  hints: tr(
    [
      'Снапшот — сохранённое состояние агрегата. Загрузка = снапшот + события после него.',
      'В худшем случае после снапшота накопилось почти «интервал» событий. 0,01 мс на событие.',
      '2 000 событий в день ÷ интервал = снапшотов в день.',
    ],
    [
      'A snapshot is the saved state of the aggregate. Loading = snapshot + the events after it.',
      'In the worst case almost a full “interval” of events has piled up since the snapshot. 0.01 ms per event.',
      '2,000 events per day ÷ interval = snapshots per day.',
    ],
    [
      '快照是聚合保存下来的状态。加载 = 快照 + 其后的事件。',
      '最坏情况下，快照之后已经积累了几乎一整个“间隔”的事件。每个事件 0.01 ms。',
      '每天 2,000 个事件 ÷ 间隔 = 每天的快照数。',
    ],
  ),
  debrief: tr(
    [
      'Снапшоты — оптимизация, а не источник истины: их можно выбросить и пересчитать из журнала. Интервал — компромисс между скоростью загрузки и стоимостью записи.',
      'Подводный камень: при изменении логики агрегата старые снапшоты устаревают. Их версионируют и пересоздают, а журнал остаётся прежним.',
    ],
    [
      'Snapshots are an optimization, not a source of truth: they can be thrown away and recomputed from the log. The interval is a trade-off between load speed and write cost.',
      'The catch: when the aggregate logic changes, old snapshots become stale. They are versioned and recreated, while the log stays the same.',
    ],
    [
      '快照是一种优化，而不是事实来源：可以把它们丢掉，再从日志重新计算出来。间隔是加载速度与写入成本之间的权衡。',
      '需要注意的坑：聚合逻辑一旦改变，旧快照就过时了。快照要做版本管理并重新生成，而日志保持不变。',
    ],
  ),
  solution: { every: '1000' },
}

// ---------------- 4. Версии событий ----------------

const versioning: EsTask = {
  id: 'event-version',
  title: tr('Новая версия события', 'A new event version', '事件的新版本'),
  brief: tr(
    [
      'Банк запускает валютные счета. Событие «Пополнен» получает новое поле **currency**: v1 = {amount}, v2 = {amount, currency}. Новый код умеет работать только с v2.',
      'В журнале три года событий v1. После релиза приходит первое пополнение в долларах. Баланс в рублях должен считаться правильно (курс 100 ₽ за $), а журнал — оставаться неизменным.',
    ],
    [
      'The bank is launching foreign-currency accounts. The “Deposited” event gets a new **currency** field: v1 = {amount}, v2 = {amount, currency}. The new code only understands v2.',
      'The log holds three years of v1 events. After the release, the first deposit in dollars arrives. The balance in rubles must be computed correctly (rate: 100 ₽ per $), and the log must stay unchanged.',
    ],
    [
      '银行要推出外币账户。“已存入”事件新增了一个 **currency** 字段：v1 = {amount}，v2 = {amount, currency}。新代码只认识 v2。',
      '日志里存着三年的 v1 事件。发布之后，第一笔美元存款到账了。卢布余额必须算对（汇率：100 ₽ 兑 1 $），并且日志必须保持不变。',
    ],
  ),
  options: [
    {
      key: 'strategy',
      label: tr('Как быть со старыми событиями v1', 'What to do with old v1 events', '如何处理旧的 v1 事件'),
      choices: [
        { value: 'none', label: tr('ничего не делать', 'do nothing', '什么也不做') },
        { value: 'rewrite', label: tr('миграцией переписать все v1 в журнале на v2', 'run a migration that rewrites every v1 in the log to v2', '运行迁移，把日志中所有 v1 改写为 v2') },
        { value: 'upcaster', label: tr('upcaster: при чтении превращать v1 в v2 с currency = RUB', 'upcaster: convert v1 to v2 with currency = RUB on read', 'upcaster：读取时把 v1 转换为 currency = RUB 的 v2') },
        { value: 'default-usd', label: tr('считать поле currency необязательным, по умолчанию USD', 'make the currency field optional, defaulting to USD', '把 currency 字段设为可选，默认值为 USD') },
      ],
    },
  ],
  start: { strategy: 'none' },
  run: (cfg) => {
    const olds = [5000, 2000]
    const events: ShownEvent[] = olds.map((a, i) => ({ seq: i + 1, type: tr('Пополнен', 'Deposited', '已存入'), data: `amount: ${a}`, version: 1 }))
    events.push({ seq: 3, type: tr('Пополнен', 'Deposited', '已存入'), data: 'amount: 100, currency: USD', version: 2, mark: 'new' })
    let balance = 0
    let errors = 0
    let tampered = false
    const log: EsRun['log'] = []
    if (cfg.strategy === 'none') {
      errors = 2
      for (const e of events.slice(0, 2)) e.mark = 'error'
      balance = 100 * 100
      log.push({ tone: 'bad', text: tr('Новый код не может прочитать события v1: загрузка счёта падает с ошибкой десериализации.', 'The new code cannot read v1 events: loading the account fails with a deserialization error.', '新代码无法读取 v1 事件：加载账户时因反序列化错误而失败。') })
    } else if (cfg.strategy === 'rewrite') {
      tampered = true
      for (const e of events.slice(0, 2)) {
        e.mark = 'edited'
        e.data += ', currency: RUB'
        e.version = 2
      }
      balance = 7000 + 10000
      log.push({ tone: 'bad', text: tr(
          'Миллионы событий переписаны: журнал перестал быть неизменным, а архивы, бэкапы и копии у подписчиков разошлись с ним.',
          'Millions of events rewritten: the log is no longer immutable, and archives, backups and subscribers’ copies are now out of sync with it.',
          '数百万个事件被改写：日志不再是不可变的，归档、备份以及订阅者手中的副本都与它不一致了。',
        ),
      })
    } else if (cfg.strategy === 'upcaster') {
      for (const e of events.slice(0, 2)) {
        e.mark = 'upcast'
        e.note = tr('при чтении → v2, currency: RUB', 'on read → v2, currency: RUB', '读取时 → v2，currency: RUB')
      }
      balance = 7000 + 10000
      log.push({ tone: 'ok', text: tr('Журнал нетронут, новый код видит только v2: upcaster дополняет старые события на лету.', 'The log is untouched and the new code only sees v2: the upcaster fills in old events on the fly.', '日志没有被改动，新代码只看到 v2：upcaster 在读取时即时补全旧事件。') })
    } else {
      for (const e of events.slice(0, 2)) e.note = tr('прочитано как USD', 'read as USD', '按 USD 读取')
      balance = 7000 * 100 + 10000
      log.push({ tone: 'bad', text: tr('Старые рублёвые пополнения прочитаны как доллары: баланс завышен в сто раз.', 'Old ruble deposits were read as dollars: the balance is inflated a hundredfold.', '旧的卢布存款被当成了美元：余额虚高了一百倍。') })
    }
    return {
      events,
      facts: [
        { label: tr('Баланс в рублях', 'Balance in rubles', '卢布余额'), value: rub(balance), tone: balance === 17000 ? 'ok' : 'bad' },
        { label: tr('Ошибок чтения', 'Read errors', '读取错误'), value: String(errors), tone: errors ? 'bad' : 'ok' },
        { label: tr('Журнал неизменен', 'Log unchanged', '日志未被改动'), value: tampered ? tr('нет', 'no', '否') : tr('да', 'yes', '是'), tone: tampered ? 'bad' : 'ok' },
      ],
      log,
      tampered,
      values: { balance, errors },
    }
  },
  goals: [
    { text: tr('Все события читаются', 'All events can be read', '所有事件都能读取'), check: (r) => r.values.errors === 0 },
    { text: tr('Баланс 17 000 ₽', 'Balance 17,000 ₽', '余额 17,000 ₽'), check: (r) => r.values.balance === 17000 },
    { text: tr('Журнал не изменён', 'The log is unchanged', '日志未被修改'), check: (r) => !r.tampered },
  ],
  hints: tr(
    [
      'Журнал неизменен — значит, события v1 в нём останутся навсегда.',
      'Код может приводить старую версию к новой в момент чтения.',
      'Значение по умолчанию должно соответствовать тому, что было в старых событиях.',
    ],
    [
      'The log is immutable — so the v1 events will stay in it forever.',
      'Code can convert the old version to the new one at read time.',
      'The default value must match what the old events actually meant.',
    ],
    [
      '日志是不可变的——所以 v1 事件会永远留在里面。',
      '代码可以在读取时把旧版本转换成新版本。',
      '默认值必须与旧事件实际表达的含义一致。',
    ],
  ),
  debrief: tr(
    [
      'Upcasting — стандартный способ эволюции событий: старые версии хранятся как есть, а при чтении цепочка upcaster-ов поднимает их до текущей. Новый код знает только последнюю версию.',
      'Другие варианты — новый тип события («ПополненВВалюте») или слабая схема с разумными значениями по умолчанию. Править события на месте нельзя никогда. Допустимая крайняя мера — copy-and-transform: прочитать старый журнал, преобразовать и записать в новое хранилище событий, а старое оставить как есть (Грег Янг).',
    ],
    [
      'Upcasting is the standard way to evolve events: old versions are stored as is, and on read a chain of upcasters brings them up to the current version. The new code only knows the latest version.',
      'Other options are a new event type (“DepositedInCurrency”) or a weak schema with sensible defaults. Editing events in place is never acceptable. A legitimate last resort is copy-and-transform: read the old log, transform it and write it into a new event store, leaving the old one untouched (Greg Young).',
    ],
    [
      'Upcasting 是演进事件的标准方式：旧版本按原样存储，读取时由一串 upcaster 把它们逐级升级到当前版本。新代码只需要了解最新版本。',
      '其他做法包括：新增一种事件类型（“已存入外币”），或者使用带合理默认值的弱 schema。就地修改事件是绝对不可以的。可以接受的最后手段是 copy-and-transform：读取旧日志，转换后写入新的事件存储，旧的原样保留（Greg Young）。',
    ],
  ),
  solution: { strategy: 'upcaster' },
}

// ---------------- 5. Параллельные команды ----------------

const concurrency: EsTask = {
  id: 'two-withdrawals',
  title: tr('Два списания одновременно', 'Two withdrawals at once', '同时发生的两笔扣款'),
  brief: tr(
    [
      'На счёте **500 ₽**. С телефона и с карты почти одновременно приходят две команды «списать 400 ₽». Каждый обработчик загружает агрегат (версия 2), проверяет «хватает ли денег» и дописывает событие.',
      'Уйти в минус нельзя. При этом счёт обслуживает тысячи операций в секунду, так что держать долгие блокировки на запись тоже нельзя.',
    ],
    [
      'The account holds **500 ₽**. Two “withdraw 400 ₽” commands arrive almost simultaneously, from a phone and from a card. Each handler loads the aggregate (version 2), checks “is there enough money”, and appends an event.',
      'The balance must never go negative. At the same time, the account handles thousands of operations per second, so long write locks are not an option either.',
    ],
    [
      '账户里有 **500 ₽**。来自手机和银行卡的两条“扣款 400 ₽”命令几乎同时到达。每个处理器都会加载聚合（版本 2），检查“钱够不够”，然后追加一个事件。',
      '余额绝不能变成负数。同时，这个账户每秒要处理数千笔操作，所以长时间持有写锁也不可行。',
    ],
  ),
  options: [
    {
      key: 'control',
      label: tr('Контроль параллельности', 'Concurrency control', '并发控制'),
      choices: [
        { value: 'none', label: tr('нет — просто дописываем событие', 'none — just append the event', '不控制——直接追加事件') },
        { value: 'lock', label: tr('пессимистическая блокировка счёта на время обработки', 'pessimistic lock on the account during processing', '处理期间对账户加悲观锁') },
        { value: 'optimistic', label: tr('оптимистическая: дописать, только если версия всё ещё 2', 'optimistic: append only if the version is still 2', '乐观并发：仅当版本仍为 2 时才追加') },
      ],
    },
  ],
  start: { control: 'none' },
  run: (cfg) => {
    const events: ShownEvent[] = [
      { seq: 1, type: tr('СчётОткрыт', 'AccountOpened', '账户已开立'), data: tr('владелец: Петров', 'owner: Petrov', '持有人：彼得罗夫') },
      { seq: 2, type: tr('Пополнен', 'Deposited', '已存入'), data: rub(500) },
    ]
    const log: EsRun['log'] = []
    let balance = 500
    let locks = 0
    if (cfg.control === 'none') {
      events.push({ seq: 3, type: tr('Списан', 'Withdrawn', '已扣款'), data: tr(`${rub(400)}, телефон`, `${rub(400)}, phone`, `${rub(400)}，手机`), mark: 'new' })
      events.push({ seq: 4, type: tr('Списан', 'Withdrawn', '已扣款'), data: tr(`${rub(400)}, карта`, `${rub(400)}, card`, `${rub(400)}，银行卡`), mark: 'error', note: tr('проверка видела устаревший баланс', 'the check saw a stale balance', '检查时看到的是过时的余额') })
      balance = -300
      log.push({ tone: 'bad', text: tr('Оба обработчика видели 500 ₽ и оба списали. Баланс −300 ₽.', 'Both handlers saw 500 ₽ and both withdrew. Balance: −300 ₽.', '两个处理器都看到了 500 ₽，于是都扣了款。余额：−300 ₽。') })
    } else if (cfg.control === 'lock') {
      events.push({ seq: 3, type: tr('Списан', 'Withdrawn', '已扣款'), data: tr(`${rub(400)}, телефон`, `${rub(400)}, phone`, `${rub(400)}，手机`), mark: 'new' })
      balance = 100
      locks = 1
      log.push({ tone: 'warn', text: tr(
          'Второй обработчик ждал блокировку, затем увидел 100 ₽ и отказал. Корректно, но под нагрузкой очередь на блокировку растёт.',
          'The second handler waited for the lock, then saw 100 ₽ and rejected the command. Correct, but under load the lock queue keeps growing.',
          '第二个处理器等待锁释放，随后看到 100 ₽，拒绝了命令。结果正确，但在高负载下，等待锁的队列会越来越长。',
        ),
      })
      log.push({ tone: 'info', text: tr('Команда с карты отклонена: недостаточно средств.', 'The card command was rejected: insufficient funds.', '来自银行卡的命令被拒绝：余额不足。') })
    } else {
      events.push({ seq: 3, type: tr('Списан', 'Withdrawn', '已扣款'), data: tr(`${rub(400)}, телефон`, `${rub(400)}, phone`, `${rub(400)}，手机`), mark: 'new' })
      balance = 100
      log.push({ tone: 'info', text: tr('Карта пыталась дописать событие при ожидаемой версии 2, но версия уже 3 — конфликт.', 'The card tried to append an event with expected version 2, but the version is already 3 — conflict.', '银行卡一侧试图以预期版本 2 追加事件，但版本已经是 3——发生冲突。') })
      log.push({ tone: 'ok', text: tr('Обработчик перечитал агрегат (100 ₽) и отклонил команду: недостаточно средств. Без блокировок.', 'The handler reloaded the aggregate (100 ₽) and rejected the command: insufficient funds. No locks.', '处理器重新加载聚合（100 ₽），并拒绝了命令：余额不足。全程无锁。') })
    }
    return {
      events,
      facts: [
        { label: tr('Баланс', 'Balance', '余额'), value: rub(balance), tone: balance >= 0 ? 'ok' : 'bad' },
        { label: tr('Блокировки на время обработки', 'Locks during processing', '处理期间加锁'), value: locks ? tr('да', 'yes', '是') : tr('нет', 'no', '否'), tone: locks ? 'warn' : 'ok' },
      ],
      log,
      tampered: false,
      values: { balance, locks },
    }
  },
  goals: [
    { text: tr('Баланс не уходит в минус', 'The balance never goes negative', '余额不会变成负数'), check: (r) => r.values.balance >= 0 },
    { text: tr('Без блокировок на время обработки', 'No locks during processing', '处理期间不加锁'), check: (r) => r.values.locks === 0 },
  ],
  hints: tr(
    [
      'Оба обработчика проверили баланс по одной и той же версии агрегата.',
      'Событие можно дописать условно: «только если последнее событие в потоке — #2».',
    ],
    [
      'Both handlers checked the balance against the same aggregate version.',
      'An event can be appended conditionally: “only if the last event in the stream is #2”.',
    ],
    [
      '两个处理器都是基于同一个聚合版本检查余额的。',
      '事件可以有条件地追加：“仅当流中最后一个事件是 #2 时”。',
    ],
  ),
  debrief: tr(
    [
      'Оптимистическая конкурентность (expected version) — стандарт для event store: запись идёт при условии, что поток не изменился с момента чтения. При конфликте команду перечитывают и повторяют.',
      'Так агрегат остаётся границей согласованности без блокировок: конфликты редки, и платить за них приходится только тогда, когда они случаются. Пессимистическая блокировка тоже корректна — минус уйти не даст, — но под тысячами операций в секунду очередь на блокировку становится узким местом, поэтому по условию задачи она не подходит.',
    ],
    [
      'Optimistic concurrency (expected version) is the standard for an event store: a write succeeds only if the stream has not changed since it was read. On conflict, the command reloads and retries.',
      'This keeps the aggregate a consistency boundary without locks: conflicts are rare, and you pay for them only when they actually happen. A pessimistic lock is correct too (it won’t let the balance go negative), but at thousands of operations per second the lock queue becomes the bottleneck, which is why the task rules it out.',
    ],
    [
      '乐观并发控制（expected version）是 event store 的标准做法：只有当事件流自读取以来没有变化时，写入才会成功。发生冲突时，命令会重新加载并重试。',
      '这样聚合就能在不加锁的情况下保持为一致性边界：冲突很少见，只有在真正发生时才需要付出代价。悲观锁同样是正确的（它不会让余额变成负数），但在每秒数千笔操作下，等待锁的队列会成为瓶颈，所以题目条件排除了它。',
    ],
  ),
  solution: { control: 'optimistic' },
}

export const ES_TASKS: EsTask[] = [reversal, rebuild, snapshots, versioning, concurrency]
