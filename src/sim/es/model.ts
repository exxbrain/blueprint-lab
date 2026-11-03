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
  title: tr('Ошибочное списание', 'Erroneous withdrawal'),
  brief: tr(
    [
      'Из-за сбоя процессинга оплата в кафе на 300 ₽ списалась **дважды** (событие #4 — дубль #3). Клиент звонит в поддержку, баланс нужно исправить.',
      'Счёт ведётся через Event Sourcing: журнал — источник истины, баланс — свёртка событий. По требованию регулятора история операций должна сохраняться полностью.',
    ],
    [
      'Due to a payment processing glitch, a 300 ₽ café payment was withdrawn **twice** (event #4 duplicates #3). The customer calls support, and the balance must be fixed.',
      'The account uses Event Sourcing: the event log is the source of truth, the balance is a fold over the events. The regulator requires the full transaction history to be preserved.',
    ],
  ),
  options: [
    {
      key: 'fix',
      label: tr('Как исправить', 'How to fix it'),
      choices: [
        { value: 'none', label: tr('Пока ничего не делать', 'Do nothing for now') },
        { value: 'delete', label: tr('Удалить событие #4 из журнала', 'Delete event #4 from the log') },
        { value: 'edit', label: tr('Изменить сумму события #4 на 0', 'Change the amount of event #4 to 0') },
        { value: 'deposit', label: tr('Добавить событие «Пополнение 300 ₽»', 'Append a “Deposit 300 ₽” event') },
        { value: 'reverse', label: tr('Добавить событие «Сторно операции #4»', 'Append a “Reversal of transaction #4” event') },
      ],
    },
  ],
  start: { fix: 'none' },
  run: (cfg) => {
    const base: ShownEvent[] = [
      { seq: 1, type: tr('СчётОткрыт', 'AccountOpened'), data: tr('владелец: Иванов', 'owner: Ivanov') },
      { seq: 2, type: tr('Пополнен', 'Deposited'), data: rub(1000) },
      { seq: 3, type: tr('Списан', 'Withdrawn'), data: tr(`${rub(300)}, кафе «Ромашка»`, `${rub(300)}, Daisy Café`) },
      { seq: 4, type: tr('Списан', 'Withdrawn'), data: tr(`${rub(300)}, кафе «Ромашка»`, `${rub(300)}, Daisy Café`), note: tr('дубль из-за сбоя', 'duplicate caused by a glitch') },
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
        ),
      })
    } else if (cfg.fix === 'edit') {
      base[3] = { ...base[3], data: tr(`${rub(0)}, кафе «Ромашка»`, `${rub(0)}, Daisy Café`), mark: 'edited' }
      balance = 700
      tampered = true
      log.push({ tone: 'bad', text: tr(
          'Событие изменено. Проекции и подписчики, уже обработавшие исходное событие, разошлись с журналом.',
          'Event modified. Projections and subscribers that already processed the original event are now out of sync with the log.',
        ),
      })
    } else if (cfg.fix === 'deposit') {
      base.push({ seq: 5, type: tr('Пополнен', 'Deposited'), data: rub(300), mark: 'new' })
      balance = 700
      log.push({ tone: 'warn', text: tr(
          'Баланс сходится, но в выписке клиент увидит пополнение из ниоткуда, а дубль списания так и останется «настоящим».',
          'The balance adds up, but the customer’s statement shows a deposit out of nowhere, and the duplicate withdrawal still looks “real”.',
        ),
      })
    } else if (cfg.fix === 'reverse') {
      base.push({ seq: 5, type: tr('Сторнирован', 'Reversed'), data: tr(`${rub(300)}, отмена операции #4`, `${rub(300)}, reverses transaction #4`), mark: 'new' })
      balance = 700
      log.push({ tone: 'ok', text: tr(
          'Компенсирующее событие явно ссылается на ошибочную операцию: история цела, баланс верный, причина видна.',
          'The compensating event explicitly references the erroneous transaction: history is intact, the balance is correct, the reason is visible.',
        ),
      })
    }
    return {
      events: base,
      facts: [
        { label: tr('Баланс (свёртка журнала)', 'Balance (fold of the log)'), value: rub(balance), tone: balance === 700 ? 'ok' : 'bad' },
        { label: tr('История неизменна', 'History unchanged'), value: tampered ? tr('нет', 'no') : tr('да', 'yes'), tone: tampered ? 'bad' : 'ok' },
      ],
      log,
      tampered,
      values: { balance, reversed: cfg.fix === 'reverse' ? 1 : 0 },
    }
  },
  goals: [
    { text: tr('Баланс 700 ₽', 'Balance 700 ₽'), check: (r) => r.values.balance === 700 },
    { text: tr('Журнал не изменён и не урезан', 'The log is neither modified nor truncated'), check: (r) => !r.tampered },
    { text: tr('В истории видно, какая операция ошибочная', 'History shows which transaction was erroneous'), check: (r) => r.values.reversed === 1 },
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
  title: tr('Новый отчёт задним числом', 'A new report, retroactively'),
  brief: tr(
    [
      'Маркетинг просит отчёт «сумма пополнений за месяц» — **за весь месяц**, а не с сегодняшнего дня. Проекцию для отчёта выкатили 20-го числа, и она уже успела посчитать пополнения с 20-го по 28-е.',
      'В CRUD-системе историю пришлось бы восстанавливать по логам. Здесь есть журнал: как правильно наполнить новую проекцию?',
    ],
    [
      'Marketing wants a “total deposits for the month” report — **for the whole month**, not from today onwards. The report projection was deployed on the 20th and has already counted deposits from the 20th to the 28th.',
      'In a CRUD system you would have to reconstruct history from logs. Here you have an event log: how do you populate the new projection correctly?',
    ],
  ),
  options: [
    {
      key: 'from',
      label: tr('Читать журнал', 'Read the log'),
      choices: [
        { value: 'now', label: tr('с текущей позиции (только новые события)', 'from the current position (new events only)') },
        { value: 'start', label: tr('с самого начала', 'from the very beginning') },
      ],
    },
    {
      key: 'reset',
      label: tr('Перед перестроением', 'Before rebuilding'),
      choices: [
        { value: 'keep', label: tr('оставить уже посчитанное', 'keep what is already counted') },
        { value: 'clear', label: tr('очистить проекцию', 'clear the projection') },
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
        type: tr('Пополнен', 'Deposited'),
        data: tr(`${rub(d.amount)}, ${d.day}-е число`, `${rub(d.amount)}, day ${d.day}`),
        mark: counted ? 'new' : undefined,
        note: replayed
          ? cfg.reset === 'keep' && d.day >= DEPLOY_DAY
            ? tr('посчитано дважды', 'counted twice')
            : tr('проиграно заново', 'replayed')
          : counted
            ? tr('учтено после выката', 'counted after deploy')
            : tr('не учтено', 'not counted'),
      }
    })
    if (cfg.from === 'start') value += truth
    const log: EsRun['log'] = []
    if (cfg.from === 'now') log.push({ tone: 'bad', text: tr(`Пополнения до ${DEPLOY_DAY}-го в отчёт не попали.`, `Deposits before the ${DEPLOY_DAY}th are missing from the report.`) })
    if (cfg.from === 'start' && cfg.reset === 'keep')
      log.push({ tone: 'bad', text: tr('Журнал проигран поверх старых данных: события после выката посчитаны дважды.', 'The log was replayed on top of old data: events after the deploy were counted twice.') })
    if (cfg.from === 'start' && cfg.reset === 'clear')
      log.push({ tone: 'ok', text: tr('Проекция очищена и построена заново по всей истории — как будто она была с первого дня.', 'The projection was cleared and rebuilt from the full history — as if it had existed since day one.') })
    return {
      events: shown,
      facts: [
        { label: tr('Отчёт показывает', 'Report shows'), value: rub(value), tone: value === truth ? 'ok' : 'bad' },
        { label: tr('На самом деле', 'Actual total'), value: rub(truth) },
      ],
      log,
      tampered: false,
      values: { value, truth },
    }
  },
  goals: [{ text: tr('Отчёт совпадает с реальной суммой за месяц', 'The report matches the actual monthly total'), check: (r) => r.values.value === r.values.truth }],
  hints: tr(
    [
      'Журнал хранит все пополнения с начала месяца. Новой проекции достаточно его прочитать.',
      'Если проигрывать журнал поверх уже посчитанного, часть событий учтётся дважды.',
    ],
    [
      'The log holds every deposit since the start of the month. The new projection just needs to read it.',
      'If you replay the log on top of what is already counted, some events will be counted twice.',
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
  title: tr('Медленная загрузка счёта', 'Slow account loading'),
  brief: tr(
    [
      'У корпоративного счёта **50 000** событий, и каждый день добавляется ещё **2 000**. Чтобы обработать команду, агрегат загружает и сворачивает весь журнал — это уже 500 мс на каждый платёж.',
      'Нужно, чтобы загрузка в худшем случае занимала не больше 15 мс. Но и снапшотов не больше четырёх в день: каждый — тяжёлая запись и место в хранилище.',
    ],
    [
      'A corporate account has **50,000** events, and another **2,000** are added every day. To handle a command, the aggregate loads and folds the entire stream — already 500 ms per payment.',
      'Worst-case loading must take no more than 15 ms. But there may be no more than four snapshots per day: each one is a heavy write and takes storage space.',
    ],
  ),
  options: [
    {
      key: 'every',
      label: tr('Снапшот состояния каждые', 'Take a state snapshot every'),
      choices: [
        { value: '0', label: tr('не делать снапшоты', 'no snapshots') },
        { value: '100', label: tr('100 событий', '100 events') },
        { value: '500', label: tr('500 событий', '500 events') },
        { value: '1000', label: tr('1 000 событий', '1,000 events') },
        { value: '5000', label: tr('5 000 событий', '5,000 events') },
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
          { seq: TOTAL - tail, type: tr('Снапшот', 'Snapshot'), data: tr(`состояние на событии #${TOTAL - tail}`, `state as of event #${TOTAL - tail}`), mark: 'snapshot' },
          { seq: TOTAL - tail + 1, type: '…', data: tr(`ещё ${tail - 1} событий`, `${tail - 1} more events`), mark: 'new' },
          { seq: TOTAL, type: tr('Списан', 'Withdrawn'), data: tr('последнее событие', 'latest event'), mark: 'new' },
        ]
      : [
          { seq: 1, type: tr('СчётОткрыт', 'AccountOpened'), data: tr('начало истории', 'start of history'), mark: 'new' },
          { seq: 2, type: '…', data: tr(`ещё ${TOTAL - 2} событий`, `${TOTAL - 2} more events`), mark: 'new' },
          { seq: TOTAL, type: tr('Списан', 'Withdrawn'), data: tr('последнее событие', 'latest event'), mark: 'new' },
        ]
    return {
      events,
      facts: [
        { label: tr('Загрузка агрегата (худший случай)', 'Aggregate load time (worst case)'), value: tr(`${load.toFixed(1)} мс`, `${load.toFixed(1)} ms`), tone: load <= 15 ? 'ok' : 'bad' },
        { label: tr('Снапшотов в день', 'Snapshots per day'), value: perDay.toFixed(perDay % 1 ? 1 : 0), tone: perDay <= 4 ? 'ok' : 'bad' },
        { label: tr('Событий читается при загрузке', 'Events read on load'), value: `${tail.toLocaleString(locale)}` },
      ],
      log: [],
      tampered: false,
      values: { load, perDay },
    }
  },
  goals: [
    { text: tr('Загрузка ≤ 15 мс', 'Load time ≤ 15 ms'), check: (r) => r.values.load <= 15 },
    { text: tr('Не больше 4 снапшотов в день', 'At most 4 snapshots per day'), check: (r) => r.values.perDay <= 4 },
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
  ),
  solution: { every: '1000' },
}

// ---------------- 4. Версии событий ----------------

const versioning: EsTask = {
  id: 'event-version',
  title: tr('Новая версия события', 'A new event version'),
  brief: tr(
    [
      'Банк запускает валютные счета. Событие «Пополнен» получает новое поле **currency**: v1 = {amount}, v2 = {amount, currency}. Новый код умеет работать только с v2.',
      'В журнале три года событий v1. После релиза приходит первое пополнение в долларах. Баланс в рублях должен считаться правильно (курс 100 ₽ за $), а журнал — оставаться неизменным.',
    ],
    [
      'The bank is launching foreign-currency accounts. The “Deposited” event gets a new **currency** field: v1 = {amount}, v2 = {amount, currency}. The new code only understands v2.',
      'The log holds three years of v1 events. After the release, the first deposit in dollars arrives. The balance in rubles must be computed correctly (rate: 100 ₽ per $), and the log must stay unchanged.',
    ],
  ),
  options: [
    {
      key: 'strategy',
      label: tr('Как быть со старыми событиями v1', 'What to do with old v1 events'),
      choices: [
        { value: 'none', label: tr('ничего не делать', 'do nothing') },
        { value: 'rewrite', label: tr('миграцией переписать все v1 в журнале на v2', 'run a migration that rewrites every v1 in the log to v2') },
        { value: 'upcaster', label: tr('upcaster: при чтении превращать v1 в v2 с currency = RUB', 'upcaster: convert v1 to v2 with currency = RUB on read') },
        { value: 'default-usd', label: tr('считать поле currency необязательным, по умолчанию USD', 'make the currency field optional, defaulting to USD') },
      ],
    },
  ],
  start: { strategy: 'none' },
  run: (cfg) => {
    const olds = [5000, 2000]
    const events: ShownEvent[] = olds.map((a, i) => ({ seq: i + 1, type: tr('Пополнен', 'Deposited'), data: `amount: ${a}`, version: 1 }))
    events.push({ seq: 3, type: tr('Пополнен', 'Deposited'), data: 'amount: 100, currency: USD', version: 2, mark: 'new' })
    let balance = 0
    let errors = 0
    let tampered = false
    const log: EsRun['log'] = []
    if (cfg.strategy === 'none') {
      errors = 2
      for (const e of events.slice(0, 2)) e.mark = 'error'
      balance = 100 * 100
      log.push({ tone: 'bad', text: tr('Новый код не может прочитать события v1: загрузка счёта падает с ошибкой десериализации.', 'The new code cannot read v1 events: loading the account fails with a deserialization error.') })
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
        ),
      })
    } else if (cfg.strategy === 'upcaster') {
      for (const e of events.slice(0, 2)) {
        e.mark = 'upcast'
        e.note = tr('при чтении → v2, currency: RUB', 'on read → v2, currency: RUB')
      }
      balance = 7000 + 10000
      log.push({ tone: 'ok', text: tr('Журнал нетронут, новый код видит только v2: upcaster дополняет старые события на лету.', 'The log is untouched and the new code only sees v2: the upcaster fills in old events on the fly.') })
    } else {
      for (const e of events.slice(0, 2)) e.note = tr('прочитано как USD', 'read as USD')
      balance = 7000 * 100 + 10000
      log.push({ tone: 'bad', text: tr('Старые рублёвые пополнения прочитаны как доллары: баланс завышен в сто раз.', 'Old ruble deposits were read as dollars: the balance is inflated a hundredfold.') })
    }
    return {
      events,
      facts: [
        { label: tr('Баланс в рублях', 'Balance in rubles'), value: rub(balance), tone: balance === 17000 ? 'ok' : 'bad' },
        { label: tr('Ошибок чтения', 'Read errors'), value: String(errors), tone: errors ? 'bad' : 'ok' },
        { label: tr('Журнал неизменен', 'Log unchanged'), value: tampered ? tr('нет', 'no') : tr('да', 'yes'), tone: tampered ? 'bad' : 'ok' },
      ],
      log,
      tampered,
      values: { balance, errors },
    }
  },
  goals: [
    { text: tr('Все события читаются', 'All events can be read'), check: (r) => r.values.errors === 0 },
    { text: tr('Баланс 17 000 ₽', 'Balance 17,000 ₽'), check: (r) => r.values.balance === 17000 },
    { text: tr('Журнал не изменён', 'The log is unchanged'), check: (r) => !r.tampered },
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
  ),
  debrief: tr(
    [
      'Upcasting — стандартный способ эволюции событий: старые версии хранятся как есть, а при чтении цепочка upcaster-ов поднимает их до текущей. Новый код знает только последнюю версию.',
      'Другие варианты — новый тип события («ПополненВВалюте») или слабая схема с разумными значениями по умолчанию. Переписывание журнала — крайняя мера.',
    ],
    [
      'Upcasting is the standard way to evolve events: old versions are stored as is, and on read a chain of upcasters brings them up to the current version. The new code only knows the latest version.',
      'Other options are a new event type (“DepositedInCurrency”) or a weak schema with sensible defaults. Rewriting the log is a last resort.',
    ],
  ),
  solution: { strategy: 'upcaster' },
}

