import type { Lesson } from '../types'
import { Callout } from '../../components/Try'
import { tr } from '../../i18n'

function Cap() {
  return (
    <div className="lesson">
      <p>
        Когда данные хранятся в нескольких репликах, сеть между ними рано или поздно рвётся. <b>CAP-теорема</b> говорит,
        что в момент разрыва (<b>P</b>artition) система выбирает одно из двух:
      </p>
      <ul>
        <li>
          <b>C</b>onsistency — каждый ответ видит последнюю подтверждённую запись. Тогда часть узлов отказывает, пока
          связь не вернётся.
        </li>
        <li>
          <b>A</b>vailability — каждый живой узел отвечает. Тогда ответы могут быть устаревшими, а записи двух сторон —
          конфликтовать.
        </li>
      </ul>
      <Callout>
        «Выбери два из трёх» — популярное, но неточное прочтение. P не выбирают: разрывы сети случаются. Выбор C или A
        делается только на время разрыва, а в остальное время система может быть и согласованной, и доступной.
      </Callout>
      <h2>Кворумы: R + W &gt; N</h2>
      <p>
        В Dynamo-подобных хранилищах (Cassandra, Riak, DynamoDB) запись подтверждается, когда ответили <b>W</b> из{' '}
        <b>N</b> реплик, а чтение опрашивает <b>R</b> реплик. Если <b>R + W &gt; N</b>, множества пересекаются, и
        чтение гарантированно увидит последнюю запись.
      </p>
      <table className="cmp">
        <thead>
          <tr>
            <th>Настройка (N = 3)</th>
            <th>Что получаем</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>W = 2, R = 2</td>
            <td>Кворум большинства: согласованность, переживает падение одного узла</td>
          </tr>
          <tr>
            <td>W = 3, R = 1</td>
            <td>Быстрое и свежее чтение, но любая упавшая реплика блокирует запись</td>
          </tr>
          <tr>
            <td>W = 1, R = 3</td>
            <td>Быстрая запись, но любая упавшая реплика блокирует чтение</td>
          </tr>
          <tr>
            <td>W = 1, R = 1</td>
            <td>Максимальная доступность и скорость, чтение может быть устаревшим</td>
          </tr>
        </tbody>
      </table>
      <h2>Sloppy quorum и разрешение конфликтов</h2>
      <p>
        AP-системы при нехватке реплик пишут в те, что доступны (sloppy quorum, hinted handoff). После восстановления
        связи у сторон разные данные, и их надо свести. <b>Last write wins</b> молча выбрасывает одну из версий.{' '}
        <b>Слияние</b> — векторные часы с ручным разрешением или CRDT — не теряет ничего, но требует, чтобы данные
        умели сливаться (множество, счётчик, корзина).
      </p>
      <h2>PACELC</h2>
      <p>
        Расширение CAP: если есть разрыв (<b>P</b>) — выбираем <b>A</b> или <b>C</b>; иначе (<b>E</b>lse) — выбираем
        между задержкой (<b>L</b>atency) и согласованностью (<b>C</b>). Даже в идеальной сети дождаться трёх реплик
        дольше, чем одной.
      </p>
      <Callout>
        Практическое правило: деньги, остатки и уникальность (CP) — кворум большинства или Raft, меньшинство отказывает.
        Корзины, лайки, счётчики просмотров и сессии (AP) — доступность плюс слияние без потерь.
      </Callout>
    </div>
  )
}

