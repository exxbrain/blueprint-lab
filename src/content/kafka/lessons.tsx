import { tr } from '../../i18n'
import type { Lesson } from '../types'
import { Callout, Try } from '../../components/Try'
import { KafkaSimulator } from '../../sim/kafka/KafkaSimulator'
import type { KafkaConfig } from '../../sim/kafka/engine'

const base: KafkaConfig = {
  brokers: 3,
  partitions: 1,
  replicationFactor: 1,
  minInsyncReplicas: 1,
  uncleanLeaderElection: false,
  producers: [{ rate: 5, keyStrategy: 'order', acks: 1 }],
  groups: [{ name: 'billing', consumers: 1, consumerRate: 8 }],
}

function Intro() {
  return (
    <div className="lesson">
      <p>
        Представьте интернет-магазин. Сервис заказов должен сообщить биллингу, складу, аналитике и рассылке, что
        появился новый заказ. Если он будет вызывать каждого напрямую, то будет знать про всех, будет ждать
        самого медленного и упадёт вместе с любым из них.
      </p>
      <p>
        <b>Kafka</b> решает это иначе. Сервис заказов просто дописывает событие «заказ создан» в общий журнал, а
        все, кому интересно, читают этот журнал в своём темпе. Писатель не знает читателей, читатели не мешают
        друг другу.
      </p>
      <h2>Основные понятия</h2>
      <ul>
        <li>
          <b>Topic</b> — именованный журнал событий, например <code>orders</code>.
        </li>
        <li>
          <b>Producer</b> — тот, кто пишет в топик. Запись всегда идёт в конец (append-only).
        </li>
        <li>
          <b>Consumer</b> — тот, кто читает. Он сам помнит, докуда дочитал: это его <b>offset</b>.
        </li>
        <li>
          <b>Broker</b> — сервер Kafka. Кластер обычно состоит из 3 и более брокеров.
        </li>
      </ul>
      <Callout>
        Главное отличие от классической очереди (RabbitMQ, SQS): прочитанное сообщение <b>не удаляется</b>. Оно
        живёт, пока не истечёт retention (например, 7 дней). Поэтому новый сервис может прочитать историю с самого
        начала, а упавший — продолжить с того места, где остановился.
      </Callout>
      <h2>Лаг</h2>
      <p>
        Если продюсер пишет быстрее, чем консьюмер успевает обрабатывать, разница копится. Это <b>consumer lag</b>:
        сколько сообщений записано, но ещё не обработано. Лаг — главная метрика здоровья любой системы на Kafka.
      </p>
      <Try
        title="Попробуйте"
        task={
          <>
            Сейчас консьюмер обрабатывает 8 сообщ./с, а продюсер пишет 5. Поднимите скорость продюсера до 15 и
            посмотрите, как растёт лаг (метка ▲billing отстаёт от конца лога). Затем ускорьте консьюмера.
          </>
        }
      >
        <KafkaSimulator config={base} controls={{ producers: true, consumerRate: true }} compact />
      </Try>
    </div>
  )
}

function Partitions() {
  return (
    <div className="lesson">
      <p>
        Один журнал читается одним потоком, а это потолок. Поэтому топик делится на <b>партиции</b>, то есть
        несколько независимых журналов. У каждой партиции свои offsets, и партиции можно читать параллельно.
      </p>
      <h2>Как сообщение выбирает партицию</h2>
      <ul>
        <li>
          <b>Есть ключ</b> → <code>hash(key) % число_партиций</code>. Одинаковый ключ всегда попадает в одну и ту
          же партицию.
        </li>
        <li>
          <b>Нет ключа</b> → сообщения раскидываются по партициям (round-robin; в новых клиентах — sticky
          partitioner пачками).
        </li>
      </ul>
      <Callout>
        Kafka гарантирует порядок <b>только внутри партиции</b>. Если события одного заказа («создан» → «оплачен» →
        «отправлен») попадут в разные партиции, разные консьюмеры могут обработать их в любом порядке, и склад
        отправит неоплаченный заказ.
      </Callout>
      <p>
        Поэтому ключ выбирают по сущности, для которой важен порядок: <code>orderId</code>, <code>userId</code>,{' '}
        <code>accountId</code>.
      </p>
      <Try
        title="Порядок событий"
        task={
          <>
            Продюсер пишет без ключа. Следите за счётчиком «нарушений порядка» у группы. Переключите ключ на «id
            заказа»: новые нарушения перестанут появляться. Цифра в квадрате — стадия заказа, цвет — сам заказ:
            видно, как события одного цвета разлетаются по партициям.
          </>
        }
      >
        <KafkaSimulator
          config={{
            ...base,
            partitions: 3,
            producers: [{ rate: 20, keyStrategy: 'none', acks: 1 }],
            groups: [{ name: 'shipping', consumers: 3, consumerRate: 9 }],
          }}
          controls={{ keys: true, producers: true }}
          compact
        />
      </Try>
      <h2>Подводные камни</h2>
      <ul>
        <li>
          <b>Горячая партиция.</b> Если у одного ключа большая доля трафика (крупный клиент), его партиция
          перегружена, а остальные простаивают.
        </li>
        <li>
          <b>Добавление партиций</b> меняет <code>hash % N</code>: ключ «переезжает» в другую партицию, и на время
          переходного периода порядок ломается. Число партиций выбирают с запасом заранее.
        </li>
        <li>Уменьшить число партиций нельзя.</li>
      </ul>
    </div>
  )
}

