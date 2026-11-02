/**
 * Event Sourcing: состояние счёта — свёртка неизменяемого журнала событий.
 * Каждая задача — набор архитектурных решений; модель прогоняет журнал и показывает последствия.
 */

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

const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`

// ---------------- 1. Ошибочное списание ----------------

const reversal: EsTask = {
  id: 'reversal',
  title: 'Ошибочное списание',
  brief: [
    'Из-за сбоя процессинга оплата в кафе на 300 ₽ списалась **дважды** (событие #4 — дубль #3). Клиент звонит в поддержку, баланс нужно исправить.',
    'Счёт ведётся через Event Sourcing: журнал — источник истины, баланс — свёртка событий. По требованию регулятора история операций должна сохраняться полностью.',
  ],
  options: [
    {
      key: 'fix',
      label: 'Как исправить',
      choices: [
        { value: 'none', label: 'Пока ничего не делать' },
        { value: 'delete', label: 'Удалить событие #4 из журнала' },
        { value: 'edit', label: 'Изменить сумму события #4 на 0' },
        { value: 'deposit', label: 'Добавить событие «Пополнение 300 ₽»' },
        { value: 'reverse', label: 'Добавить событие «Сторно операции #4»' },
      ],
    },
  ],
  start: { fix: 'none' },
  run: (cfg) => {
    const base: ShownEvent[] = [
      { seq: 1, type: 'СчётОткрыт', data: 'владелец: Иванов' },
      { seq: 2, type: 'Пополнен', data: rub(1000) },
      { seq: 3, type: 'Списан', data: `${rub(300)}, кафе «Ромашка»` },
      { seq: 4, type: 'Списан', data: `${rub(300)}, кафе «Ромашка»`, note: 'дубль из-за сбоя' },
    ]
    let balance = 400
    let tampered = false
    const log: EsRun['log'] = []
    if (cfg.fix === 'delete') {
      base[3] = { ...base[3], mark: 'deleted' }
      balance = 700
      tampered = true
      log.push({ tone: 'bad', text: 'Событие удалено. Аудит больше не увидит, что списание было и его исправили: история переписана задним числом.' })
    } else if (cfg.fix === 'edit') {
      base[3] = { ...base[3], data: `${rub(0)}, кафе «Ромашка»`, mark: 'edited' }
      balance = 700
      tampered = true
      log.push({ tone: 'bad', text: 'Событие изменено. Проекции и подписчики, уже обработавшие исходное событие, разошлись с журналом.' })
    } else if (cfg.fix === 'deposit') {
      base.push({ seq: 5, type: 'Пополнен', data: rub(300), mark: 'new' })
      balance = 700
      log.push({ tone: 'warn', text: 'Баланс сходится, но в выписке клиент увидит пополнение из ниоткуда, а дубль списания так и останется «настоящим».' })
    } else if (cfg.fix === 'reverse') {
      base.push({ seq: 5, type: 'Сторнирован', data: `${rub(300)}, отмена операции #4`, mark: 'new' })
      balance = 700
      log.push({ tone: 'ok', text: 'Компенсирующее событие явно ссылается на ошибочную операцию: история цела, баланс верный, причина видна.' })
    }
    return {
      events: base,
      facts: [
        { label: 'Баланс (свёртка журнала)', value: rub(balance), tone: balance === 700 ? 'ok' : 'bad' },
        { label: 'История неизменна', value: tampered ? 'нет' : 'да', tone: tampered ? 'bad' : 'ok' },
      ],
      log,
      tampered,
      values: { balance, reversed: cfg.fix === 'reverse' ? 1 : 0 },
    }
  },
  goals: [
    { text: 'Баланс 700 ₽', check: (r) => r.values.balance === 700 },
    { text: 'Журнал не изменён и не урезан', check: (r) => !r.tampered },
    { text: 'В истории видно, какая операция ошибочная', check: (r) => r.values.reversed === 1 },
  ],
  hints: [
    'Журнал событий append-only: в нём ничего не удаляют и не правят.',
    'Ошибка исправляется новым событием — как в бухгалтерии.',
    'Пополнение исправит сумму, но не смысл. Нужна явная отмена конкретной операции.',
  ],
  debrief: [
    'Компенсирующее событие (сторно) — способ исправлять ошибки в Event Sourcing. История остаётся полной, а любой читатель видит, что произошло и как это исправили.',
    'Удаление или правка событий ломает главное свойство журнала. Проекции и внешние подписчики уже обработали исходное событие, и источник истины перестаёт быть истиной.',
  ],
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
  id: 'rebuild',
  title: 'Новый отчёт задним числом',
  brief: [
    'Маркетинг просит отчёт «сумма пополнений за месяц» — **за весь месяц**, а не с сегодняшнего дня. Проекцию для отчёта выкатили 20-го числа, и она уже успела посчитать пополнения с 20-го по 28-е.',
    'В CRUD-системе историю пришлось бы восстанавливать по логам. Здесь есть журнал: как правильно наполнить новую проекцию?',
  ],
  options: [
    {
      key: 'from',
      label: 'Читать журнал',
      choices: [
        { value: 'now', label: 'с текущей позиции (только новые события)' },
        { value: 'start', label: 'с самого начала' },
      ],
    },
    {
      key: 'reset',
      label: 'Перед перестроением',
      choices: [
        { value: 'keep', label: 'оставить уже посчитанное' },
        { value: 'clear', label: 'очистить проекцию' },
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
        type: 'Пополнен',
        data: `${rub(d.amount)}, ${d.day}-е число`,
        mark: counted ? 'new' : undefined,
        note: replayed ? (cfg.reset === 'keep' && d.day >= DEPLOY_DAY ? 'посчитано дважды' : 'проиграно заново') : counted ? 'учтено после выката' : 'не учтено',
      }
    })
    if (cfg.from === 'start') value += truth
    const log: EsRun['log'] = []
    if (cfg.from === 'now') log.push({ tone: 'bad', text: `Пополнения до ${DEPLOY_DAY}-го в отчёт не попали.` })
    if (cfg.from === 'start' && cfg.reset === 'keep')
      log.push({ tone: 'bad', text: 'Журнал проигран поверх старых данных: события после выката посчитаны дважды.' })
    if (cfg.from === 'start' && cfg.reset === 'clear')
      log.push({ tone: 'ok', text: 'Проекция очищена и построена заново по всей истории — как будто она была с первого дня.' })
    return {
      events: shown,
      facts: [
        { label: 'Отчёт показывает', value: rub(value), tone: value === truth ? 'ok' : 'bad' },
        { label: 'На самом деле', value: rub(truth) },
      ],
      log,
      tampered: false,
      values: { value, truth },
    }
  },
  goals: [{ text: 'Отчёт совпадает с реальной суммой за месяц', check: (r) => r.values.value === r.values.truth }],
  hints: [
    'Журнал хранит все пополнения с начала месяца. Новой проекции достаточно его прочитать.',
    'Если проигрывать журнал поверх уже посчитанного, часть событий учтётся дважды.',
  ],
  debrief: [
    'Перестроение проекции (replay) — суперсила Event Sourcing: новое представление данных можно получить для всей истории, а не с момента релиза. Так же чинят проекции после багов.',
    'Проекция должна строиться с нуля или быть идемпотентной (помнить последнюю обработанную позицию журнала). Иначе повторный прогон удваивает данные.',
  ],
  solution: { from: 'start', reset: 'clear' },
}