function CapEn() {
  return (
    <div className="lesson">
      <p>
        When data is stored in several replicas, the network between them will sooner or later fail. The{' '}
        <b>CAP theorem</b> says that during a network partition (<b>P</b>artition) the system has to pick one of two:
      </p>
      <ul>
        <li>
          <b>C</b>onsistency — every response sees the latest acknowledged write. Then some nodes reject requests until
          the connection is restored.
        </li>
        <li>
          <b>A</b>vailability — every live node responds. Then responses may be stale, and writes from the two sides may
          conflict.
        </li>
      </ul>
      <Callout>
        “Pick two out of three” is a popular but inaccurate reading. You do not choose P: network partitions happen. The
        choice between C and A applies only during a partition; the rest of the time a system can be both consistent and
        available.
      </Callout>
      <h2>Quorums: R + W &gt; N</h2>
      <p>
        In Dynamo-style stores (Cassandra, Riak, DynamoDB) a write is acknowledged once <b>W</b> of <b>N</b> replicas
        have responded, and a read queries <b>R</b> replicas. If <b>R + W &gt; N</b>, the sets overlap, and a read is
        guaranteed to see the latest write.
      </p>
      <table className="cmp">
        <thead>
          <tr>
            <th>Setting (N = 3)</th>
            <th>What you get</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>W = 2, R = 2</td>
            <td>Majority quorum: consistency, survives the failure of one node</td>
          </tr>
          <tr>
            <td>W = 3, R = 1</td>
            <td>Fast, fresh reads, but any failed replica blocks writes</td>
          </tr>
          <tr>
            <td>W = 1, R = 3</td>
            <td>Fast writes, but any failed replica blocks reads</td>
          </tr>
          <tr>
            <td>W = 1, R = 1</td>
            <td>Maximum availability and speed; reads may be stale</td>
          </tr>
        </tbody>
      </table>
      <h2>Sloppy quorum and conflict resolution</h2>
      <p>
        When replicas are missing, AP systems write to whichever ones are reachable (sloppy quorum, hinted handoff). Once
        the connection is restored, the sides hold different data that must be reconciled. <b>Last write wins</b>{' '}
        silently throws one of the versions away. A <b>merge</b> — vector clocks with manual resolution, or CRDTs — loses
        nothing, but requires data that can be merged (a set, a counter, a shopping cart).
      </p>
      <h2>PACELC</h2>
      <p>
        An extension of CAP: if there is a partition (<b>P</b>), choose <b>A</b> or <b>C</b>; otherwise (<b>E</b>lse),
        choose between latency (<b>L</b>atency) and consistency (<b>C</b>). Even on a perfect network, waiting for three
        replicas takes longer than waiting for one.
      </p>
      <Callout>
        Rule of thumb: money, stock levels and uniqueness (CP) — majority quorum or Raft, the minority rejects requests.
        Carts, likes, view counters and sessions (AP) — availability plus a lossless merge.
      </Callout>
    </div>
  )
}

function EventSourcing() {
  return (
    <div className="lesson">
      <p>
        В обычной системе хранится текущее состояние: «баланс 700 ₽». В <b>Event Sourcing</b> хранится вся история
        изменений: «счёт открыт», «пополнен на 1000», «списано 300». Текущее состояние — это <b>свёртка</b> журнала
        событий.
      </p>
      <h2>Свойства журнала</h2>
      <ul>
        <li>
          <b>Append-only.</b> События — факты прошлого: их не правят и не удаляют. Ошибку исправляют новым,
          компенсирующим событием.
        </li>
        <li>
          <b>Поток на агрегат.</b> У каждого счёта свой поток событий с номерами версий. Команда загружает поток,
          проверяет правила и дописывает новые события.
        </li>
        <li>
          <b>Оптимистическая конкурентность.</b> Дописывать можно только при ожидаемой версии потока. Если кто-то успел
          раньше — конфликт, перечитать и повторить.
        </li>
      </ul>
      <h2>Проекции и CQRS</h2>
      <p>
        Читать журнал на каждый запрос неудобно, поэтому подписчики строят <b>проекции</b> — таблицы под конкретные
        запросы: баланс, выписка, отчёт. Это и есть CQRS: модель записи (журнал) отделена от моделей чтения. Проекцию
        можно в любой момент выбросить и построить заново, проиграв журнал с начала.
      </p>
      <h2>Цена подхода</h2>
      <table className="cmp">
        <thead>
          <tr>
            <th>Проблема</th>
            <th>Решение</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Длинные потоки грузятся медленно</td>
            <td>Снапшоты состояния каждые N событий</td>
          </tr>
          <tr>
            <td>Схема событий меняется</td>
            <td>Версии событий и upcaster-ы при чтении</td>
          </tr>
          <tr>
            <td>Проекции отстают от журнала</td>
            <td>Eventual consistency в UI: «операция принята»</td>
          </tr>
          <tr>
            <td>Нужно «забыть» персональные данные (GDPR, 152-ФЗ)</td>
            <td>Crypto-shredding: удаляется ключ шифрования, а не событие</td>
          </tr>
        </tbody>
      </table>
      <Callout>
        Event Sourcing хорош там, где история — часть бизнеса: деньги, учёт, логистика, аудит. Для простого CRUD это
        лишняя сложность. Начинайте с одного агрегата, а не со всей системы.
      </Callout>
    </div>
  )
}