function Groups() {
  return (
    <div className="lesson">
      <p>
        <b>Consumer group</b> — команда консьюмеров, которые вместе обрабатывают топик. Kafka раздаёт им партиции
        так, чтобы <b>каждую партицию в группе читал ровно один консьюмер</b>.
      </p>
      <ul>
        <li>Консьюмеров меньше, чем партиций → кто-то читает несколько партиций.</li>
        <li>
          Консьюмеров больше, чем партиций → лишние <b>простаивают</b>. Число партиций — это потолок параллелизма
          группы.
        </li>
        <li>
          Разные группы читают топик <b>независимо</b>: у billing и analytics свои offsets и свой лаг.
        </li>
      </ul>
      <h2>Ребалансировка</h2>
      <p>
        Когда консьюмер входит в группу, выходит или падает, группа перераспределяет партиции. В классическом (eager)
        протоколе на это время <b>чтение останавливается у всех</b>. Частые ребалансировки, например из-за долгой
        обработки и пропущенных heartbeat, — частая причина растущего лага. Cooperative-sticky assignor и static
        membership смягчают проблему.
      </p>
      <h2>Коммит offset и дубликаты</h2>
      <p>
        Консьюмер периодически <b>коммитит</b> offset: сохраняет в Kafka, докуда дочитал. По умолчанию это
        auto-commit раз в 5 секунд (в симуляторе раз в секунду). Если консьюмер упал между обработкой и коммитом,
        новый владелец партиции начнёт с последнего коммита и обработает часть сообщений <b>повторно</b>.
      </p>
      <Callout>
        Это семантика <b>at-least-once</b>, и она по умолчанию у большинства систем. Вывод: обработчик должен быть{' '}
        <b>идемпотентным</b>, чтобы повторная обработка не списала деньги дважды.
      </Callout>
      <Try
        title="Группы, простои и дубликаты"
        task={
          <>
            1) Добавьте консьюмеров в billing, чтобы их стало больше 4, и найдите простаивающих. 2) Уроните
            консьюмера кнопкой 💥 и посмотрите на счётчик дубликатов. 3) Остановите консьюмера штатно (✕): дубликатов
            не будет. 4) Добавьте вторую группу: у неё свой лаг.
          </>
        }
      >
        <KafkaSimulator
          config={{
            ...base,
            partitions: 4,
            producers: [{ rate: 30, keyStrategy: 'order', acks: 1 }],
            groups: [{ name: 'billing', consumers: 2, consumerRate: 20 }],
          }}
          controls={{ consumers: true, groups: true, consumerRate: true }}
          compact
        />
      </Try>
    </div>
  )
}

