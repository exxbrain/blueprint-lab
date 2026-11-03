import type { QuizQuestion } from '../types'
import { tr } from '../../i18n'

export const dataQuiz: QuizQuestion[] = [
  {
    q: tr(
      'Сеть между дата-центрами разорвана. Система банка продолжает списания в обоих. Что она выбрала?',
      'The network between data centers is partitioned. The bank’s system keeps processing withdrawals in both. What did it choose?',
      '数据中心之间的网络断开了。银行系统在两边都继续处理扣款。它选择了什么？',
    ),
    options: ['Consistency', 'Availability', 'Partition tolerance', tr('Ничего — это нормальная работа', 'Nothing — this is normal operation', '什么都没选——这是正常运行')],
    correct: 1,
    explain: tr(
      'Обе стороны продолжают отвечать — это A. Платой будут расхождения балансов: каждая сторона не видит списаний другой.',
      'Both sides keep responding — that is A. The price is diverging balances: each side cannot see the other’s withdrawals.',
      '两边都继续响应——这就是 A。代价是余额出现分歧：每一边都看不到另一边的扣款。',
    ),
  },
  {
    q: tr(
      'N = 5, W = 2. Какое минимальное R гарантирует, что чтение увидит последнюю запись?',
      'N = 5, W = 2. What is the minimum R that guarantees a read sees the latest write?',
      'N = 5，W = 2。R 最小取多少，才能保证读操作看到最新的写入？',
    ),
    options: ['1', '2', '3', '4'],
    correct: 3,
    explain: tr('Нужно R + W > N: R + 2 > 5, то есть R ≥ 4.', 'You need R + W > N: R + 2 > 5, so R ≥ 4.', '需要满足 R + W > N：R + 2 > 5，即 R ≥ 4。'),
  },
  {
    q: tr(
      'Чем опасна стратегия last write wins при слиянии после разрыва?',
      'What is the danger of last write wins when reconciling after a partition?',
      '分区恢复后合并数据时，last write wins 有什么危险？',
    ),
    options: tr(
      [
        'Она медленная',
        'Она молча теряет одну из конкурирующих версий',
        'Она требует кворума',
        'Она не работает с SSD',
      ],
      ['It is slow', 'It silently loses one of the competing versions', 'It requires a quorum', 'It does not work with SSDs'],
      ['它很慢', '它会悄无声息地丢掉相互竞争的版本之一', '它需要法定人数', '它不支持 SSD'],
    ),
    correct: 1,
    explain: tr(
      'Из двух версий выживает та, у которой больше метка времени. Изменения другой стороны пропадают без ошибок и предупреждений.',
      'Of the two versions, the one with the later timestamp survives. The other side’s changes vanish without any error or warning.',
      '两个版本中，时间戳较晚的那个会保留下来。另一边的修改会直接消失，没有任何错误或警告。',
    ),
  },
  {
    q: tr('Что добавляет PACELC к CAP?', 'What does PACELC add to CAP?', 'PACELC 在 CAP 的基础上增加了什么？'),
    options: tr(
      [
        'Выбор между задержкой и согласованностью, когда разрыва нет',
        'Четвёртое свойство — безопасность',
        'Запрет на sloppy quorum',
        'Ничего, это синоним',
      ],
      [
        'A choice between latency and consistency when there is no partition',
        'A fourth property — security',
        'A ban on sloppy quorums',
        'Nothing, it is a synonym',
      ],
      [
        '在没有分区时，在延迟和一致性之间做选择',
        '第四个属性——安全性',
        '禁止 sloppy quorum',
        '什么也没加，它只是同义词',
      ],
    ),
    correct: 0,
    explain: tr(
      'Даже без разрыва дождаться большего числа реплик дольше. Системы выбирают между низкой задержкой и строгой согласованностью и в обычное время.',
      'Even without a partition, waiting for more replicas takes longer. Systems choose between low latency and strong consistency in normal operation too.',
      '即使没有分区，等待更多副本确认也需要更长时间。系统在正常运行时同样要在低延迟和强一致性之间做选择。',
    ),
  },
  {
    q: tr(
      'В журнале событий оказалось ошибочное списание. Как его исправить в Event Sourcing?',
      'The event log contains an erroneous withdrawal. How do you fix it in Event Sourcing?',
      '事件日志里出现了一笔错误的扣款。在事件溯源中该如何修正？',
    ),
    options: tr(
      ['Удалить событие', 'Изменить сумму в событии', 'Дописать компенсирующее событие (сторно)', 'Пересоздать поток'],
      ['Delete the event', 'Change the amount in the event', 'Append a compensating event (reversal)', 'Recreate the stream'],
      ['删除这个事件', '修改事件中的金额', '追加一个补偿事件（冲正）', '重建事件流'],
    ),
    correct: 2,
    explain: tr(
      'Журнал append-only. Ошибку исправляет новое событие, которое ссылается на ошибочное: история сохраняется полностью.',
      'The log is append-only. A mistake is fixed by a new event that references the erroneous one: the history is preserved in full.',
      '日志是 append-only（只追加）的。错误由一个引用错误事件的新事件来修正：历史被完整保留。',
    ),
  },
  {
    q: tr('Зачем в Event Sourcing нужны снапшоты?', 'Why does Event Sourcing need snapshots?', '事件溯源为什么需要快照？'),
    options: tr(
      [
        'Чтобы удалить старые события',
        'Чтобы не сворачивать весь поток при каждой загрузке агрегата',
        'Чтобы заменить проекции',
        'Это обязательный источник истины',
      ],
      [
        'To delete old events',
        'To avoid folding the entire stream every time the aggregate is loaded',
        'To replace projections',
        'They are the mandatory source of truth',
      ],
      [
        '为了删除旧事件',
        '为了避免每次加载聚合时都重放整个事件流',
        '为了替代投影',
        '它们是必需的事实来源',
      ],
    ),
    correct: 1,
    explain: tr(
      'Снапшот — кэш состояния на событии #N. Загрузка = снапшот + события после него. Источником истины остаётся журнал.',
      'A snapshot is a cache of the state as of event #N. Loading = snapshot + the events after it. The log remains the source of truth.',
      '快照是截至事件 #N 时状态的缓存。加载 = 快照 + 其后的事件。事实来源仍然是日志。',
    ),
  },
  {
    q: tr(
      'Как поддержать старые события v1 после изменения схемы на v2, не трогая журнал?',
      'How do you support old v1 events after the schema changes to v2, without touching the log?',
      'Schema 升级到 v2 后，如何在不改动日志的前提下支持旧的 v1 事件？',
    ),
    options: tr(
      ['Переписать журнал', 'Upcaster при чтении', 'Удалить старые события', 'Запретить старые события'],
      ['Rewrite the log', 'An upcaster on read', 'Delete the old events', 'Forbid the old events'],
      ['重写日志', '读取时使用 upcaster', '删除旧事件', '禁止旧事件'],
    ),
    correct: 1,
    explain: tr(
      'Upcaster превращает v1 в v2 в момент чтения. Журнал остаётся неизменным, а новый код знает только последнюю версию.',
      'An upcaster converts v1 to v2 at read time. The log stays unchanged, and the new code only knows the latest version.',
      'Upcaster 在读取时把 v1 转换为 v2。日志保持不变，新代码只需要了解最新版本。',
    ),
  },
  {
    q: tr(
      'Две команды одновременно списывают деньги с одного счёта. Что не даст уйти в минус без блокировок?',
      'Two commands withdraw money from the same account at the same time. What prevents a negative balance without locks?',
      '两个命令同时从同一个账户扣款。在不加锁的情况下，什么能防止余额变成负数？',
    ),
    options: tr(
      [
        'Проверка баланса в обработчике',
        'Оптимистическая конкурентность по версии потока',
        'Проекция баланса',
        'Снапшот',
      ],
      ['A balance check in the handler', 'Optimistic concurrency on the stream version', 'A balance projection', 'A snapshot'],
      ['在处理器中检查余额', '基于事件流版本的乐观并发控制', '余额投影', '快照'],
    ),
    correct: 1,
    explain: tr(
      'Событие дописывается только при ожидаемой версии. Вторая команда получит конфликт, перечитает поток и увидит, что денег не хватает.',
      'The event is appended only if the expected version matches. The second command gets a conflict, reloads the stream and sees there is not enough money.',
      '只有版本与预期一致时，事件才会被追加。第二个命令会遇到冲突，重新读取事件流，然后发现余额不足。',
    ),
  },
]
