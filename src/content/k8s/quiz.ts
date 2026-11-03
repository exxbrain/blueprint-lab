import type { QuizQuestion } from '../types'
import { tr } from '../../i18n'

export const k8sQuiz: QuizQuestion[] = [
  {
    q: tr('Под Java-сервиса постоянно перезапускается со статусом OOMKilled. Что это значит?', 'A Java service pod keeps restarting with status OOMKilled. What does that mean?'),
    options: [
      tr('На ноде кончился диск', 'The node ran out of disk'),
      tr('Процесс превысил лимит памяти, и ядро его убило', 'The process exceeded its memory limit and the kernel killed it'),
      tr('Не прошла readiness-проба', 'The readiness probe failed'),
      tr('Планировщик не нашёл ноду', 'The scheduler found no node'),
    ],
    correct: 1,
    explain: tr('Память нельзя «притормозить», как CPU: вышел за limits.memory — процесс убит. Лимит должен покрывать реальное потребление с запасом.', 'Memory cannot be throttled like CPU: go above limits.memory and the process is killed. The limit must cover real usage plus headroom.'),
  },
  {
    q: tr('Чем readiness-проба отличается от liveness?', 'How does a readiness probe differ from a liveness probe?'),
    options: [
      tr('Ничем, это синонимы', 'No difference, they are synonyms'),
      tr('Readiness перезапускает контейнер, liveness убирает из балансировки', 'Readiness restarts the container, liveness removes it from load balancing'),
      tr('Readiness убирает под из балансировки, liveness перезапускает контейнер', 'Readiness removes the pod from load balancing, liveness restarts the container'),
      tr('Readiness проверяет ноду, liveness — под', 'Readiness checks the node, liveness checks the pod'),
    ],
    correct: 2,
    explain: tr('Readiness решает, получает ли под трафик; liveness — жив ли процесс и не пора ли его перезапустить.', 'Readiness decides whether the pod gets traffic; liveness decides whether the process is alive or should be restarted.'),
  },
  {
    q: tr('Поды висят в Pending с «Insufficient cpu», хотя ноды загружены на 30%. Почему?', 'Pods are stuck Pending with “Insufficient cpu”, though nodes are at 30% load. Why?'),
    options: [
      tr('Планировщик смотрит на requests, а не на реальную загрузку', 'The scheduler looks at requests, not real usage'),
      tr('Не хватает памяти', 'There is not enough memory'),
      tr('Мешает HPA', 'The HPA is in the way'),
      tr('Нет readiness-пробы', 'There is no readiness probe'),
    ],
    correct: 0,
    explain: tr('Если сумма requests на ноде исчерпана, новый под туда не встанет, даже если процессор фактически простаивает. Завышенные requests — частая причина Pending.', 'If the sum of requests on a node is used up, a new pod will not fit there even if the CPU is actually idle. Inflated requests are a common cause of Pending.'),
  },
  {
    q: tr('Запас мощности нулевой. Какие maxSurge / maxUnavailable выбрать для релиза без простоя?', 'There is no spare capacity. Which maxSurge / maxUnavailable gives a zero-downtime release?'),
    options: ['0 / 1', '1 / 0', '0 / 0', '2 / 2'],
    correct: 1,
    explain: tr('Сначала поднять новый под, потом убрать старый: ёмкость не падает. 0 / 0 Kubernetes не примет.', 'Start a new pod first, then remove an old one: capacity never drops. Kubernetes rejects 0 / 0.'),
  },
  {
    q: tr('Три реплики, PDB minAvailable: 3. Что будет при kubectl drain ноды с одним из подов?', 'Three replicas, PDB minAvailable: 3. What happens on kubectl drain of a node holding one of the pods?'),
    options: [
      tr('Под выселят, остальные подождут', 'The pod is evicted, the rest wait'),
      tr('Drain зависнет: выселить нельзя ни один под', 'The drain hangs: no pod can be evicted'),
      tr('PDB игнорируется при drain', 'PDB is ignored during a drain'),
      tr('Kubernetes временно поднимет четвёртую реплику', 'Kubernetes temporarily starts a fourth replica'),
    ],
    correct: 1,
    explain: tr('PDB, равный числу реплик, не разрешает ни одного добровольного выключения — обновление кластера блокируется.', 'A PDB equal to the replica count allows no voluntary disruption at all, so the cluster upgrade is blocked.'),
  },
  {
    q: tr('Реплики разнесены по разным нодам. Защищает ли это от отказа зоны облака?', 'Replicas are spread across different nodes. Does that protect against a cloud zone outage?'),
    options: [
      tr('Да, всегда', 'Yes, always'),
      tr('Нет: несколько нод могут стоять в одной зоне — нужен spread по зонам', 'No: several nodes can sit in one zone; you need a spread across zones'),
      tr('Да, если включён HPA', 'Yes, if the HPA is on'),
      tr('Нет, от отказа зоны защищает только PDB', 'No, only a PDB protects against a zone outage'),
    ],
    correct: 1,
    explain: tr('Домен отказа зоны больше ноды. topologySpreadConstraints по topology.kubernetes.io/zone держит реплики равномерно по зонам.', 'A zone’s failure domain is larger than a node’s. topologySpreadConstraints on topology.kubernetes.io/zone keeps replicas even across zones.'),
  },
]
