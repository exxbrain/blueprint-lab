import { tr } from '../../i18n'
import type { Scenario } from '../types'
import type { KafkaSim } from '../../sim/kafka/engine'

/** Ни один консьюмер не перегружен: каждому хватает скорости на входящий поток его партиций */
function keepsUp(sim: KafkaSim): boolean {
  return sim.history.length >= 6 && sim.groups.every((g) => sim.groupKeepsUp(g))
}

function rates(sim: KafkaSim): string {
  const g = sim.groups[0]
  const loads = g.consumers.map((c) => sim.consumerLoad(g, c.id))
  const max = loads.length ? Math.max(...loads) : 0
  return tr(`самый загруженный консьюмер: ${(max * 100).toFixed(0)}% мощности · лаг ${sim.totalLag(g)}`, `busiest consumer: ${(max * 100).toFixed(0)}% of capacity · lag ${sim.totalLag(g)}`)
}

/** «Ничего плохого не случилось с прошлой проверки» для накопительных счётчиков */
function unchanged(read: (sim: KafkaSim) => number) {
  const seen = new WeakMap<KafkaSim, number>()
  return (sim: KafkaSim) => {
    const v = read(sim)
    const prev = seen.get(sim)
    seen.set(sim, v)
    return prev === undefined ? false : prev === v
  }
}

const noNewViolations = unchanged((s) => s.groups.reduce((a, g) => a + g.violations, 0))
const noNewRejects = unchanged((s) => s.rejected)