function EventSourcingEn() {
  return (
    <div className="lesson">
      <p>
        A conventional system stores the current state: “balance 700 ₽”. With <b>Event Sourcing</b> you store the entire
        history of changes: “account opened”, “deposited 1,000”, “withdrew 300”. The current state is a <b>fold</b> over
        the event log.
      </p>
      <h2>Properties of the log</h2>
      <ul>
        <li>
          <b>Append-only.</b> Events are facts about the past: they are never edited or deleted. A mistake is fixed with
          a new, compensating event.
        </li>
        <li>
          <b>One stream per aggregate.</b> Each account has its own stream of events with version numbers. A command
          loads the stream, checks the business rules and appends new events.
        </li>
        <li>
          <b>Optimistic concurrency.</b> You may append only at the expected stream version. If someone got there first,
          it is a conflict: reload and retry.
        </li>
      </ul>
      <h2>Projections and CQRS</h2>
      <p>
        Reading the log for every query is impractical, so subscribers build <b>projections</b> — tables tailored to
        specific queries: balance, statement, report. This is CQRS: the write model (the log) is separated from the read
        models. A projection can be thrown away at any time and rebuilt by replaying the log from the start.
      </p>
      <h2>The cost of the approach</h2>
      <table className="cmp">
        <thead>
          <tr>
            <th>Problem</th>
            <th>Solution</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Long streams load slowly</td>
            <td>State snapshots every N events</td>
          </tr>
          <tr>
            <td>The event schema changes</td>
            <td>Event versions and upcasters on read</td>
          </tr>
          <tr>
            <td>Projections lag behind the log</td>
            <td>Eventual consistency in the UI: “operation accepted”</td>
          </tr>
          <tr>
            <td>Personal data must be “forgotten” (GDPR, Russian Federal Law 152-FZ)</td>
            <td>Crypto-shredding: delete the encryption key, not the event</td>
          </tr>
        </tbody>
      </table>
      <Callout>
        Event Sourcing shines where history is part of the business: money, accounting, logistics, auditing. For simple
        CRUD it is unnecessary complexity. Start with a single aggregate, not the whole system.
      </Callout>
    </div>
  )
}

export const dataLessons: Lesson[] = [
  {
    id: 'cap',
    title: tr('CAP, кворумы и PACELC', 'CAP, quorums and PACELC'),
    summary: tr('Что выбирает система при разрыве сети и как это настраивается', 'What a system chooses during a network partition, and how to configure it'),
    minutes: 8,
    Body: tr(Cap, CapEn),
  },
  {
    id: 'event-sourcing',
    title: tr('Event Sourcing и CQRS', 'Event Sourcing and CQRS'),
    summary: tr('Журнал событий как источник истины, проекции, снапшоты, версии', 'The event log as the source of truth, projections, snapshots, versions'),
    minutes: 8,
    Body: tr(EventSourcing, EventSourcingEn),
  },
]