function Replication() {
  return (
    <div className="lesson">
      <p>
        Брокеры падают. Чтобы не терять данные, каждая партиция хранится в нескольких копиях:{' '}
        <b>replication factor</b> (обычно 3). Одна копия — <b>лидер</b> (★), через неё идут запись и чтение.
        Остальные — <b>фолловеры</b>, они копируют лидера.
      </p>
      <h2>ISR и high watermark</h2>
      <p>
        <b>ISR</b> (in-sync replicas) — реплики, которые не отстают от лидера. Если фолловер тормозит дольше{' '}
        <code>replica.lag.time.max.ms</code>, он выпадает из ISR. <b>High watermark</b> — offset, до которого
        сообщения есть на всех ISR. Консьюмеры видят только сообщения ниже HW. В симуляторе всё, что выше HW,
        нарисовано пунктиром.
      </p>
      <h2>acks: когда продюсер считает запись успешной</h2>
      <table className="cmp">
        <thead>
          <tr>
            <th>acks</th>
            <th>Ждёт</th>
            <th>Риск</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>0</td>
            <td>ничего</td>
            <td>теряет при любом сбое</td>
          </tr>
          <tr>
            <td>1</td>
            <td>записи на лидере</td>
            <td>лидер упал до репликации — подтверждённые сообщения потеряны</td>
          </tr>
          <tr>
            <td>all</td>
            <td>записи на всех ISR</td>
            <td>медленнее, но подтверждённое не теряется</td>
          </tr>
        </tbody>
      </table>
      <p>
        <code>acks=all</code> работает в паре с <code>min.insync.replicas</code>. Если в ISR осталось меньше
        реплик, Kafka <b>отказывает в записи</b>: лучше ошибка, чем иллюзия надёжности. Типичная настройка для
        продакшена: RF=3, min.insync.replicas=2, acks=all. Так кластер переживает потерю одного брокера без потерь и
        без простоя.
      </p>
      <Callout danger>
        <b>unclean.leader.election.enable=true</b> разрешает сделать лидером отстающую реплику не из ISR. Партиция
        оживает быстрее, но всё, чего не было у новой реплики, пропадает навсегда.
      </Callout>
      <Try
        title="Уроните лидера"
        task={
          <>
            При acks=1 уроните брокер 1 и посмотрите на «потеряно подтверждённых». Нажмите «Сначала», выставьте
            acks=all и повторите. Затем уроните два брокера при min.insync.replicas=2: запись начнёт отказывать.
          </>
        }
      >
        <KafkaSimulator
          config={{
            ...base,
            partitions: 3,
            replicationFactor: 3,
            minInsyncReplicas: 2,
            producers: [{ rate: 40, keyStrategy: 'order', acks: 1 }],
            groups: [{ name: 'billing', consumers: 3, consumerRate: 20 }],
            replicaDelay: 0.5,
          }}
          controls={{ brokers: true, acks: true, reliability: true }}
          compact
        />
      </Try>
    </div>
  )
}

function Semantics() {
  return (
    <div className="lesson">
      <h2>Три семантики доставки</h2>
      <table className="cmp">
        <thead>
          <tr>
            <th>Семантика</th>
            <th>Как получается</th>
            <th>Цена</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>at-most-once</td>
            <td>коммит offset до обработки</td>
            <td>сбой во время обработки → сообщение потеряно</td>
          </tr>
          <tr>
            <td>at-least-once</td>
            <td>коммит после обработки</td>
            <td>сбой до коммита → повторная обработка</td>
          </tr>
          <tr>
            <td>exactly-once</td>
            <td>идемпотентный продюсер + транзакции (или дедупликация на стороне получателя)</td>
            <td>сложнее, работает только в пределах Kafka</td>
          </tr>
        </tbody>
      </table>
      <h2>Идемпотентный продюсер</h2>
      <p>
        Продюсер повторяет запрос, если не дождался ответа, и без защиты сообщение запишется дважды. С{' '}
        <code>enable.idempotence=true</code> (по умолчанию с Kafka 3.0) у продюсера есть ID и порядковый номер
        каждого сообщения, и брокер отбрасывает повторы.
      </p>
      <h2>Транзакции</h2>
      <p>
        Паттерн «прочитал → обработал → записал в другой топик → закоммитил offset» можно сделать атомарным.
        Консьюмеры с <code>isolation.level=read_committed</code> не увидят незавершённых транзакций. Так работает
        Kafka Streams с <code>exactly_once_v2</code>.
      </p>
      <Callout>
        Exactly-once в Kafka заканчивается на границе Kafka. Если обработчик пишет в Postgres или вызывает
        платёжный API, нужна <b>идемпотентность на стороне получателя</b>: уникальный ключ операции, таблица
        обработанных сообщений, upsert вместо insert.
      </Callout>
      <h2>Transactional Outbox</h2>
      <p>
        Классическая ловушка: сервис сохраняет заказ в БД и публикует событие в Kafka. Это две разные системы без
        общей транзакции. Если упасть между ними, событие потеряется или, наоборот, уйдёт событие о заказе, которого
        нет.
      </p>
      <p>
        Решение: в <b>той же транзакции БД</b> записать событие в таблицу <code>outbox</code>, а отдельный процесс
        (или Debezium через CDC) перекладывает его в Kafka. Доставка at-least-once, поэтому получатели снова должны
        быть идемпотентными.
      </p>
    </div>
  )
}