export const kafkaScenarios: Scenario[] = [
  {
    id: 'lag',
    title: tr('Лаг растёт', 'Lag is growing'),
    summary: tr('Биллинг не справляется с потоком заказов', 'Billing cannot keep up with the order stream'),
    difficulty: 1,
    brief: tr(
      <>
        <p>
          Пятница, распродажа. Поток заказов вырос до 60 в секунду, а единственный экземпляр сервиса{' '}
          <b>billing</b> обрабатывает только 15. Лаг растёт, клиенты ждут подтверждения оплаты по полчаса.
        </p>
        <p>Код ускорить нельзя. Можно запускать дополнительные экземпляры сервиса.</p>
      </>,
      <>
        <p>
          Friday, a big sale. The order stream has grown to 60 per second, but the single instance of the{' '}
          <b>billing</b> service handles only 15. Lag keeps growing, and customers wait half an hour for payment confirmation.
        </p>
        <p>You cannot make the code faster. You can start additional instances of the service.</p>
      </>,
    ),
    config: {
      brokers: 3,
      partitions: 6,
      replicationFactor: 1,
      minInsyncReplicas: 1,
      uncleanLeaderElection: false,
      producers: [{ rate: 60, keyStrategy: 'order', acks: 1 }],
      groups: [{ name: 'billing', consumers: 1, consumerRate: 15 }],
    },
    controls: { consumers: true },
    goal: {
      text: tr('Обработка успевает за записью 10 секунд подряд', 'Processing keeps up with writes for 10 seconds straight'),
      holdSeconds: 10,
      check: keepsUp,
      status: (s) => tr(`${rates(s)} · консьюмеров: ${s.groups[0].consumers.length}`, `${rates(s)} · consumers: ${s.groups[0].consumers.length}`),
    },
    hints: [
      tr('15 × 4 = 60. Почему четырёх может не хватить? Посмотрите, сколько партиций досталось каждому.', '15 × 4 = 60. Why might four not be enough? Look at how many partitions each one got.'),
      tr('Партиции распределяются целиком. При 6 партициях и 4 консьюмерах двоим достанется по 2 партиции, то есть по 20 сообщ./с.', 'Partitions are assigned whole. With 6 partitions and 4 consumers, two of them get 2 partitions each, i.e. 20 msg/s.'),
      tr('Нужно столько консьюмеров, сколько партиций. Седьмой будет простаивать.', 'You need as many consumers as partitions. A seventh one would sit idle.'),
    ],
    debrief: tr(
      <>
        <p>
          Масштабирование консьюмеров упирается в <b>партиции</b>: единица распределения — партиция целиком. При
          неровном делении самый нагруженный консьюмер определяет лаг всей группы.
        </p>
        <p>
          Практика: число партиций берут кратным ожидаемому числу экземпляров (6, 12, 24) и с запасом на рост, а
          автоскейлинг консьюмеров (например, KEDA в Kubernetes) настраивают по метрике лага.
        </p>
      </>,
      <>
        <p>
          Scaling consumers is bounded by <b>partitions</b>: the unit of distribution is a whole partition. With
          uneven division, the most loaded consumer determines the lag of the entire group.
        </p>
        <p>
          In practice: choose a partition count that is a multiple of the expected number of instances (6, 12, 24) with
          headroom for growth, and autoscale consumers (for example, with KEDA in Kubernetes) based on the lag metric.
        </p>
      </>,
    ),
  },
  {
    id: 'ceiling',
    title: tr('Потолок параллелизма', 'The parallelism ceiling'),
    summary: tr('Экземпляров много, а лаг всё равно растёт', 'Plenty of instances, yet lag keeps growing'),
    difficulty: 1,
    brief: tr(
      <>
        <p>
          Команда уже подняла 4 экземпляра <b>analytics</b>, но лаг продолжает расти. В мониторинге видно, что два
          экземпляра вообще ничего не делают.
        </p>
      </>,
      <>
        <p>
          The team has already started 4 instances of <b>analytics</b>, but lag keeps growing. Monitoring shows that two
          instances are doing nothing at all.
        </p>
      </>,
    ),
    config: {
      brokers: 3,
      partitions: 2,
      replicationFactor: 1,
      minInsyncReplicas: 1,
      uncleanLeaderElection: false,
      producers: [{ rate: 40, keyStrategy: 'order', acks: 1 }],
      groups: [{ name: 'analytics', consumers: 4, consumerRate: 12 }],
    },
    controls: { consumers: true, partitions: true },
    goal: {
      text: tr('Обработка успевает за записью 10 секунд подряд', 'Processing keeps up with writes for 10 seconds straight'),
      holdSeconds: 10,
      check: keepsUp,
      status: (s) => tr(`${rates(s)} · партиций: ${s.partitions.length}`, `${rates(s)} · partitions: ${s.partitions.length}`),
    },
    hints: [
      tr('Почему два консьюмера простаивают? Сколько партиций в топике?', 'Why are two consumers idle? How many partitions does the topic have?'),
      tr('В группе один консьюмер на партицию. Добавлять консьюмеров бесполезно: нужно больше партиций.', 'A group has one consumer per partition. Adding consumers is pointless: you need more partitions.'),
    ],
    debrief: tr(
      <>
        <p>
          Число партиций — <b>верхняя граница параллелизма</b> одной группы. Лишние консьюмеры работают только как
          горячий резерв.
        </p>
        <p>
          Обратите внимание на журнал: после добавления партиций ключи начали попадать в другие партиции. На проде
          это временно ломает порядок, поэтому партиции закладывают заранее, а не добавляют во время инцидента.
        </p>
      </>,
      <>
        <p>
          The number of partitions is the <b>upper bound on parallelism</b> for a single group. Extra consumers only
          act as hot standbys.
        </p>
        <p>
          Look at the event log: after partitions were added, keys started landing in different partitions. In production
          this temporarily breaks ordering, so partitions are planned up front rather than added during an incident.
        </p>
      </>,
    ),
  },
  {
    id: 'ordering',
    title: tr('Оплачен раньше, чем создан', 'Paid before created'),
    summary: tr('Склад получает события заказа вперемешку', 'The warehouse receives order events out of order'),
    difficulty: 2,
    brief: tr(
      <>
        <p>
          Сервис <b>shipping</b> регулярно получает «заказ оплачен» раньше, чем «заказ создан», и падает с ошибкой
          «заказ не найден». Иногда он отправляет посылку до оплаты.
        </p>
        <p>Масштаб менять нельзя. Найдите причину в настройках продюсера.</p>
      </>,
      <>
        <p>
          The <b>shipping</b> service regularly receives "order paid" before "order created" and fails with an
          "order not found" error. Sometimes it ships a parcel before payment.
        </p>
        <p>You cannot change the scale. Find the cause in the producer settings.</p>
      </>,
    ),
    config: {
      brokers: 3,
      partitions: 3,
      replicationFactor: 1,
      minInsyncReplicas: 1,
      uncleanLeaderElection: false,
      producers: [{ rate: 20, keyStrategy: 'none', acks: 1 }],
      groups: [{ name: 'shipping', consumers: 3, consumerRate: 7.5 }],
    },
    controls: { keys: true },
    goal: {
      text: tr('10 секунд без новых нарушений порядка', '10 seconds without new order violations'),
      holdSeconds: 10,
      check: noNewViolations,
      status: (s) => tr(`нарушений всего: ${s.groups[0].violations} · ключ: ${s.producers[0].keyStrategy}`, `total violations: ${s.groups[0].violations} · key: ${s.producers[0].keyStrategy}`),
    },
    hints: [
      tr('Посмотрите на цвета: где лежат события одного заказа?', 'Look at the colors: where do the events of a single order end up?'),
      tr('Порядок гарантируется только внутри партиции. Как сделать, чтобы все события заказа попадали в одну партицию?', 'Order is guaranteed only within a partition. How do you make all events of an order land in the same partition?'),
    ],
    debrief: tr(
      <>
        <p>
          Без ключа события одного заказа разлетаются по партициям, и их обрабатывают разные консьюмеры с разным
          лагом. С ключом <code>orderId</code> все события заказа идут в одну партицию к одному консьюмеру по
          порядку.
        </p>
        <p>
          Ключ «клиент» тоже сохраняет порядок, но создаёт горячие партиции. Об этом следующая задача.
        </p>
      </>,
      <>
        <p>
          Without a key, events of a single order scatter across partitions and are processed by different consumers
          with different lag. With the <code>orderId</code> key, all events of an order go to one partition and one
          consumer, in order.
        </p>
        <p>
          The "customer" key also preserves order, but creates hot partitions. That is the next challenge.
        </p>
      </>,
    ),
  },
  {
    id: 'hot-partition',
    title: tr('Горячая партиция', 'Hot partition'),
    summary: tr('Одна партиция перегружена, остальные скучают', 'One partition is overloaded, the rest are idle'),
    difficulty: 2,
    brief: tr(
      <>
        <p>
          Сообщения партиционируются по клиенту. 70% заказов приходит от одного крупного клиента{' '}
          <code>big-corp</code>. Лаг одной партиции огромный, у остальных ноль. Добавление консьюмеров и партиций не
          помогает.
        </p>
        <p>
          Бизнес-требование: порядок важен в пределах <b>заказа</b>, а не клиента.
        </p>
      </>,
      <>
        <p>
          Messages are partitioned by customer. 70% of orders come from a single large customer{' '}
          <code>big-corp</code>. One partition has huge lag, the others have zero. Adding consumers and partitions does
          not help.
        </p>
        <p>
          Business requirement: order matters within an <b>order</b>, not within a customer.
        </p>
      </>,
    ),
    config: {
      brokers: 3,
      partitions: 4,
      replicationFactor: 1,
      minInsyncReplicas: 1,
      uncleanLeaderElection: false,
      producers: [{ rate: 40, keyStrategy: 'customer', acks: 1 }],
      groups: [{ name: 'billing', consumers: 4, consumerRate: 14 }],
    },
    controls: { keys: true, consumers: true, partitions: true },
    goal: {
      text: tr('Обработка успевает за записью 10 секунд подряд, порядок заказов не нарушается', 'Processing keeps up with writes for 10 seconds straight, without breaking order'),
      holdSeconds: 10,
      check: (s) => keepsUp(s) && s.producers[0].keyStrategy !== 'none',
      status: (s) => tr(`${rates(s)} · макс. лаг партиции: ${s.maxPartitionLag(s.groups[0])}`, `${rates(s)} · max partition lag: ${s.maxPartitionLag(s.groups[0])}`),
    },
    hints: [
      tr('Почему новые партиции не помогают? Куда попадает ключ big-corp после добавления партиции?', 'Why do new partitions not help? Where does the big-corp key go after a partition is added?'),
      tr('Ключ должен быть настолько мелким, насколько позволяет требование к порядку.', 'The key should be as fine-grained as the ordering requirement allows.'),
    ],
    debrief: tr(
      <>
        <p>
          Ключ задаёт и порядок, и <b>распределение нагрузки</b>. Крупный ключ (клиент, страна, тип события) даёт
          перекос: один ключ — одна партиция — один консьюмер, и горизонтально это не масштабируется.
        </p>
        <p>
          Выбирайте самый мелкий ключ, для которого важен порядок. Если порядок нужен для огромной сущности,
          используют составной ключ (salting) и сборку порядка на стороне получателя.
        </p>
      </>,
      <>
        <p>
          The key determines both ordering and <b>load distribution</b>. A coarse key (customer, country, event type)
          causes skew: one key means one partition and one consumer, and that does not scale horizontally.
        </p>
        <p>
          Choose the finest-grained key for which order matters. If order is needed for a huge entity, use a
          composite key (salting) and restore order on the consumer side.
        </p>
      </>,
    ),
  },
  {
    id: 'broker-crash',
    title: tr('Ночное падение брокера', 'Broker crash at night'),
    summary: tr('Настройте надёжность до аварии', 'Set up reliability before the failure'),
    difficulty: 3,
    brief: tr(
      <>
        <p>
          В прошлый раз при падении брокера пропало несколько оплат: продюсер получил подтверждение, а данных в Kafka
          нет. Финдиректор недоволен.
        </p>
        <p>
          Настройте продюсер и топик так, чтобы падение одного брокера <b>не потеряло ни одного подтверждённого
          сообщения</b> и <b>не остановило запись</b>. Затем нажмите «Уронить брокер 1».
        </p>
      </>,
      <>
        <p>
          Last time a broker went down, several payments vanished: the producer got an acknowledgment, but the data is
          not in Kafka. The CFO is not happy.
        </p>
        <p>
          Configure the producer and the topic so that losing one broker <b>loses no acknowledged
          messages</b> and <b>does not stop writes</b>. Then click "Kill broker 1".
        </p>
      </>,
    ),
    config: {
      brokers: 3,
      partitions: 3,
      replicationFactor: 3,
      minInsyncReplicas: 1,
      uncleanLeaderElection: true,
      producers: [{ rate: 40, keyStrategy: 'order', acks: 1 }],
      groups: [{ name: 'payments', consumers: 3, consumerRate: 20 }],
      replicaDelay: 0.6,
    },
    controls: { acks: true, reliability: true },
    trigger: { label: tr('💥 Уронить брокер 1', '💥 Kill broker 1'), run: (s) => s.killBroker(1) },
    goal: {
      text: tr('После падения брокера: 0 потерянных подтверждённых, все партиции доступны, запись без отказов 5 секунд', 'After the broker fails: 0 acknowledged messages lost, all partitions available, writes without rejections for 5 seconds'),
      holdSeconds: 5,
      afterTrigger: true,
      check: (s) => {
        const noRejects = noNewRejects(s)
        return s.lostAcked === 0 && s.offlinePartitions() === 0 && noRejects
      },
      status: (s) =>
        tr(`потеряно подтверждённых: ${s.lostAcked} · отказов записи: ${s.rejected} · офлайн: ${s.offlinePartitions()}`, `acknowledged lost: ${s.lostAcked} · write rejections: ${s.rejected} · offline: ${s.offlinePartitions()}`),
    },
    hints: [
      tr('acks=1 подтверждает запись, как только её сохранил лидер. Что будет, если он умрёт через миллисекунду?', 'acks=1 acknowledges a write as soon as the leader has stored it. What happens if the leader dies a millisecond later?'),
      tr('acks=all ждёт все реплики из ISR. А если в ISR остался только сам лидер?', 'acks=all waits for all replicas in the ISR. But what if only the leader itself is left in the ISR?'),
      tr('min.insync.replicas=3 при RF=3 означает, что любое падение остановит запись. Нужен баланс.', 'min.insync.replicas=3 with RF=3 means any failure stops writes. You need a balance.'),
    ],
    debrief: tr(
      <>
        <p>
          Рецепт: <b>RF=3, min.insync.replicas=2, acks=all</b>, unclean election выключен. Подтверждённое сообщение
          лежит минимум на двух брокерах, поэтому потеря одного ничего не стоит, а запись продолжается.
        </p>
        <p>
          При min.insync.replicas=3 любое падение останавливает запись. При min.insync.replicas=1 и acks=all ISR
          может сжаться до одного лидера, и вы вернётесь к риску acks=1.
        </p>
      </>,
      <>
        <p>
          The recipe: <b>RF=3, min.insync.replicas=2, acks=all</b>, unclean election disabled. An acknowledged message
          lives on at least two brokers, so losing one costs nothing, and writes continue.
        </p>
        <p>
          With min.insync.replicas=3 any failure stops writes. With min.insync.replicas=1 and acks=all the ISR
          can shrink to just the leader, and you are back to the risk of acks=1.
        </p>
      </>,
    ),
  },
]
