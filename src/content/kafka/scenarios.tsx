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
  return `самый загруженный консьюмер: ${(max * 100).toFixed(0)}% мощности · лаг ${sim.totalLag(g)}`
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
    title: 'Лаг растёт',
    summary: 'Биллинг не справляется с потоком заказов',
    difficulty: 1,
    brief: (
      <>
        <p>
          Пятница, распродажа. Поток заказов вырос до 60 в секунду, а единственный экземпляр сервиса{' '}
          <b>billing</b> обрабатывает только 15. Лаг растёт, клиенты ждут подтверждения оплаты по полчаса.
        </p>
        <p>Код ускорить нельзя. Можно запускать дополнительные экземпляры сервиса.</p>
      </>
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
      text: 'Обработка успевает за записью 10 секунд подряд',
      holdSeconds: 10,
      check: keepsUp,
      status: (s) => `${rates(s)} · консьюмеров: ${s.groups[0].consumers.length}`,
    },
    hints: [
      '15 × 4 = 60. Почему четырёх может не хватить? Посмотрите, сколько партиций досталось каждому.',
      'Партиции распределяются целиком. При 6 партициях и 4 консьюмерах двоим достанется по 2 партиции, то есть по 20 сообщ./с.',
      'Нужно столько консьюмеров, сколько партиций. Седьмой будет простаивать.',
    ],
    debrief: (
      <>
        <p>
          Масштабирование консьюмеров упирается в <b>партиции</b>: единица распределения — партиция целиком. При
          неровном делении самый нагруженный консьюмер определяет лаг всей группы.
        </p>
        <p>
          Практика: число партиций берут кратным ожидаемому числу экземпляров (6, 12, 24) и с запасом на рост, а
          автоскейлинг консьюмеров (например, KEDA в Kubernetes) настраивают по метрике лага.
        </p>
      </>
    ),
  },
  {
    id: 'ceiling',
    title: 'Потолок параллелизма',
    summary: 'Экземпляров много, а лаг всё равно растёт',
    difficulty: 1,
    brief: (
      <>
        <p>
          Команда уже подняла 4 экземпляра <b>analytics</b>, но лаг продолжает расти. В мониторинге видно, что два
          экземпляра вообще ничего не делают.
        </p>
      </>
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
      text: 'Обработка успевает за записью 10 секунд подряд',
      holdSeconds: 10,
      check: keepsUp,
      status: (s) => `${rates(s)} · партиций: ${s.partitions.length}`,
    },
    hints: [
      'Почему два консьюмера простаивают? Сколько партиций в топике?',
      'В группе один консьюмер на партицию. Добавлять консьюмеров бесполезно: нужно больше партиций.',
    ],
    debrief: (
      <>
        <p>
          Число партиций — <b>верхняя граница параллелизма</b> одной группы. Лишние консьюмеры работают только как
          горячий резерв.
        </p>
        <p>
          Обратите внимание на журнал: после добавления партиций ключи начали попадать в другие партиции. На проде
          это временно ломает порядок, поэтому партиции закладывают заранее, а не добавляют во время инцидента.
        </p>
      </>
    ),
  },
  {
    id: 'ordering',
    title: 'Оплачен раньше, чем создан',
    summary: 'Склад получает события заказа вперемешку',
    difficulty: 2,
    brief: (
      <>
        <p>
          Сервис <b>shipping</b> регулярно получает «заказ оплачен» раньше, чем «заказ создан», и падает с ошибкой
          «заказ не найден». Иногда он отправляет посылку до оплаты.
        </p>
        <p>Масштаб менять нельзя. Найдите причину в настройках продюсера.</p>
      </>
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
      text: '10 секунд без новых нарушений порядка',
      holdSeconds: 10,
      check: noNewViolations,
      status: (s) => `нарушений всего: ${s.groups[0].violations} · ключ: ${s.producers[0].keyStrategy}`,
    },
    hints: [
      'Посмотрите на цвета: где лежат события одного заказа?',
      'Порядок гарантируется только внутри партиции. Как сделать, чтобы все события заказа попадали в одну партицию?',
    ],
    debrief: (
      <>
        <p>
          Без ключа события одного заказа разлетаются по партициям, и их обрабатывают разные консьюмеры с разным
          лагом. С ключом <code>orderId</code> все события заказа идут в одну партицию к одному консьюмеру по
          порядку.
        </p>
        <p>
          Ключ «клиент» тоже сохраняет порядок, но создаёт горячие партиции. Об этом следующая задача.
        </p>
      </>
    ),
  },
  {
    id: 'hot-partition',
    title: 'Горячая партиция',
    summary: 'Одна партиция перегружена, остальные скучают',
    difficulty: 2,
    brief: (
      <>
        <p>
          Сообщения партиционируются по клиенту. 70% заказов приходит от одного крупного клиента{' '}
          <code>big-corp</code>. Лаг одной партиции огромный, у остальных ноль. Добавление консьюмеров и партиций не
          помогает.
        </p>
        <p>
          Бизнес-требование: порядок важен в пределах <b>заказа</b>, а не клиента.
        </p>
      </>
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
      text: 'Обработка успевает за записью 10 секунд подряд, порядок заказов не нарушается',
      holdSeconds: 10,
      check: (s) => keepsUp(s) && s.producers[0].keyStrategy !== 'none',
      status: (s) => `${rates(s)} · макс. лаг партиции: ${s.maxPartitionLag(s.groups[0])}`,
    },
    hints: [
      'Почему новые партиции не помогают? Куда попадает ключ big-corp после добавления партиции?',
      'Ключ должен быть настолько мелким, насколько позволяет требование к порядку.',
    ],
    debrief: (
      <>
        <p>
          Ключ задаёт и порядок, и <b>распределение нагрузки</b>. Крупный ключ (клиент, страна, тип события) даёт
          перекос: один ключ — одна партиция — один консьюмер, и горизонтально это не масштабируется.
        </p>
        <p>
          Выбирайте самый мелкий ключ, для которого важен порядок. Если порядок нужен для огромной сущности,
          используют составной ключ (salting) и сборку порядка на стороне получателя.
        </p>
      </>
    ),
  },
  {
    id: 'broker-crash',
    title: 'Ночное падение брокера',
    summary: 'Настройте надёжность до аварии',
    difficulty: 3,
    brief: (
      <>
        <p>
          В прошлый раз при падении брокера пропало несколько оплат: продюсер получил подтверждение, а данных в Kafka
          нет. Финдиректор недоволен.
        </p>
        <p>
          Настройте продюсер и топик так, чтобы падение одного брокера <b>не потеряло ни одного подтверждённого
          сообщения</b> и <b>не остановило запись</b>. Затем нажмите «Уронить брокер 1».
        </p>
      </>
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
    trigger: { label: '💥 Уронить брокер 1', run: (s) => s.killBroker(1) },
    goal: {
      text: 'После падения брокера: 0 потерянных подтверждённых, все партиции доступны, запись без отказов 5 секунд',
      holdSeconds: 5,
      afterTrigger: true,
      check: (s) => {
        const noRejects = noNewRejects(s)
        return s.lostAcked === 0 && s.offlinePartitions() === 0 && noRejects
      },
      status: (s) =>
        `потеряно подтверждённых: ${s.lostAcked} · отказов записи: ${s.rejected} · офлайн: ${s.offlinePartitions()}`,
    },
    hints: [
      'acks=1 подтверждает запись, как только её сохранил лидер. Что будет, если он умрёт через миллисекунду?',
      'acks=all ждёт все реплики из ISR. А если в ISR остался только сам лидер?',
      'min.insync.replicas=3 при RF=3 означает, что любое падение остановит запись. Нужен баланс.',
    ],
    debrief: (
      <>
        <p>
          Рецепт: <b>RF=3, min.insync.replicas=2, acks=all</b>, unclean election выключен. Подтверждённое сообщение
          лежит минимум на двух брокерах, поэтому потеря одного ничего не стоит, а запись продолжается.
        </p>
        <p>
          При min.insync.replicas=3 любое падение останавливает запись. При min.insync.replicas=1 и acks=all ISR
          может сжаться до одного лидера, и вы вернётесь к риску acks=1.
        </p>
      </>
    ),
  },
]