function Storage() {
  return (
    <div className="lesson">
      <p>
        Партиция на диске — набор файлов-<b>сегментов</b>. Запись идёт только в активный сегмент, старые сегменты
        неизменяемы. Поэтому Kafka быстрая: последовательная запись на диск, page cache ОС, zero-copy отправка
        консьюмерам.
      </p>
      <h2>Retention</h2>
      <p>
        Старые сегменты удаляются по времени (<code>retention.ms</code>, по умолчанию 7 дней) или по размеру (
        <code>retention.bytes</code>). Если консьюмер отстал сильнее retention, его offset указывает на удалённые
        данные. Тогда срабатывает <code>auto.offset.reset</code> (earliest или latest), и часть событий он не
        увидит никогда.
      </p>
      <h2>Log compaction</h2>
      <p>
        С <code>cleanup.policy=compact</code> Kafka хранит <b>последнее значение по каждому ключу</b>, а старые
        версии вычищает. Получается таблица в виде журнала: например, текущий профиль каждого пользователя. Чтобы
        удалить ключ, пишут <b>tombstone</b> — сообщение с этим ключом и value = null.
      </p>
      <table className="cmp">
        <thead>
          <tr>
            <th>Задача</th>
            <th>Политика</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Поток событий: клики, заказы, логи</td>
            <td>delete + retention</td>
          </tr>
          <tr>
            <td>Текущее состояние сущностей, changelog для KTable</td>
            <td>compact</td>
          </tr>
          <tr>
            <td>И то и другое</td>
            <td>compact,delete</td>
          </tr>
        </tbody>
      </table>
      <Callout>
        Kafka — не база данных для запросов. В ней нельзя найти «все заказы клиента X». Это транспорт и журнал.
        Чтобы получить запрашиваемое представление, события проецируют в БД (CQRS) или используют Kafka Streams и
        ksqlDB.
      </Callout>
    </div>
  )
}

// ---------- English ----------

function IntroEn() {
  return (
    <div className="lesson">
      <p>
        Picture an online store. The order service has to tell billing, the warehouse, analytics and the mailing
        service that a new order has arrived. If it calls each of them directly, it has to know about all of them,
        wait for the slowest one, and go down together with any of them.
      </p>
      <p>
        <b>Kafka</b> solves this differently. The order service simply appends an "order created" event to a shared
        log, and everyone interested reads that log at their own pace. The writer does not know the readers, and the
        readers do not get in each other's way.
      </p>
      <h2>Core concepts</h2>
      <ul>
        <li>
          <b>Topic</b> — a named event log, for example <code>orders</code>.
        </li>
        <li>
          <b>Producer</b> — whoever writes to a topic. Writes always go to the end (append-only).
        </li>
        <li>
          <b>Consumer</b> — whoever reads. It keeps track of how far it has read: that is its <b>offset</b>.
        </li>
        <li>
          <b>Broker</b> — a Kafka server. A cluster usually has 3 or more brokers.
        </li>
      </ul>
      <Callout>
        The key difference from a classic queue (RabbitMQ, SQS): a message that has been read is <b>not deleted</b>.
        It lives until retention expires (for example, 7 days). So a new service can read the history from the very
        beginning, and a crashed one can resume where it left off.
      </Callout>
      <h2>Lag</h2>
      <p>
        If the producer writes faster than the consumer can process, the difference piles up. This is{' '}
        <b>consumer lag</b>: how many messages have been written but not yet processed. Lag is the key health metric
        of any Kafka-based system.
      </p>
      <Try
        title="Try it"
        task={
          <>
            The consumer currently processes 8 msg/s and the producer writes 5. Raise the producer rate to 15 and watch
            the lag grow (the ▲billing marker falls behind the end of the log). Then speed up the consumer.
          </>
        }
      >
        <KafkaSimulator config={base} controls={{ producers: true, consumerRate: true }} compact />
      </Try>
    </div>
  )
}