// ---------------- 3. Снапшоты ----------------

const TOTAL = 50_000
const PER_DAY = 2_000
const PER_EVENT_MS = 0.01
const SNAPSHOT_LOAD_MS = 2

const snapshots: EsTask = {
  id: 'snapshots',
  title: 'Медленная загрузка счёта',
  brief: [
    'У корпоративного счёта **50 000** событий, и каждый день добавляется ещё **2 000**. Чтобы обработать команду, агрегат загружает и сворачивает весь журнал — это уже 500 мс на каждый платёж.',
    'Нужно, чтобы загрузка в худшем случае занимала не больше 15 мс. Но и снапшотов не больше четырёх в день: каждый — тяжёлая запись и место в хранилище.',
  ],
  options: [
    {
      key: 'every',
      label: 'Снапшот состояния каждые',
      choices: [
        { value: '0', label: 'не делать снапшоты' },
        { value: '100', label: '100 событий' },
        { value: '500', label: '500 событий' },
        { value: '1000', label: '1 000 событий' },
        { value: '5000', label: '5 000 событий' },
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
          { seq: TOTAL - tail, type: 'Снапшот', data: `состояние на событии #${TOTAL - tail}`, mark: 'snapshot' },
          { seq: TOTAL - tail + 1, type: '…', data: `ещё ${tail - 1} событий`, mark: 'new' },
          { seq: TOTAL, type: 'Списан', data: 'последнее событие', mark: 'new' },
        ]
      : [
          { seq: 1, type: 'СчётОткрыт', data: 'начало истории', mark: 'new' },
          { seq: 2, type: '…', data: `ещё ${TOTAL - 2} событий`, mark: 'new' },
          { seq: TOTAL, type: 'Списан', data: 'последнее событие', mark: 'new' },
        ]
    return {
      events,
      facts: [
        { label: 'Загрузка агрегата (худший случай)', value: `${load.toFixed(1)} мс`, tone: load <= 15 ? 'ok' : 'bad' },
        { label: 'Снапшотов в день', value: perDay.toFixed(perDay % 1 ? 1 : 0), tone: perDay <= 4 ? 'ok' : 'bad' },
        { label: 'Событий читается при загрузке', value: `${tail.toLocaleString('ru-RU')}` },
      ],
      log: [],
      tampered: false,
      values: { load, perDay },
    }
  },
  goals: [
    { text: 'Загрузка ≤ 15 мс', check: (r) => r.values.load <= 15 },
    { text: 'Не больше 4 снапшотов в день', check: (r) => r.values.perDay <= 4 },
  ],
  hints: [
    'Снапшот — сохранённое состояние агрегата. Загрузка = снапшот + события после него.',
    'В худшем случае после снапшота накопилось почти «интервал» событий. 0,01 мс на событие.',
    '2 000 событий в день ÷ интервал = снапшотов в день.',
  ],
  debrief: [
    'Снапшоты — оптимизация, а не источник истины: их можно выбросить и пересчитать из журнала. Интервал — компромисс между скоростью загрузки и стоимостью записи.',
    'Подводный камень: при изменении логики агрегата старые снапшоты устаревают. Их версионируют и пересоздают, а журнал остаётся прежним.',
  ],
  solution: { every: '1000' },
}

// ---------------- 4. Версии событий ----------------

const versioning: EsTask = {
  id: 'versioning',
  title: 'Новая версия события',
  brief: [
    'Банк запускает валютные счета. Событие «Пополнен» получает новое поле **currency**: v1 = {amount}, v2 = {amount, currency}. Новый код умеет работать только с v2.',
    'В журнале три года событий v1. После релиза приходит первое пополнение в долларах. Баланс в рублях должен считаться правильно (курс 100 ₽ за $), а журнал — оставаться неизменным.',
  ],
  options: [
    {
      key: 'strategy',
      label: 'Как быть со старыми событиями v1',
      choices: [
        { value: 'none', label: 'ничего не делать' },
        { value: 'rewrite', label: 'миграцией переписать все v1 в журнале на v2' },
        { value: 'upcaster', label: 'upcaster: при чтении превращать v1 в v2 с currency = RUB' },
        { value: 'default-usd', label: 'считать поле currency необязательным, по умолчанию USD' },
      ],
    },
  ],
  start: { strategy: 'none' },
  run: (cfg) => {
    const olds = [5000, 2000]
    const events: ShownEvent[] = olds.map((a, i) => ({ seq: i + 1, type: 'Пополнен', data: `amount: ${a}`, version: 1 }))
    events.push({ seq: 3, type: 'Пополнен', data: 'amount: 100, currency: USD', version: 2, mark: 'new' })
    let balance = 0
    let errors = 0
    let tampered = false
    const log: EsRun['log'] = []
    if (cfg.strategy === 'none') {
      errors = 2
      for (const e of events.slice(0, 2)) e.mark = 'error'
      balance = 100 * 100
      log.push({ tone: 'bad', text: 'Новый код не может прочитать события v1: загрузка счёта падает с ошибкой десериализации.' })
    } else if (cfg.strategy === 'rewrite') {
      tampered = true
      for (const e of events.slice(0, 2)) {
        e.mark = 'edited'
        e.data += ', currency: RUB'
        e.version = 2
      }
      balance = 7000 + 10000
      log.push({ tone: 'bad', text: 'Миллионы событий переписаны: журнал перестал быть неизменным, а архивы, бэкапы и копии у подписчиков разошлись с ним.' })
    } else if (cfg.strategy === 'upcaster') {
      for (const e of events.slice(0, 2)) {
        e.mark = 'upcast'
        e.note = 'при чтении → v2, currency: RUB'
      }
      balance = 7000 + 10000
      log.push({ tone: 'ok', text: 'Журнал нетронут, новый код видит только v2: upcaster дополняет старые события на лету.' })
    } else {
      for (const e of events.slice(0, 2)) e.note = 'прочитано как USD'
      balance = 7000 * 100 + 10000
      log.push({ tone: 'bad', text: 'Старые рублёвые пополнения прочитаны как доллары: баланс завышен в сто раз.' })
    }
    return {
      events,
      facts: [
        { label: 'Баланс в рублях', value: rub(balance), tone: balance === 17000 ? 'ok' : 'bad' },
        { label: 'Ошибок чтения', value: String(errors), tone: errors ? 'bad' : 'ok' },
        { label: 'Журнал неизменен', value: tampered ? 'нет' : 'да', tone: tampered ? 'bad' : 'ok' },
      ],
      log,
      tampered,
      values: { balance, errors },
    }
  },
  goals: [
    { text: 'Все события читаются', check: (r) => r.values.errors === 0 },
    { text: 'Баланс 17 000 ₽', check: (r) => r.values.balance === 17000 },
    { text: 'Журнал не изменён', check: (r) => !r.tampered },
  ],
  hints: [
    'Журнал неизменен — значит, события v1 в нём останутся навсегда.',
    'Код может приводить старую версию к новой в момент чтения.',
    'Значение по умолчанию должно соответствовать тому, что было в старых событиях.',
  ],
  debrief: [
    'Upcasting — стандартный способ эволюции событий: старые версии хранятся как есть, а при чтении цепочка upcaster-ов поднимает их до текущей. Новый код знает только последнюю версию.',
    'Другие варианты — новый тип события («ПополненВВалюте») или слабая схема с разумными значениями по умолчанию. Переписывание журнала — крайняя мера.',
  ],
  solution: { strategy: 'upcaster' },
}

// ---------------- 5. Параллельные команды ----------------

const concurrency: EsTask = {
  id: 'concurrency',
  title: 'Два списания одновременно',
  brief: [
    'На счёте **500 ₽**. С телефона и с карты почти одновременно приходят две команды «списать 400 ₽». Каждый обработчик загружает агрегат (версия 2), проверяет «хватает ли денег» и дописывает событие.',
    'Уйти в минус нельзя. При этом счёт обслуживает тысячи операций в секунду, так что держать долгие блокировки на запись тоже нельзя.',
  ],
  options: [
    {
      key: 'control',
      label: 'Контроль параллельности',
      choices: [
        { value: 'none', label: 'нет — просто дописываем событие' },
        { value: 'lock', label: 'пессимистическая блокировка счёта на время обработки' },
        { value: 'optimistic', label: 'оптимистическая: дописать, только если версия всё ещё 2' },
      ],
    },
  ],
  start: { control: 'none' },
  run: (cfg) => {
    const events: ShownEvent[] = [
      { seq: 1, type: 'СчётОткрыт', data: 'владелец: Петров' },
      { seq: 2, type: 'Пополнен', data: rub(500) },
    ]
    const log: EsRun['log'] = []
    let balance = 500
    let locks = 0
    if (cfg.control === 'none') {
      events.push({ seq: 3, type: 'Списан', data: `${rub(400)}, телефон`, mark: 'new' })
      events.push({ seq: 4, type: 'Списан', data: `${rub(400)}, карта`, mark: 'error', note: 'проверка видела устаревший баланс' })
      balance = -300
      log.push({ tone: 'bad', text: 'Оба обработчика видели 500 ₽ и оба списали. Баланс −300 ₽.' })
    } else if (cfg.control === 'lock') {
      events.push({ seq: 3, type: 'Списан', data: `${rub(400)}, телефон`, mark: 'new' })
      balance = 100
      locks = 1
      log.push({ tone: 'warn', text: 'Второй обработчик ждал блокировку, затем увидел 100 ₽ и отказал. Корректно, но под нагрузкой очередь на блокировку растёт.' })
      log.push({ tone: 'info', text: 'Команда с карты отклонена: недостаточно средств.' })
    } else {
      events.push({ seq: 3, type: 'Списан', data: `${rub(400)}, телефон`, mark: 'new' })
      balance = 100
      log.push({ tone: 'info', text: 'Карта пыталась дописать событие при ожидаемой версии 2, но версия уже 3 — конфликт.' })
      log.push({ tone: 'ok', text: 'Обработчик перечитал агрегат (100 ₽) и отклонил команду: недостаточно средств. Без блокировок.' })
    }
    return {
      events,
      facts: [
        { label: 'Баланс', value: rub(balance), tone: balance >= 0 ? 'ok' : 'bad' },
        { label: 'Блокировки на время обработки', value: locks ? 'да' : 'нет', tone: locks ? 'warn' : 'ok' },
      ],
      log,
      tampered: false,
      values: { balance, locks },
    }
  },
  goals: [
    { text: 'Баланс не уходит в минус', check: (r) => r.values.balance >= 0 },
    { text: 'Без блокировок на время обработки', check: (r) => r.values.locks === 0 },
  ],
  hints: [
    'Оба обработчика проверили баланс по одной и той же версии агрегата.',
    'Событие можно дописать условно: «только если последнее событие в потоке — #2».',
  ],
  debrief: [
    'Оптимистическая конкурентность (expected version) — стандарт для event store: запись идёт при условии, что поток не изменился с момента чтения. При конфликте команду перечитывают и повторяют.',
    'Так агрегат остаётся границей согласованности без блокировок: конфликты редки, и платить за них приходится только тогда, когда они случаются.',
  ],
  solution: { control: 'optimistic' },
}

export const ES_TASKS: EsTask[] = [reversal, rebuild, snapshots, versioning, concurrency]
