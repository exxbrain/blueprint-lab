import type { QuizQuestion } from '../types'
import { tr } from '../../i18n'

export const dataQuiz: QuizQuestion[] = [
  {
    q: tr(
      'Сеть между дата-центрами разорвана. Система банка продолжает списания в обоих. Что она выбрала?',
      'The network between data centers is partitioned. The bank’s system keeps processing withdrawals in both. What did it choose?',
    ),
    options: ['Consistency', 'Availability', 'Partition tolerance', tr('Ничего — это нормальная работа', 'Nothing — this is normal operation')],
    correct: 1,
    explain: tr(
      'Обе стороны продолжают отвечать — это A. Платой будут расхождения балансов: каждая сторона не видит списаний другой.',
      'Both sides keep responding — that is A. The price is diverging balances: each side cannot see the other’s withdrawals.',
    ),
  },
  {
    q: tr(
      'N = 5, W = 2. Какое минимальное R гарантирует, что чтение увидит последнюю запись?',
      'N = 5, W = 2. What is the minimum R that guarantees a read sees the latest write?',
    ),
    options: ['1', '2', '3', '4'],
    correct: 3,
    explain: tr('Нужно R + W > N: R + 2 > 5, то есть R ≥ 4.', 'You need R + W > N: R + 2 > 5, so R ≥ 4.'),
  },
  {
    q: tr(
      'Чем опасна стратегия last write wins при слиянии после разрыва?',
      'What is the danger of last write wins when reconciling after a partition?',
    ),
    options: tr(
      [
        'Она медленная',
        'Она молча теряет одну из конкурирующих версий',
        'Она требует кворума',
        'Она не работает с SSD',
      ],
      ['It is slow', 'It silently loses one of the competing versions', 'It requires a quorum', 'It does not work with SSDs'],
    ),
    correct: 1,
    explain: tr(
      'Из двух версий выживает та, у которой больше метка времени. Изменения другой стороны пропадают без ошибок и предупреждений.',
      'Of the two versions, the one with the later timestamp survives. The other side’s changes vanish without any error or warning.',
    ),
  },
  {
    q: tr('Что добавляет PACELC к CAP?', 'What does PACELC add to CAP?'),
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
    ),
    correct: 0,
    explain: tr(
      'Даже без разрыва дождаться большего числа реплик дольше. Системы выбирают между низкой задержкой и строгой согласованностью и в обычное время.',
      'Even without a partition, waiting for more replicas takes longer. Systems choose between low latency and strong consistency in normal operation too.',
    ),
  },
  {
    q: tr(
      'В журнале событий оказалось ошибочное списание. Как его исправить в Event Sourcing?',
      'The event log contains an erroneous withdrawal. How do you fix it in Event Sourcing?',
    ),
    options: tr(
      ['Удалить событие', 'Изменить сумму в событии', 'Дописать компенсирующее событие (сторно)', 'Пересоздать поток'],
      ['Delete the event', 'Change the amount in the event', 'Append a compensating event (reversal)', 'Recreate the stream'],
    ),
    correct: 2,
    explain: tr(
      'Журнал append-only. Ошибку исправляет новое событие, которое ссылается на ошибочное: история сохраняется полностью.',
      'The log is append-only. A mistake is fixed by a new event that references the erroneous one: the history is preserved in full.',
    ),
  },
  {
    q: tr('Зачем в Event Sourcing нужны снапшоты?', 'Why does Event Sourcing need snapshots?'),
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
    ),
    correct: 1,
    explain: tr(
      'Снапшот — кэш состояния на событии #N. Загрузка = снапшот + события после него. Источником истины остаётся журнал.',
      'A snapshot is a cache of the state as of event #N. Loading = snapshot + the events after it. The log remains the source of truth.',
    ),
  },
  {
    q: tr(
      'Как поддержать старые события v1 после изменения схемы на v2, не трогая журнал?',
      'How do you support old v1 events after the schema changes to v2, without touching the log?',
    ),
    options: tr(
      ['Переписать журнал', 'Upcaster при чтении', 'Удалить старые события', 'Запретить старые события'],
      ['Rewrite the log', 'An upcaster on read', 'Delete the old events', 'Forbid the old events'],
    ),
    correct: 1,
    explain: tr(
      'Upcaster превращает v1 в v2 в момент чтения. Журнал остаётся неизменным, а новый код знает только последнюю версию.',
      'An upcaster converts v1 to v2 at read time. The log stays unchanged, and the new code only knows the latest version.',
    ),
  },
  {
    q: tr(
      'Две команды одновременно списывают деньги с одного счёта. Что не даст уйти в минус без блокировок?',
      'Two commands withdraw money from the same account at the same time. What prevents a negative balance without locks?',
    ),
    options: tr(
      [
        'Проверка баланса в обработчике',
        'Оптимистическая конкурентность по версии потока',
        'Проекция баланса',
        'Снапшот',
      ],
      ['A balance check in the handler', 'Optimistic concurrency on the stream version', 'A balance projection', 'A snapshot'],
    ),
    correct: 1,
    explain: tr(
      'Событие дописывается только при ожидаемой версии. Вторая команда получит конфликт, перечитает поток и увидит, что денег не хватает.',
      'The event is appended only if the expected version matches. The second command gets a conflict, reloads the stream and sees there is not enough money.',
    ),
  },
]