function PartitionsEn() {
  return (
    <div className="lesson">
      <p>
        A single log is read by a single thread, and that is a ceiling. So a topic is split into <b>partitions</b>,
        i.e. several independent logs. Each partition has its own offsets, and partitions can be read in parallel.
      </p>
      <h2>How a message picks a partition</h2>
      <ul>
        <li>
          <b>With a key</b> → <code>hash(key) % partition_count</code>. The same key always lands in the same
          partition.
        </li>
        <li>
          <b>Without a key</b> → messages are spread across partitions (round-robin; newer clients use the sticky
          partitioner in batches).
        </li>
      </ul>
      <Callout>
        Kafka guarantees order <b>only within a partition</b>. If the events of one order ("created" → "paid" →
        "shipped") land in different partitions, different consumers may process them in any order, and the warehouse
        will ship an unpaid order.
      </Callout>
      <p>
        That is why the key is chosen by the entity whose order matters: <code>orderId</code>, <code>userId</code>,{' '}
        <code>accountId</code>.
      </p>
      <Try
        title="Event order"
        task={
          <>
            The producer writes without a key. Watch the group's "order violations" counter. Switch the key to "order
            id": new violations stop appearing. The digit in a square is the order stage, the color is the order
            itself: you can see events of the same color scattering across partitions.
          </>
        }
      >
        <KafkaSimulator
          config={{
            ...base,
            partitions: 3,
            producers: [{ rate: 20, keyStrategy: 'none', acks: 1 }],
            groups: [{ name: 'shipping', consumers: 3, consumerRate: 9 }],
          }}
          controls={{ keys: true, producers: true }}
          compact
        />
      </Try>
      <h2>Pitfalls</h2>
      <ul>
        <li>
          <b>Hot partition.</b> If one key has a large share of traffic (a big customer), its partition is overloaded
          while the others sit idle.
        </li>
        <li>
          <b>Adding partitions</b> changes <code>hash % N</code>: a key "moves" to another partition, and order breaks
          during the transition. Choose the partition count with headroom up front.
        </li>
        <li>You cannot reduce the number of partitions.</li>
      </ul>
    </div>
  )
}

function GroupsEn() {
  return (
    <div className="lesson">
      <p>
        A <b>consumer group</b> is a team of consumers that process a topic together. Kafka assigns partitions to them
        so that <b>each partition in the group is read by exactly one consumer</b>.
      </p>
      <ul>
        <li>Fewer consumers than partitions → some consumers read several partitions.</li>
        <li>
          More consumers than partitions → the extra ones <b>sit idle</b>. The number of partitions is the ceiling on
          the group's parallelism.
        </li>
        <li>
          Different groups read a topic <b>independently</b>: billing and analytics have their own offsets and their own
          lag.
        </li>
      </ul>
      <h2>Rebalancing</h2>
      <p>
        When a consumer joins the group, leaves or crashes, the group reassigns partitions. In the classic (eager)
        protocol <b>everyone stops reading</b> during that time. Frequent rebalances, for example due to slow
        processing and missed heartbeats, are a common cause of growing lag. The cooperative-sticky assignor and static
        membership mitigate the problem.
      </p>
      <h2>Offset commits and duplicates</h2>
      <p>
        A consumer periodically <b>commits</b> its offset: it stores in Kafka how far it has read. By default this is
        an auto-commit every 5 seconds (every second in the simulator). If a consumer crashes between processing and
        committing, the new owner of the partition starts from the last commit and processes some messages{' '}
        <b>again</b>.
      </p>
      <Callout>
        These are <b>at-least-once</b> semantics, the default in most systems. The takeaway: a handler must be{' '}
        <b>idempotent</b>, so that reprocessing does not charge money twice.
      </Callout>
      <Try
        title="Groups, idle consumers and duplicates"
        task={
          <>
            1) Add consumers to billing until there are more than 4, and find the idle ones. 2) Crash a consumer with
            the 💥 button and watch the duplicates counter. 3) Stop a consumer gracefully (✕): there will be no
            duplicates. 4) Add a second group: it has its own lag.
          </>
        }
      >
        <KafkaSimulator
          config={{
            ...base,
            partitions: 4,
            producers: [{ rate: 30, keyStrategy: 'order', acks: 1 }],
            groups: [{ name: 'billing', consumers: 2, consumerRate: 20 }],
          }}
          controls={{ consumers: true, groups: true, consumerRate: true }}
          compact
        />
      </Try>
    </div>
  )
}

