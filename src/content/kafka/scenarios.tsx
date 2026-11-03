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
  return tr(`самый загруженный консьюмер: ${(max * 100).toFixed(0)}% мощности · лаг ${sim.totalLag(g)}`, `busiest consumer: ${(max * 100).toFixed(0)}% of capacity · lag ${sim.totalLag(g)}`, `最忙的消费者：已用 ${(max * 100).toFixed(0)}% 处理能力 · 积压 ${sim.totalLag(g)}`)
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
    title: tr('Лаг растёт', 'Lag is growing', '积压不断增长'),
    summary: tr('Биллинг не справляется с потоком заказов', 'Billing cannot keep up with the order stream', 'billing 跟不上订单流'),
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
      <>
        <p>
          周五，大促。订单流涨到了每秒 60 条，而 <b>billing</b> 服务唯一的实例每秒只能处理 15 条。积压（lag）不断增长，客户要等半个小时才能收到支付确认。
        </p>
        <p>代码没法再提速。你可以启动更多的服务实例。</p>
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
      text: tr('Обработка успевает за записью 10 секунд подряд', 'Processing keeps up with writes for 10 seconds straight', '处理速度连续 10 秒跟上写入速度'),
      holdSeconds: 10,
      check: keepsUp,
      status: (s) => tr(`${rates(s)} · консьюмеров: ${s.groups[0].consumers.length}`, `${rates(s)} · consumers: ${s.groups[0].consumers.length}`, `${rates(s)} · 消费者：${s.groups[0].consumers.length}`),
    },
    hints: [
      tr('15 × 4 = 60. Почему четырёх может не хватить? Посмотрите, сколько партиций досталось каждому.', '15 × 4 = 60. Why might four not be enough? Look at how many partitions each one got.', '15 × 4 = 60。为什么四个可能还不够？看看每个消费者分到了几个分区。'),
      tr('Партиции распределяются целиком. При 6 партициях и 4 консьюмерах двоим достанется по 2 партиции, то есть по 20 сообщ./с.', 'Partitions are assigned whole. With 6 partitions and 4 consumers, two of them get 2 partitions each, i.e. 20 msg/s.', '分区是整个分配的。6 个分区、4 个消费者时，其中两个各分到 2 个分区，也就是 20 msg/s。'),
      tr('Нужно столько консьюмеров, сколько партиций. Седьмой будет простаивать.', 'You need as many consumers as partitions. A seventh one would sit idle.', '消费者数量要和分区数一样多。第七个会闲着。'),
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
      <>
        <p>
          消费者的扩展受限于<b>分区</b>：分配的单位是整个分区。分得不均匀时，负载最重的那个消费者决定了整个组的积压。
        </p>
        <p>
          实践做法：分区数取预期实例数的倍数（6、12、24），并为增长留出余量；消费者的自动扩缩容（例如 Kubernetes 中的
          KEDA）按积压指标来配置。
        </p>
      </>,
    ),
  },
  {
    id: 'ceiling',
    title: tr('Потолок параллелизма', 'The parallelism ceiling', '并行度的上限'),
    summary: tr('Экземпляров много, а лаг всё равно растёт', 'Plenty of instances, yet lag keeps growing', '实例很多，积压却还在增长'),
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
      <>
        <p>
          团队已经启动了 4 个 <b>analytics</b> 实例，但积压还在增长。监控显示，其中两个实例完全没在干活。
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
      text: tr('Обработка успевает за записью 10 секунд подряд', 'Processing keeps up with writes for 10 seconds straight', '处理速度连续 10 秒跟上写入速度'),
      holdSeconds: 10,
      check: keepsUp,
      status: (s) => tr(`${rates(s)} · партиций: ${s.partitions.length}`, `${rates(s)} · partitions: ${s.partitions.length}`, `${rates(s)} · 分区：${s.partitions.length}`),
    },
    hints: [
      tr('Почему два консьюмера простаивают? Сколько партиций в топике?', 'Why are two consumers idle? How many partitions does the topic have?', '为什么有两个消费者闲着？这个 Topic 有几个分区？'),
      tr('В группе один консьюмер на партицию. Добавлять консьюмеров бесполезно: нужно больше партиций.', 'A group has one consumer per partition. Adding consumers is pointless: you need more partitions.', '在一个组里，每个分区只对应一个消费者。增加消费者没有用：需要更多分区。'),
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
      <>
        <p>
          分区数是单个组<b>并行度的上限</b>。多出来的消费者只能充当热备。
        </p>
        <p>
          注意看事件日志：添加分区后，键开始落到别的分区里。在生产环境中这会暂时打乱顺序，所以分区要提前规划好，而不是在事故中临时添加。
        </p>
      </>,
    ),
  },
  {
    id: 'ordering',
    title: tr('Оплачен раньше, чем создан', 'Paid before created', '还没创建就已付款'),
    summary: tr('Склад получает события заказа вперемешку', 'The warehouse receives order events out of order', '仓库收到的订单事件顺序错乱'),
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
      <>
        <p>
          <b>shipping</b> 服务经常先收到“订单已支付”，后收到“订单已创建”，于是报出“订单不存在”的错误而失败。有时它甚至在付款之前就把包裹发出去了。
        </p>
        <p>不能调整规模。请在生产者的设置中找出原因。</p>
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
      text: tr('10 секунд без новых нарушений порядка', '10 seconds without new order violations', '连续 10 秒没有新的顺序错乱'),
      holdSeconds: 10,
      check: noNewViolations,
      status: (s) => tr(`нарушений всего: ${s.groups[0].violations} · ключ: ${s.producers[0].keyStrategy}`, `total violations: ${s.groups[0].violations} · key: ${s.producers[0].keyStrategy}`, `顺序错乱总数：${s.groups[0].violations} · 键：${s.producers[0].keyStrategy}`),
    },
    hints: [
      tr('Посмотрите на цвета: где лежат события одного заказа?', 'Look at the colors: where do the events of a single order end up?', '看看颜色：同一个订单的事件都落到了哪里？'),
      tr('Порядок гарантируется только внутри партиции. Как сделать, чтобы все события заказа попадали в одну партицию?', 'Order is guaranteed only within a partition. How do you make all events of an order land in the same partition?', '只有在同一个分区内才保证顺序。怎样让一个订单的所有事件都落到同一个分区？'),
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
      <>
        <p>
          没有键时，同一个订单的事件会分散到各个分区，由积压各不相同的不同消费者处理。以 <code>orderId</code> 为键时，一个订单的所有事件都按顺序进入同一个分区，交给同一个消费者。
        </p>
        <p>
          以“客户”为键也能保证顺序，但会产生热点分区。这正是下一个任务要讲的。
        </p>
      </>,
    ),
  },
  {
    id: 'hot-partition',
    title: tr('Горячая партиция', 'Hot partition', '热点分区'),
    summary: tr('Одна партиция перегружена, остальные скучают', 'One partition is overloaded, the rest are idle', '一个分区过载，其余分区闲着'),
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
      <>
        <p>
          消息按客户分区。70% 的订单来自同一个大客户 <code>big-corp</code>。一个分区的积压巨大，其余分区为零。增加消费者和分区都无济于事。
        </p>
        <p>
          业务要求：顺序只需要在同一个<b>订单</b>内保证，而不是在同一个客户内。
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
      text: tr('Обработка успевает за записью 10 секунд подряд, порядок заказов не нарушается', 'Processing keeps up with writes for 10 seconds straight, without breaking order', '处理速度连续 10 秒跟上写入速度，且不打乱顺序'),
      holdSeconds: 10,
      check: (s) => keepsUp(s) && s.producers[0].keyStrategy !== 'none',
      status: (s) => tr(`${rates(s)} · макс. лаг партиции: ${s.maxPartitionLag(s.groups[0])}`, `${rates(s)} · max partition lag: ${s.maxPartitionLag(s.groups[0])}`, `${rates(s)} · 单个分区最大积压：${s.maxPartitionLag(s.groups[0])}`),
    },
    hints: [
      tr('Почему новые партиции не помогают? Куда попадает ключ big-corp после добавления партиции?', 'Why do new partitions not help? Where does the big-corp key go after a partition is added?', '为什么新分区帮不上忙？添加分区后，big-corp 这个键去了哪里？'),
      tr('Ключ должен быть настолько мелким, насколько позволяет требование к порядку.', 'The key should be as fine-grained as the ordering requirement allows.', '在顺序要求允许的范围内，键越细越好。'),
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
      <>
        <p>
          键同时决定了顺序和<b>负载分布</b>。粒度粗的键（客户、国家、事件类型）会造成倾斜：一个键对应一个分区、一个消费者，这无法水平扩展。
        </p>
        <p>
          选择需要保证顺序的最细粒度的键。如果需要对一个巨大的实体保证顺序，就使用复合键（salting），并在消费端重新恢复顺序。
        </p>
      </>,
    ),
  },
  {
    id: 'broker-crash',
    title: tr('Ночное падение брокера', 'Broker crash at night', '深夜 Broker 宕机'),
    summary: tr('Настройте надёжность до аварии', 'Set up reliability before the failure', '在故障发生前配置好可靠性'),
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
      <>
        <p>
          上次一个 Broker 宕机时，丢了好几笔支付：生产者收到了确认，但 Kafka 里并没有这些数据。财务总监很不满意。
        </p>
        <p>
          请配置生产者和 Topic，使得一个 Broker 宕机时<b>不丢失任何已确认的消息</b>，并且<b>写入不中断</b>。然后点击“让 Broker 1 宕机”。
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
    trigger: { label: tr('💥 Уронить брокер 1', '💥 Kill broker 1', '💥 让 Broker 1 宕机'), run: (s) => s.killBroker(1) },
    goal: {
      text: tr('После падения брокера: 0 потерянных подтверждённых, все партиции доступны, запись без отказов 5 секунд', 'After the broker fails: 0 acknowledged messages lost, all partitions available, writes without rejections for 5 seconds', 'Broker 宕机后：已确认消息丢失 0 条，所有分区可用，写入连续 5 秒没有被拒绝'),
      holdSeconds: 5,
      afterTrigger: true,
      check: (s) => {
        const noRejects = noNewRejects(s)
        return s.lostAcked === 0 && s.offlinePartitions() === 0 && noRejects
      },
      status: (s) =>
        tr(`потеряно подтверждённых: ${s.lostAcked} · отказов записи: ${s.rejected} · офлайн: ${s.offlinePartitions()}`, `acknowledged lost: ${s.lostAcked} · write rejections: ${s.rejected} · offline: ${s.offlinePartitions()}`, `已确认但丢失：${s.lostAcked} · 写入被拒：${s.rejected} · 离线：${s.offlinePartitions()}`),
    },
    hints: [
      tr('acks=1 подтверждает запись, как только её сохранил лидер. Что будет, если он умрёт через миллисекунду?', 'acks=1 acknowledges a write as soon as the leader has stored it. What happens if the leader dies a millisecond later?', 'acks=1 在领导者保存写入后就立即确认。如果领导者一毫秒后就挂了，会怎样？'),
      tr('acks=all ждёт все реплики из ISR. А если в ISR остался только сам лидер?', 'acks=all waits for all replicas in the ISR. But what if only the leader itself is left in the ISR?', 'acks=all 会等待 ISR 中的所有副本。可如果 ISR 里只剩下领导者自己呢？'),
      tr('min.insync.replicas=3 при RF=3 означает, что любое падение остановит запись. Нужен баланс.', 'min.insync.replicas=3 with RF=3 means any failure stops writes. You need a balance.', 'RF=3 时设置 min.insync.replicas=3，意味着任何一次故障都会让写入停止。需要找到平衡。'),
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
      <>
        <p>
          配方：<b>RF=3, min.insync.replicas=2, acks=all</b>，并关闭 unclean election。已确认的消息至少存放在两个
          Broker 上，所以丢掉一个 Broker 毫无损失，写入也会继续。
        </p>
        <p>
          min.insync.replicas=3 时，任何一次故障都会让写入停止。min.insync.replicas=1 且 acks=all 时，ISR
          可能缩小到只剩领导者一个，你又回到了 acks=1 的风险。
        </p>
      </>,
    ),
  },
]