// ---------------- 5. Параллельные команды ----------------

const concurrency: EsTask = {
  id: 'two-withdrawals',
  title: tr('Два списания одновременно', 'Two withdrawals at once'),
  brief: tr(
    [
      'На счёте **500 ₽**. С телефона и с карты почти одновременно приходят две команды «списать 400 ₽». Каждый обработчик загружает агрегат (версия 2), проверяет «хватает ли денег» и дописывает событие.',
      'Уйти в минус нельзя. При этом счёт обслуживает тысячи операций в секунду, так что держать долгие блокировки на запись тоже нельзя.',
    ],
    [
      'The account holds **500 ₽**. Two “withdraw 400 ₽” commands arrive almost simultaneously, from a phone and from a card. Each handler loads the aggregate (version 2), checks “is there enough money”, and appends an event.',
      'The balance must never go negative. At the same time, the account handles thousands of operations per second, so long write locks are not an option either.',
    ],
  ),
  options: [
    {
      key: 'control',
      label: tr('Контроль параллельности', 'Concurrency control'),
      choices: [
        { value: 'none', label: tr('нет — просто дописываем событие', 'none — just append the event') },
        { value: 'lock', label: tr('пессимистическая блокировка счёта на время обработки', 'pessimistic lock on the account during processing') },
        { value: 'optimistic', label: tr('оптимистическая: дописать, только если версия всё ещё 2', 'optimistic: append only if the version is still 2') },
      ],
    },
  ],
  start: { control: 'none' },
  run: (cfg) => {
    const events: ShownEvent[] = [
      { seq: 1, type: tr('СчётОткрыт', 'AccountOpened'), data: tr('владелец: Петров', 'owner: Petrov') },
      { seq: 2, type: tr('Пополнен', 'Deposited'), data: rub(500) },
    ]
    const log: EsRun['log'] = []
    let balance = 500
    let locks = 0
    if (cfg.control === 'none') {
      events.push({ seq: 3, type: tr('Списан', 'Withdrawn'), data: tr(`${rub(400)}, телефон`, `${rub(400)}, phone`), mark: 'new' })
      events.push({ seq: 4, type: tr('Списан', 'Withdrawn'), data: tr(`${rub(400)}, карта`, `${rub(400)}, card`), mark: 'error', note: tr('проверка видела устаревший баланс', 'the check saw a stale balance') })
      balance = -300
      log.push({ tone: 'bad', text: tr('Оба обработчика видели 500 ₽ и оба списали. Баланс −300 ₽.', 'Both handlers saw 500 ₽ and both withdrew. Balance: −300 ₽.') })
    } else if (cfg.control === 'lock') {
      events.push({ seq: 3, type: tr('Списан', 'Withdrawn'), data: tr(`${rub(400)}, телефон`, `${rub(400)}, phone`), mark: 'new' })
      balance = 100
      locks = 1
      log.push({ tone: 'warn', text: tr(
          'Второй обработчик ждал блокировку, затем увидел 100 ₽ и отказал. Корректно, но под нагрузкой очередь на блокировку растёт.',
          'The second handler waited for the lock, then saw 100 ₽ and rejected the command. Correct, but under load the lock queue keeps growing.',
        ),
      })
      log.push({ tone: 'info', text: tr('Команда с карты отклонена: недостаточно средств.', 'The card command was rejected: insufficient funds.') })
    } else {
      events.push({ seq: 3, type: tr('Списан', 'Withdrawn'), data: tr(`${rub(400)}, телефон`, `${rub(400)}, phone`), mark: 'new' })
      balance = 100
      log.push({ tone: 'info', text: tr('Карта пыталась дописать событие при ожидаемой версии 2, но версия уже 3 — конфликт.', 'The card tried to append an event with expected version 2, but the version is already 3 — conflict.') })
      log.push({ tone: 'ok', text: tr('Обработчик перечитал агрегат (100 ₽) и отклонил команду: недостаточно средств. Без блокировок.', 'The handler reloaded the aggregate (100 ₽) and rejected the command: insufficient funds. No locks.') })
    }
    return {
      events,
      facts: [
        { label: tr('Баланс', 'Balance'), value: rub(balance), tone: balance >= 0 ? 'ok' : 'bad' },
        { label: tr('Блокировки на время обработки', 'Locks during processing'), value: locks ? tr('да', 'yes') : tr('нет', 'no'), tone: locks ? 'warn' : 'ok' },
      ],
      log,
      tampered: false,
      values: { balance, locks },
    }
  },
  goals: [
    { text: tr('Баланс не уходит в минус', 'The balance never goes negative'), check: (r) => r.values.balance >= 0 },
    { text: tr('Без блокировок на время обработки', 'No locks during processing'), check: (r) => r.values.locks === 0 },
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
  ),
  debrief: tr(
    [
      'Оптимистическая конкурентность (expected version) — стандарт для event store: запись идёт при условии, что поток не изменился с момента чтения. При конфликте команду перечитывают и повторяют.',
      'Так агрегат остаётся границей согласованности без блокировок: конфликты редки, и платить за них приходится только тогда, когда они случаются.',
    ],
    [
      'Optimistic concurrency (expected version) is the standard for an event store: a write succeeds only if the stream has not changed since it was read. On conflict, the command reloads and retries.',
      'This keeps the aggregate a consistency boundary without locks: conflicts are rare, and you pay for them only when they actually happen.',
    ],
  ),
  solution: { control: 'optimistic' },
}

export const ES_TASKS: EsTask[] = [reversal, rebuild, snapshots, versioning, concurrency]
