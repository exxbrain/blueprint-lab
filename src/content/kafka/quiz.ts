import { tr } from '../../i18n'
import type { QuizQuestion } from '../types'

export const kafkaQuiz: QuizQuestion[] = [
  {
    q: tr('В топике 4 партиции, в consumer group 6 консьюмеров. Сколько консьюмеров реально читают?', 'A topic has 4 partitions and the consumer group has 6 consumers. How many consumers actually read?'),
    options: ['6', '4', '2', tr('Зависит от ключей сообщений', 'Depends on the message keys')],
    correct: 1,
    explain:
      tr('Внутри группы партицию читает ровно один консьюмер. Партиций 4, значит работают 4 консьюмера, а 2 простаивают в резерве.', 'Within a group, each partition is read by exactly one consumer. With 4 partitions, 4 consumers work and 2 sit idle as standbys.'),
  },
  {
    q: tr('Нужно, чтобы события одного заказа обрабатывались строго по порядку. Что делать?', 'Events of a single order must be processed strictly in order. What should you do?'),
    options: [
      tr('Сделать топик с одной партицией', 'Create a topic with a single partition'),
      tr('Использовать orderId как ключ сообщения', 'Use orderId as the message key'),
      tr('Включить acks=all', 'Enable acks=all'),
      tr('Поставить один консьюмер в группе', 'Run a single consumer in the group'),
    ],
    correct: 1,
    explain:
      tr('Одинаковый ключ всегда попадает в одну партицию, а порядок Kafka гарантирует внутри партиции. Одна партиция или один консьюмер тоже сохранят порядок, но убьют масштабирование.', 'The same key always lands in the same partition, and Kafka guarantees order within a partition. A single partition or a single consumer would also preserve order, but would kill scalability.'),
  },
  {
    q: tr('Продюсер с acks=1 получил подтверждение, после чего брокер-лидер упал. Что с сообщением?', 'A producer with acks=1 received an acknowledgment, then the leader broker crashed. What happens to the message?'),
    options: [
      tr('Гарантированно сохранено', 'It is guaranteed to be stored'),
      tr('Может быть потеряно, если фолловеры не успели его скопировать', 'It may be lost if the followers had not copied it yet'),
      tr('Продюсер автоматически перешлёт его новому лидеру', 'The producer will automatically resend it to the new leader'),
      tr('Сообщение попадёт в dead letter queue', 'The message goes to the dead letter queue'),
    ],
    correct: 1,
    explain:
      tr('acks=1 означает, что записал лидер. Если новым лидером станет фолловер, который не успел скопировать сообщение, оно исчезнет, хотя продюсер считает его записанным.', 'acks=1 means only the leader has written it. If a follower that had not copied the message becomes the new leader, the message disappears, even though the producer considers it written.'),
  },
  {
    q: tr('RF=3, min.insync.replicas=2, acks=all. Упали 2 брокера из 3. Что произойдёт с записью?', 'RF=3, min.insync.replicas=2, acks=all. 2 of 3 brokers are down. What happens to writes?'),
    options: [
      tr('Запись продолжится на оставшийся брокер', 'Writes continue to the remaining broker'),
      tr('Продюсер получит ошибку NotEnoughReplicas', 'The producer gets a NotEnoughReplicas error'),
      tr('Kafka запишет данные и реплицирует позже', 'Kafka writes the data and replicates it later'),
      tr('Партиция станет read-only навсегда', 'The partition becomes read-only forever'),
    ],
    correct: 1,
    explain:
      tr('В ISR осталась одна реплика, а нужно минимум две. Kafka отказывает в записи: лучше явная ошибка, чем данные, которые могут пропасть.', 'Only one replica is left in the ISR, but at least two are required. Kafka rejects the write: an explicit error is better than data that may be lost.'),
  },
  {
    q: tr('Консьюмер обработал 50 сообщений и упал до коммита offset. Что увидит новый владелец партиции?', 'A consumer processed 50 messages and crashed before committing the offset. What will the new owner of the partition see?'),
    options: [
      tr('Продолжит с 51-го сообщения', 'It continues from message 51'),
      tr('Снова обработает эти 50 сообщений', 'It processes those 50 messages again'),
      tr('Пропустит их, они помечены как прочитанные', 'It skips them, they are marked as read'),
      tr('Партиция будет заблокирована до ручного вмешательства', 'The partition is locked until manual intervention'),
    ],
    correct: 1,
    explain:
      tr('Новый владелец начинает с последнего закоммиченного offset. Это at-least-once: обработчики должны быть идемпотентными.', 'The new owner starts from the last committed offset. This is at-least-once: handlers must be idempotent.'),
  },
  {
    q: tr('Зачем нужен паттерн Transactional Outbox?', 'What is the Transactional Outbox pattern for?'),
    options: [
      tr('Чтобы ускорить запись в Kafka', 'To speed up writes to Kafka'),
      tr('Чтобы атомарно сохранить изменение в БД и событие о нём', 'To atomically save a change in the database together with the event about it'),
      tr('Чтобы хранить сообщения, которые не удалось обработать', 'To store messages that failed to process'),
      tr('Чтобы шифровать сообщения', 'To encrypt messages'),
    ],
    correct: 1,
    explain:
      tr('БД и Kafka — разные системы без общей транзакции. Событие пишется в таблицу outbox в той же транзакции, что и бизнес-данные, а затем отдельно публикуется в Kafka.', 'The database and Kafka are separate systems with no shared transaction. The event is written to an outbox table in the same transaction as the business data, and then published to Kafka separately.'),
  },
  {
    q: tr('Что из этого сломает порядок событий для существующих ключей?', 'Which of these breaks event order for existing keys?'),
    options: [tr('Добавить консьюмера в группу', 'Adding a consumer to the group'), tr('Увеличить число партиций', 'Increasing the number of partitions'), tr('Увеличить retention', 'Increasing retention'), tr('Включить compaction', 'Enabling compaction')],
    correct: 1,
    explain:
      tr('Партиция выбирается как hash(key) % N. Если поменять N, ключ «переезжает», а старые события остаются в прежней партиции и могут быть обработаны позже новых.', 'The partition is chosen as hash(key) % N. If N changes, the key "moves", while old events stay in the previous partition and may be processed after newer ones.'),
  },
  {
    q: tr('Почему растущий лаг при стабильном трафике может быть связан с ребалансировкой?', 'Why can growing lag under steady traffic be caused by rebalancing?'),
    options: [
      tr('Во время ребалансировки (eager) вся группа перестаёт читать', 'During an (eager) rebalance the whole group stops reading'),
      tr('Ребалансировка удаляет сообщения', 'A rebalance deletes messages'),
      tr('При ребалансировке продюсер замедляется', 'The producer slows down during a rebalance'),
      tr('Ребалансировка уменьшает число партиций', 'A rebalance reduces the number of partitions'),
    ],
    correct: 0,
    explain:
      tr('В классическом протоколе группа останавливается на время перераспределения. Если консьюмеры постоянно вылетают, например обработка дольше max.poll.interval.ms, группа больше стоит, чем работает.', 'In the classic protocol the group stops while partitions are reassigned. If consumers keep dropping out, for example because processing takes longer than max.poll.interval.ms, the group spends more time stopped than working.'),
  },
  {
    q: tr('Что видит консьюмер: все сообщения на лидере или только до high watermark?', 'What does a consumer see: all messages on the leader, or only up to the high watermark?'),
    options: [tr('Все на лидере', 'Everything on the leader'), tr('Только до high watermark', 'Only up to the high watermark'), tr('Только закоммиченные своей группой', 'Only those committed by its group'), tr('Только из ISR-фолловеров', 'Only those from ISR followers')],
    correct: 1,
    explain:
      tr('Консьюмеры читают только сообщения, которые есть на всех ISR (ниже HW). Иначе можно прочитать сообщение, которое потом исчезнет при смене лидера.', 'Consumers only read messages present on all ISR replicas (below the HW). Otherwise they could read a message that later disappears on leader change.'),
  },
  {
    q: tr('Какой cleanup.policy подойдёт для топика «текущий профиль пользователя»?', 'Which cleanup.policy fits a "current user profile" topic?'),
    options: ['delete', 'compact', tr('Никакой, хранить всё вечно', 'None, keep everything forever'), 'retention.ms=0'],
    correct: 1,
    explain:
      tr('Compaction оставляет последнее значение по каждому ключу. Получается снимок состояния, который можно перечитать с начала и восстановить таблицу.', 'Compaction keeps the latest value for each key. The result is a state snapshot you can reread from the beginning to rebuild the table.'),
  },
  {
    q: tr('Две группы, billing и analytics, читают один топик. analytics сильно отстала. Как это влияет на billing?', 'Two groups, billing and analytics, read the same topic. analytics is far behind. How does that affect billing?'),
    options: [
      tr('billing тоже замедлится', 'billing slows down too'),
      tr('Никак: у каждой группы свои offsets', 'Not at all: each group has its own offsets'),
      tr('billing начнёт получать дубликаты', 'billing starts receiving duplicates'),
      tr('Kafka удалит сообщения, прочитанные billing', 'Kafka deletes the messages read by billing'),
    ],
    correct: 1,
    explain:
      tr('Группы полностью независимы. Сообщения не удаляются после чтения, и каждая группа хранит свою позицию.', 'Groups are fully independent. Messages are not deleted after being read, and each group keeps its own position.'),
  },
  {
    q: tr('Чем опасен unclean.leader.election.enable=true?', 'Why is unclean.leader.election.enable=true dangerous?'),
    options: [
      tr('Замедляет запись', 'It slows down writes'),
      tr('Лидером может стать отстающая реплика, и часть данных потеряется навсегда', 'A lagging replica can become leader, and some data is lost forever'),
      tr('Отключает репликацию', 'It disables replication'),
      tr('Ломает consumer groups', 'It breaks consumer groups'),
    ],
    correct: 1,
    explain:
      tr('Это компромисс в пользу доступности. Партиция быстрее оживает, но всё, чего не было у отстающей реплики, теряется.', 'It is a trade-off in favor of availability. The partition comes back faster, but anything the lagging replica did not have is lost.'),
  },
]