function ReplicationEn() {
  return (
    <div className="lesson">
      <p>
        Brokers fail. To avoid losing data, each partition is stored in several copies: the{' '}
        <b>replication factor</b> (usually 3). One copy is the <b>leader</b> (★), which handles writes and reads.
        The others are <b>followers</b>, which copy the leader.
      </p>
      <h2>ISR and high watermark</h2>
      <p>
        <b>ISR</b> (in-sync replicas) are the replicas that keep up with the leader. If a follower lags for longer than{' '}
        <code>replica.lag.time.max.ms</code>, it drops out of the ISR. The <b>high watermark</b> is the offset up to
        which messages exist on all ISR replicas. Consumers only see messages below the HW. In the simulator, everything
        above the HW is drawn dashed.
      </p>
      <h2>acks: when the producer considers a write successful</h2>
      <table className="cmp">
        <thead>
          <tr>
            <th>acks</th>
            <th>Waits for</th>
            <th>Risk</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>0</td>
            <td>nothing</td>
            <td>loses data on any failure</td>
          </tr>
          <tr>
            <td>1</td>
            <td>the write on the leader</td>
            <td>leader fails before replication — acknowledged messages are lost</td>
          </tr>
          <tr>
            <td>all</td>
            <td>the write on all ISR replicas</td>
            <td>slower, but nothing acknowledged is lost</td>
          </tr>
        </tbody>
      </table>
      <p>
        <code>acks=all</code> works together with <code>min.insync.replicas</code>. If fewer replicas remain in the
        ISR, Kafka <b>rejects writes</b>: an error is better than an illusion of reliability. A typical production
        setup: RF=3, min.insync.replicas=2, acks=all. This way the cluster survives the loss of one broker with no data
        loss and no downtime.
      </p>
      <Callout danger>
        <b>unclean.leader.election.enable=true</b> allows a lagging replica outside the ISR to become leader. The
        partition comes back faster, but anything the new replica did not have is lost forever.
      </Callout>
      <Try
        title="Kill the leader"
        task={
          <>
            With acks=1, kill broker 1 and watch "acknowledged lost". Click "Restart", set acks=all and repeat. Then
            kill two brokers with min.insync.replicas=2: writes will start being rejected.
          </>
        }
      >
        <KafkaSimulator
          config={{
            ...base,
            partitions: 3,
            replicationFactor: 3,
            minInsyncReplicas: 2,
            producers: [{ rate: 40, keyStrategy: 'order', acks: 1 }],
            groups: [{ name: 'billing', consumers: 3, consumerRate: 20 }],
            replicaDelay: 0.5,
          }}
          controls={{ brokers: true, acks: true, reliability: true }}
          compact
        />
      </Try>
    </div>
  )
}

function SemanticsEn() {
  return (
    <div className="lesson">
      <h2>Three delivery semantics</h2>
      <table className="cmp">
        <thead>
          <tr>
            <th>Semantics</th>
            <th>How you get it</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>at-most-once</td>
            <td>commit the offset before processing</td>
            <td>failure during processing → message lost</td>
          </tr>
          <tr>
            <td>at-least-once</td>
            <td>commit after processing</td>
            <td>failure before the commit → reprocessing</td>
          </tr>
          <tr>
            <td>exactly-once</td>
            <td>idempotent producer + transactions (or deduplication on the consumer side)</td>
            <td>more complex, works only within Kafka</td>
          </tr>
        </tbody>
      </table>
      <h2>Idempotent producer</h2>
      <p>
        A producer retries a request if it did not get a response, and without protection the message gets written
        twice. With <code>enable.idempotence=true</code> (the default since Kafka 3.0) the producer has an ID and a
        sequence number for each message, and the broker discards duplicates.
      </p>
      <h2>Transactions</h2>
      <p>
        The "read → process → write to another topic → commit offset" pattern can be made atomic. Consumers with{' '}
        <code>isolation.level=read_committed</code> do not see uncommitted transactions. This is how Kafka Streams
        works with <code>exactly_once_v2</code>.
      </p>
      <Callout>
        Exactly-once in Kafka ends at the Kafka boundary. If a handler writes to Postgres or calls a payment API, you
        need <b>idempotency on the consumer side</b>: a unique operation key, a table of processed messages, upsert
        instead of insert.
      </Callout>
      <h2>Transactional Outbox</h2>
      <p>
        A classic trap: a service saves an order to the database and publishes an event to Kafka. These are two
        separate systems with no shared transaction. If the service crashes between them, the event is lost or,
        conversely, an event goes out about an order that does not exist.
      </p>
      <p>
        The solution: in <b>the same database transaction</b>, write the event to an <code>outbox</code> table, and a
        separate process (or Debezium via CDC) moves it to Kafka. Delivery is at-least-once, so consumers again have to
        be idempotent.
      </p>
    </div>
  )
}

