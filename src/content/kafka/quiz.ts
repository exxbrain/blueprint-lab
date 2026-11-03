import { tr } from '../../i18n'
import type { QuizQuestion } from '../types'

export const kafkaQuiz: QuizQuestion[] = [
  {
    q: tr('В топике 4 партиции, в consumer group 6 консьюмеров. Сколько консьюмеров реально читают?', 'A topic has 4 partitions and the consumer group has 6 consumers. How many consumers actually read?', '一个 topic 有 4 个分区，消费者组里有 6 个消费者。实际上有几个消费者在读取？'),
    options: ['6', '4', '2', tr('Зависит от ключей сообщений', 'Depends on the message keys', '取决于消息的 key')],
    correct: 1,
    explain:
      tr('Внутри группы партицию читает ровно один консьюмер. Партиций 4, значит работают 4 консьюмера, а 2 простаивают в резерве.', 'Within a group, each partition is read by exactly one consumer. With 4 partitions, 4 consumers work and 2 sit idle as standbys.', '在同一个组内，每个分区只由一个消费者读取。有 4 个分区，就有 4 个消费者在工作，另外 2 个作为备用闲置。'),
  },
  {
    q: tr('Нужно, чтобы события одного заказа обрабатывались строго по порядку. Что делать?', 'Events of a single order must be processed strictly in order. What should you do?', '同一个订单的事件必须严格按顺序处理。应该怎么做？'),
    options: [
      tr('Сделать топик с одной партицией', 'Create a topic with a single partition', '创建只有一个分区的 topic'),
      tr('Использовать orderId как ключ сообщения', 'Use orderId as the message key', '用 orderId 作为消息的 key'),
      tr('Включить acks=all', 'Enable acks=all', '开启 acks=all'),
      tr('Поставить один консьюмер в группе', 'Run a single consumer in the group', '组里只运行一个消费者'),
    ],
    correct: 1,
    explain:
      tr('Одинаковый ключ всегда попадает в одну партицию, а порядок Kafka гарантирует внутри партиции. Одна партиция или один консьюмер тоже сохранят порядок, но убьют масштабирование.', 'The same key always lands in the same partition, and Kafka guarantees order within a partition. A single partition or a single consumer would also preserve order, but would kill scalability.', '相同的 key 总是落到同一个分区，而 Kafka 保证分区内的顺序。只用一个分区或一个消费者也能保住顺序，但会彻底断送扩展能力。'),
  },
  {
    q: tr('Продюсер с acks=1 получил подтверждение, после чего брокер-лидер упал. Что с сообщением?', 'A producer with acks=1 received an acknowledgment, then the leader broker crashed. What happens to the message?', 'acks=1 的生产者收到了确认，随后领导者 Broker 宕机了。这条消息会怎样？'),
    options: [
      tr('Гарантированно сохранено', 'It is guaranteed to be stored', '一定已经保存'),
      tr('Может быть потеряно, если фолловеры не успели его скопировать', 'It may be lost if the followers had not copied it yet', '如果追随者副本还没来得及复制，它可能会丢失'),
      tr('Продюсер автоматически перешлёт его новому лидеру', 'The producer will automatically resend it to the new leader', '生产者会自动把它重发给新的领导者'),
      tr('Сообщение попадёт в dead letter queue', 'The message goes to the dead letter queue', '消息会进入死信队列（dead letter queue）'),
    ],
    correct: 1,
    explain:
      tr('acks=1 означает, что записал лидер. Если новым лидером станет фолловер, который не успел скопировать сообщение, оно исчезнет, хотя продюсер считает его записанным.', 'acks=1 means only the leader has written it. If a follower that had not copied the message becomes the new leader, the message disappears, even though the producer considers it written.', 'acks=1 表示只有领导者写入了它。如果一个还没复制到这条消息的追随者成为新的领导者，消息就会消失，尽管生产者认为它已经写入。'),
  },
  {
    q: tr('RF=3, min.insync.replicas=2, acks=all. Упали 2 брокера из 3. Что произойдёт с записью?', 'RF=3, min.insync.replicas=2, acks=all. 2 of 3 brokers are down. What happens to writes?', 'RF=3，min.insync.replicas=2，acks=all。3 个 Broker 中有 2 个宕机了。写入会怎样？'),
    options: [
      tr('Запись продолжится на оставшийся брокер', 'Writes continue to the remaining broker', '继续写入剩下的那个 Broker'),
      tr('Продюсер получит ошибку NotEnoughReplicas', 'The producer gets a NotEnoughReplicas error', '生产者收到 NotEnoughReplicas 错误'),
      tr('Kafka запишет данные и реплицирует позже', 'Kafka writes the data and replicates it later', 'Kafka 先写入数据，稍后再复制'),
      tr('Партиция станет read-only навсегда', 'The partition becomes read-only forever', '该分区永久变为只读'),
    ],
    correct: 1,
    explain:
      tr('В ISR осталась одна реплика, а нужно минимум две. Kafka отказывает в записи: лучше явная ошибка, чем данные, которые могут пропасть.', 'Only one replica is left in the ISR, but at least two are required. Kafka rejects the write: an explicit error is better than data that may be lost.', 'ISR 中只剩一个副本，而至少需要两个。Kafka 拒绝写入：明确的报错总好过可能丢失的数据。'),
  },
  {
    q: tr('Консьюмер обработал 50 сообщений и упал до коммита offset. Что увидит новый владелец партиции?', 'A consumer processed 50 messages and crashed before committing the offset. What will the new owner of the partition see?', '一个消费者处理了 50 条消息，在提交 offset 之前崩溃了。该分区的新所有者会看到什么？'),
    options: [
      tr('Продолжит с 51-го сообщения', 'It continues from message 51', '从第 51 条消息继续'),
      tr('Снова обработает эти 50 сообщений', 'It processes those 50 messages again', '再次处理这 50 条消息'),
      tr('Пропустит их, они помечены как прочитанные', 'It skips them, they are marked as read', '跳过它们，因为它们已被标记为已读'),
      tr('Партиция будет заблокирована до ручного вмешательства', 'The partition is locked until manual intervention', '分区被锁定，直到人工介入'),
    ],
    correct: 1,
    explain:
      tr('Новый владелец начинает с последнего закоммиченного offset. Это at-least-once: обработчики должны быть идемпотентными.', 'The new owner starts from the last committed offset. This is at-least-once: handlers must be idempotent.', '新所有者从最后一次提交的 offset 开始。这就是 at-least-once（至少一次）：处理逻辑必须是幂等的。'),
  },
  {
    q: tr('Зачем нужен паттерн Transactional Outbox?', 'What is the Transactional Outbox pattern for?', 'Transactional Outbox 模式是用来做什么的？'),
    options: [
      tr('Чтобы ускорить запись в Kafka', 'To speed up writes to Kafka', '加快写入 Kafka 的速度'),
      tr('Чтобы атомарно сохранить изменение в БД и событие о нём', 'To atomically save a change in the database together with the event about it', '把数据库中的变更和描述该变更的事件原子地一起保存'),
      tr('Чтобы хранить сообщения, которые не удалось обработать', 'To store messages that failed to process', '保存处理失败的消息'),
      tr('Чтобы шифровать сообщения', 'To encrypt messages', '加密消息'),
    ],
    correct: 1,
    explain:
      tr('БД и Kafka — разные системы без общей транзакции. Событие пишется в таблицу outbox в той же транзакции, что и бизнес-данные, а затем отдельно публикуется в Kafka.', 'The database and Kafka are separate systems with no shared transaction. The event is written to an outbox table in the same transaction as the business data, and then published to Kafka separately.', '数据库和 Kafka 是两个独立的系统，没有共享事务。事件与业务数据在同一个事务中写入 outbox 表，然后再单独发布到 Kafka。'),
  },
  {
    q: tr('Что из этого сломает порядок событий для существующих ключей?', 'Which of these breaks event order for existing keys?', '以下哪项会打乱已有 key 的事件顺序？'),
    options: [tr('Добавить консьюмера в группу', 'Adding a consumer to the group', '向组里添加一个消费者'), tr('Увеличить число партиций', 'Increasing the number of partitions', '增加分区数量'), tr('Увеличить retention', 'Increasing retention', '延长 retention'), tr('Включить compaction', 'Enabling compaction', '开启 compaction')],
    correct: 1,
    explain:
      tr('Партиция выбирается как hash(key) % N. Если поменять N, ключ «переезжает», а старые события остаются в прежней партиции и могут быть обработаны позже новых.', 'The partition is chosen as hash(key) % N. If N changes, the key "moves", while old events stay in the previous partition and may be processed after newer ones.', '分区按 hash(key) % N 选择。如果 N 变了，key 就会“搬家”，而旧事件仍留在原来的分区，可能比新事件更晚被处理。'),
  },
  {
    q: tr('Почему растущий лаг при стабильном трафике может быть связан с ребалансировкой?', 'Why can growing lag under steady traffic be caused by rebalancing?', '为什么流量稳定时 lag 不断增长，可能与再均衡（rebalance）有关？'),
    options: [
      tr('Во время ребалансировки (eager) вся группа перестаёт читать', 'During an (eager) rebalance the whole group stops reading', '在（eager）再均衡期间，整个组都会停止读取'),
      tr('Ребалансировка удаляет сообщения', 'A rebalance deletes messages', '再均衡会删除消息'),
      tr('При ребалансировке продюсер замедляется', 'The producer slows down during a rebalance', '再均衡期间生产者会变慢'),
      tr('Ребалансировка уменьшает число партиций', 'A rebalance reduces the number of partitions', '再均衡会减少分区数量'),
    ],
    correct: 0,
    explain:
      tr('В классическом протоколе группа останавливается на время перераспределения. Если консьюмеры постоянно вылетают, например обработка дольше max.poll.interval.ms, группа больше стоит, чем работает.', 'In the classic protocol the group stops while partitions are reassigned. If consumers keep dropping out, for example because processing takes longer than max.poll.interval.ms, the group spends more time stopped than working.', '在经典协议中，重新分配分区期间整个组会停下来。如果消费者频繁掉线，比如处理时间超过了 max.poll.interval.ms，这个组停摆的时间就会比工作的时间还长。'),
  },
  {
    q: tr('Что видит консьюмер: все сообщения на лидере или только до high watermark?', 'What does a consumer see: all messages on the leader, or only up to the high watermark?', '消费者能看到什么：领导者上的所有消息，还是只到 high watermark 为止？'),
    options: [tr('Все на лидере', 'Everything on the leader', '领导者上的全部消息'), tr('Только до high watermark', 'Only up to the high watermark', '只到 high watermark 为止'), tr('Только закоммиченные своей группой', 'Only those committed by its group', '只有本组已提交的消息'), tr('Только из ISR-фолловеров', 'Only those from ISR followers', '只有来自 ISR 追随者的消息')],
    correct: 1,
    explain:
      tr('Консьюмеры читают только сообщения, которые есть на всех ISR (ниже HW). Иначе можно прочитать сообщение, которое потом исчезнет при смене лидера.', 'Consumers only read messages present on all ISR replicas (below the HW). Otherwise they could read a message that later disappears on leader change.', '消费者只读取所有 ISR 副本上都已存在的消息（HW 以下）。否则就可能读到一条在领导者切换后消失的消息。'),
  },
  {
    q: tr('Какой cleanup.policy подойдёт для топика «текущий профиль пользователя»?', 'Which cleanup.policy fits a "current user profile" topic?', '哪种 cleanup.policy 适合“当前用户资料”这个 topic？'),
    options: ['delete', 'compact', tr('Никакой, хранить всё вечно', 'None, keep everything forever', '都不用，永久保存所有数据'), 'retention.ms=0'],
    correct: 1,
    explain:
      tr('Compaction оставляет последнее значение по каждому ключу. Получается снимок состояния, который можно перечитать с начала и восстановить таблицу.', 'Compaction keeps the latest value for each key. The result is a state snapshot you can reread from the beginning to rebuild the table.', 'Compaction 会为每个 key 保留最新的值。结果就是一份状态快照：从头重读一遍即可重建整张表。'),
  },
  {
    q: tr('Две группы, billing и analytics, читают один топик. analytics сильно отстала. Как это влияет на billing?', 'Two groups, billing and analytics, read the same topic. analytics is far behind. How does that affect billing?', 'billing 和 analytics 两个组读取同一个 topic。analytics 落后很多。这对 billing 有什么影响？'),
    options: [
      tr('billing тоже замедлится', 'billing slows down too', 'billing 也会变慢'),
      tr('Никак: у каждой группы свои offsets', 'Not at all: each group has its own offsets', '没有影响：每个组都有自己的 offset'),
      tr('billing начнёт получать дубликаты', 'billing starts receiving duplicates', 'billing 开始收到重复消息'),
      tr('Kafka удалит сообщения, прочитанные billing', 'Kafka deletes the messages read by billing', 'Kafka 会删除 billing 已读的消息'),
    ],
    correct: 1,
    explain:
      tr('Группы полностью независимы. Сообщения не удаляются после чтения, и каждая группа хранит свою позицию.', 'Groups are fully independent. Messages are not deleted after being read, and each group keeps its own position.', '各个组完全独立。消息被读取后不会删除，每个组各自记录自己的位置。'),
  },
  {
    q: tr('Чем опасен unclean.leader.election.enable=true?', 'Why is unclean.leader.election.enable=true dangerous?', 'unclean.leader.election.enable=true 有什么危险？'),
    options: [
      tr('Замедляет запись', 'It slows down writes', '会拖慢写入'),
      tr('Лидером может стать отстающая реплика, и часть данных потеряется навсегда', 'A lagging replica can become leader, and some data is lost forever', '落后的副本可能成为领导者，部分数据会永久丢失'),
      tr('Отключает репликацию', 'It disables replication', '会关闭复制'),
      tr('Ломает consumer groups', 'It breaks consumer groups', '会破坏消费者组'),
    ],
    correct: 1,
    explain:
      tr('Это компромисс в пользу доступности. Партиция быстрее оживает, но всё, чего не было у отстающей реплики, теряется.', 'It is a trade-off in favor of availability. The partition comes back faster, but anything the lagging replica did not have is lost.', '这是偏向可用性的权衡。分区能更快恢复，但落后副本上没有的数据都会丢失。'),
  },
]
