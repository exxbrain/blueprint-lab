import { tr } from '../i18n'
import type { Module } from './types'
import { kafkaLessons } from './kafka/lessons'
import { kafkaQuiz } from './kafka/quiz'
import { kafkaScenarios } from './kafka/scenarios'
import { c4Lessons } from './c4/lessons'
import { c4Quiz } from './c4/quiz'
import { dataLessons } from './data/lessons'
import { dataQuiz } from './data/quiz'
import { k8sLessons } from './k8s/lessons'
import { k8sQuiz } from './k8s/quiz'

export const modules: Module[] = [
  {
    id: 'kafka',
    title: 'Apache Kafka',
    icon: '📜',
    summary: tr('Журнал событий: партиции, consumer groups, репликация, гарантии доставки', 'Event log: partitions, consumer groups, replication, delivery guarantees'),
    status: 'ready',
    lessons: kafkaLessons,
    quiz: kafkaQuiz,
    scenarios: kafkaScenarios,
    extras: [
      {
        title: tr('Песочница Kafka', 'Kafka sandbox'),
        desc: tr('Все рычаги сразу: брокеры, партиции, группы, acks', 'All the levers at once: brokers, partitions, groups, acks'),
        href: '#/kafka/sandbox',
        icon: '🧰',
      },
    ],
  },
  {
    id: 'microservices',
    title: tr('Микросервисы', 'Microservices'),
    icon: '🧩',
    summary: tr('Распил монолита, синхронные и асинхронные связи, отказоустойчивость', 'Breaking up the monolith, synchronous and asynchronous communication, resilience'),
    status: 'ready',
    lessons: [],
    quiz: [],
    scenarios: [],
    extras: [
      {
        title: tr('Распил монолита', 'Breaking up the monolith'),
        desc: tr('Два уровня: интернет-магазин и интернет-банк. Выносите модули по одному и смотрите на последствия', 'Two levels: an online store and an online bank. Extract modules one by one and watch the consequences'),
        href: '#/monolith',
        icon: '🪓',
      },
      {
        title: tr('Конструктор архитектуры', 'Architecture Builder'),
        desc: tr('Соберите систему из блоков и подайте нагрузку', 'Assemble a system from blocks and put it under load'),
        href: '#/builder',
        icon: '🏗️',
      },
    ],
  },
  {
    id: 'data',
    title: tr('Распределённые данные', 'Distributed data'),
    icon: '⚖️',
    summary: tr('CAP и кворумы, Event Sourcing и CQRS — задачи посложнее', 'CAP and quorums, Event Sourcing and CQRS: harder challenges'),
    status: 'ready',
    lessons: dataLessons,
    quiz: dataQuiz,
    scenarios: [],
    extras: [
      {
        title: tr('CAP и кворумы', 'CAP and quorums'),
        desc: tr('Разрывы сети, падения узлов, N/W/R, sloppy quorum, LWW против слияния — 4 задачи', 'Network partitions, node failures, N/W/R, sloppy quorum, LWW vs merge: 4 tasks'),
        href: '#/data/cap',
        icon: '⚖️',
      },
      {
        title: 'Event Sourcing',
        desc: tr('Сторно, перестроение проекций, снапшоты, версии событий, конкурентность — 5 задач', 'Reversals, projection rebuilds, snapshots, event versioning, concurrency: 5 tasks'),
        href: '#/data/es',
        icon: '📚',
      },
    ],
  },
  {
    id: 'c4',
    title: 'C4 Model',
    icon: '🗺️',
    summary: tr('Диаграммы архитектуры по уровням: контекст, контейнеры, компоненты', 'Architecture diagrams by level: context, containers, components'),
    status: 'ready',
    lessons: c4Lessons,
    quiz: c4Quiz,
    scenarios: [],
    extras: [
      {
        title: tr('Упражнения по C4', 'C4 exercises'),
        desc: tr('Нарисуйте контекст, контейнеры и компоненты, найдите ошибки в чужой диаграмме', "Draw context, containers and components, and find the mistakes in someone else's diagram"),
        href: '#/c4/exercises',
        icon: '✏️',
      },
    ],
  },
  {
    id: 'kubernetes',
    title: 'Kubernetes',
    icon: '☸️',
    summary: tr('Ресурсы, пробы, выкатка, автоскейлинг, отказы нод и зон — 12 инцидентов', 'Resources, probes, rollouts, autoscaling, node and zone failures: 12 incidents'),
    status: 'ready',
    lessons: k8sLessons,
    quiz: k8sQuiz,
    scenarios: [],
    extras: [
      {
        title: tr('Kubernetes: инциденты', 'Kubernetes: incidents'),
        desc: tr('Правьте манифест и смотрите, как кластер планирует, перезапускает и выкатывает поды', 'Edit the manifest and watch the cluster schedule, restart and roll out pods'),
        href: '#/kubernetes/lab',
        icon: '☸️',
      },
    ],
  },
]

export function findModule(id: string | undefined): Module | undefined {
  return modules.find((m) => m.id === id)
}