function StorageEn() {
  return (
    <div className="lesson">
      <p>
        On disk, a partition is a set of <b>segment</b> files. Writes go only to the active segment; old segments are
        immutable. That is why Kafka is fast: sequential disk writes, the OS page cache, zero-copy delivery to
        consumers.
      </p>
      <h2>Retention</h2>
      <p>
        Old segments are deleted by time (<code>retention.ms</code>, 7 days by default) or by size (
        <code>retention.bytes</code>). If a consumer falls behind by more than the retention period, its offset points
        to deleted data. Then <code>auto.offset.reset</code> kicks in (earliest or latest), and some events it will
        never see.
      </p>
      <h2>Log compaction</h2>
      <p>
        With <code>cleanup.policy=compact</code> Kafka keeps <b>the latest value for each key</b> and cleans up older
        versions. The result is a table in the form of a log: for example, the current profile of each user. To delete
        a key, you write a <b>tombstone</b> — a message with that key and value = null.
      </p>
      <table className="cmp">
        <thead>
          <tr>
            <th>Use case</th>
            <th>Policy</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Event stream: clicks, orders, logs</td>
            <td>delete + retention</td>
          </tr>
          <tr>
            <td>Current state of entities, changelog for a KTable</td>
            <td>compact</td>
          </tr>
          <tr>
            <td>Both</td>
            <td>compact,delete</td>
          </tr>
        </tbody>
      </table>
      <Callout>
        Kafka is not a database for queries. You cannot find "all orders of customer X" in it. It is a transport and a
        log. To get a queryable view, events are projected into a database (CQRS), or Kafka Streams and ksqlDB are used.
      </Callout>
    </div>
  )
}

export const kafkaLessons: Lesson[] = [
  {
    id: 'intro',
    title: tr('Kafka как журнал событий', 'Kafka as an event log'),
    summary: tr('Топик, продюсер, консьюмер, offset и лаг', 'Topic, producer, consumer, offset and lag'),
    minutes: 6,
    Body: tr(Intro, IntroEn),
  },
  {
    id: 'partitions',
    title: tr('Партиции и ключи', 'Partitions and keys'),
    summary: tr('Параллелизм, порядок событий, горячие партиции', 'Parallelism, event order, hot partitions'),
    minutes: 8,
    Body: tr(Partitions, PartitionsEn),
  },
  {
    id: 'groups',
    title: tr('Consumer groups и offsets', 'Consumer groups and offsets'),
    summary: tr('Распределение партиций, ребалансировка, дубликаты', 'Partition assignment, rebalancing, duplicates'),
    minutes: 8,
    Body: tr(Groups, GroupsEn),
  },
  {
    id: 'replication',
    title: tr('Репликация, ISR и acks', 'Replication, ISR and acks'),
    summary: tr('Как Kafka переживает падение брокеров и когда теряет данные', 'How Kafka survives broker failures and when it loses data'),
    minutes: 10,
    Body: tr(Replication, ReplicationEn),
  },
  {
    id: 'semantics',
    title: tr('Гарантии доставки', 'Delivery guarantees'),
    summary: tr('At-least-once, exactly-once, идемпотентность, outbox', 'At-least-once, exactly-once, idempotency, outbox'),
    minutes: 7,
    Body: tr(Semantics, SemanticsEn),
  },
  {
    id: 'storage',
    title: tr('Хранение: retention и compaction', 'Storage: retention and compaction'),
    summary: tr('Сегменты, удаление старых данных, журнал как таблица', 'Segments, deleting old data, the log as a table'),
    minutes: 5,
    Body: tr(Storage, StorageEn),
  },
]
