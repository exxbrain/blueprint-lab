import type { QuizQuestion } from '../types'
import { tr } from '../../i18n'

export const k8sQuiz: QuizQuestion[] = [
  {
    q: tr('Под Java-сервиса постоянно перезапускается со статусом OOMKilled. Что это значит?', 'A Java service pod keeps restarting with status OOMKilled. What does that mean?', 'Java 服务的 Pod 不断重启，状态为 OOMKilled。这说明什么？'),
    options: [
      tr('На ноде кончился диск', 'The node ran out of disk', 'Node 的磁盘满了'),
      tr('Процесс превысил лимит памяти, и ядро его убило', 'The process exceeded its memory limit and the kernel killed it', '进程超出了内存限制（limit），被内核杀掉了'),
      tr('Не прошла readiness-проба', 'The readiness probe failed', 'readiness probe（就绪探针）没有通过'),
      tr('Планировщик не нашёл ноду', 'The scheduler found no node', '调度器找不到合适的 Node'),
    ],
    correct: 1,
    explain: tr('Память нельзя «притормозить», как CPU: вышел за limits.memory — процесс убит. Лимит должен покрывать реальное потребление с запасом.', 'Memory cannot be throttled like CPU: go above limits.memory and the process is killed. The limit must cover real usage plus headroom.', '内存不能像 CPU 那样被“限速”：一旦超过 limits.memory，进程就会被杀掉。limit 必须覆盖实际用量，并留出余量。'),
  },
  {
    q: tr('Чем readiness-проба отличается от liveness?', 'How does a readiness probe differ from a liveness probe?', 'readiness probe（就绪探针）和 liveness probe（存活探针）有什么区别？'),
    options: [
      tr('Ничем, это синонимы', 'No difference, they are synonyms', '没有区别，它们是同义词'),
      tr('Readiness перезапускает контейнер, liveness убирает из балансировки', 'Readiness restarts the container, liveness removes it from load balancing', 'Readiness 会重启容器，liveness 会把它从负载均衡中移除'),
      tr('Readiness убирает под из балансировки, liveness перезапускает контейнер', 'Readiness removes the pod from load balancing, liveness restarts the container', 'Readiness 会把 Pod 从负载均衡中移除，liveness 会重启容器'),
      tr('Readiness проверяет ноду, liveness — под', 'Readiness checks the node, liveness checks the pod', 'Readiness 检查 Node，liveness 检查 Pod'),
    ],
    correct: 2,
    explain: tr('Readiness решает, получает ли под трафик; liveness — жив ли процесс и не пора ли его перезапустить.', 'Readiness decides whether the pod gets traffic; liveness decides whether the process is alive or should be restarted.', 'Readiness 决定 Pod 是否接收流量；liveness 判断进程是否还活着、是否该重启。'),
  },
  {
    q: tr('Поды висят в Pending с «Insufficient cpu», хотя ноды загружены на 30%. Почему?', 'Pods are stuck Pending with “Insufficient cpu”, though nodes are at 30% load. Why?', 'Pod 卡在 Pending 状态，提示“Insufficient cpu”，可 Node 的负载只有 30%。为什么？'),
    options: [
      tr('Планировщик смотрит на requests, а не на реальную загрузку', 'The scheduler looks at requests, not real usage', '调度器看的是 requests，而不是实际用量'),
      tr('Не хватает памяти', 'There is not enough memory', '内存不够'),
      tr('Мешает HPA', 'The HPA is in the way', 'HPA 在捣乱'),
      tr('Нет readiness-пробы', 'There is no readiness probe', '没有配置 readiness probe'),
    ],
    correct: 0,
    explain: tr('Если сумма requests на ноде исчерпана, новый под туда не встанет, даже если процессор фактически простаивает. Завышенные requests — частая причина Pending.', 'If the sum of requests on a node is used up, a new pod will not fit there even if the CPU is actually idle. Inflated requests are a common cause of Pending.', '如果某个 Node 上的 requests 总和已经用完，即使 CPU 实际上很空闲，新的 Pod 也放不上去。requests 设得过高是 Pending 的常见原因。'),
  },
  {
    q: tr('Запас мощности нулевой. Какие maxSurge / maxUnavailable выбрать для релиза без простоя?', 'There is no spare capacity. Which maxSurge / maxUnavailable gives a zero-downtime release?', '没有任何富余容量。选哪组 maxSurge / maxUnavailable 才能零停机发布？'),
    options: ['0 / 1', '1 / 0', '0 / 0', '2 / 2'],
    correct: 1,
    explain: tr('Сначала поднять новый под, потом убрать старый: ёмкость не падает. 0 / 0 Kubernetes не примет.', 'Start a new pod first, then remove an old one: capacity never drops. Kubernetes rejects 0 / 0.', '先启动一个新 Pod，再移除一个旧 Pod：容量始终不会下降。Kubernetes 不接受 0 / 0。'),
  },
  {
    q: tr('Три реплики, PDB minAvailable: 3. Что будет при kubectl drain ноды с одним из подов?', 'Three replicas, PDB minAvailable: 3. What happens on kubectl drain of a node holding one of the pods?', '三个副本，PDB 设为 minAvailable: 3。对运行着其中一个 Pod 的 Node 执行 kubectl drain，会发生什么？'),
    options: [
      tr('Под выселят, остальные подождут', 'The pod is evicted, the rest wait', '这个 Pod 被驱逐，其余的等待'),
      tr('Drain зависнет: выселить нельзя ни один под', 'The drain hangs: no pod can be evicted', 'drain 卡住：一个 Pod 都驱逐不了'),
      tr('PDB игнорируется при drain', 'PDB is ignored during a drain', 'drain 时会忽略 PDB'),
      tr('Kubernetes временно поднимет четвёртую реплику', 'Kubernetes temporarily starts a fourth replica', 'Kubernetes 会临时启动第四个副本'),
    ],
    correct: 1,
    explain: tr('PDB, равный числу реплик, не разрешает ни одного добровольного выключения — обновление кластера блокируется.', 'A PDB equal to the replica count allows no voluntary disruption at all, so the cluster upgrade is blocked.', 'PDB 等于副本数时，不允许任何主动中断（voluntary disruption），因此集群升级会被阻塞。'),
  },
  {
    q: tr('Реплики разнесены по разным нодам. Защищает ли это от отказа зоны облака?', 'Replicas are spread across different nodes. Does that protect against a cloud zone outage?', '副本分布在不同的 Node 上。这能防住云可用区故障吗？'),
    options: [
      tr('Да, всегда', 'Yes, always', '能，任何情况下都能'),
      tr('Нет: несколько нод могут стоять в одной зоне — нужен spread по зонам', 'No: several nodes can sit in one zone; you need a spread across zones', '不能：多个 Node 可能位于同一个可用区，需要跨可用区分布'),
      tr('Да, если включён HPA', 'Yes, if the HPA is on', '能，只要开启了 HPA'),
      tr('Нет, от отказа зоны защищает только PDB', 'No, only a PDB protects against a zone outage', '不能，只有 PDB 能防住可用区故障'),
    ],
    correct: 1,
    explain: tr('Домен отказа зоны больше ноды. topologySpreadConstraints по topology.kubernetes.io/zone держит реплики равномерно по зонам.', 'A zone’s failure domain is larger than a node’s. topologySpreadConstraints on topology.kubernetes.io/zone keeps replicas even across zones.', '可用区的故障域比 Node 的更大。按 topology.kubernetes.io/zone 配置 topologySpreadConstraints，可以让副本在各可用区之间均匀分布。'),
  },
]
