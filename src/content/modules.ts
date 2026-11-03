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
    summary: tr('Журнал событий: партиции, consumer groups, репликация, гарантии доставки', 'Event log: partitions, consumer groups, replication, delivery guarantees', '事件日志：分区、消费者组、复制、投递保证'),
    status: 'ready',
    lessons: kafkaLessons,
    quiz: kafkaQuiz,
    scenarios: kafkaScenarios,
    extras: [
      {
        title: tr('Песочница Kafka', 'Kafka sandbox', 'Kafka 自由模式'),
        desc: tr('Все рычаги сразу: брокеры, партиции, группы, acks', 'All the levers at once: brokers, partitions, groups, acks', '所有调节手段一应俱全：Broker、分区、消费者组、acks'),
        href: '#/kafka/sandbox',
        icon: '🧰',
      },
    ],
  },
  {
    id: 'microservices',
    title: tr('Микросервисы', 'Microservices', '微服务'),
    icon: '🧩',
    summary: tr('Распил монолита, синхронные и асинхронные связи, отказоустойчивость', 'Breaking up the monolith, synchronous and asynchronous communication, resilience', '拆分单体、同步与异步通信、容错能力'),
    status: 'ready',
    lessons: [],
    quiz: [],
    scenarios: [],
    extras: [
      {
        title: tr('Распил монолита', 'Breaking up the monolith', '拆分单体'),
        desc: tr('Два уровня: интернет-магазин и интернет-банк. Выносите модули по одному и смотрите на последствия', 'Two levels: an online store and an online bank. Extract modules one by one and watch the consequences', '两个关卡：网上商店和网上银行。逐个拆出模块，观察会带来什么后果'),
        href: '#/monolith',
        icon: '🪓',
      },
      {
        title: tr('Конструктор архитектуры', 'Architecture Builder', '架构构建器'),
        desc: tr('Соберите систему из блоков и подайте нагрузку', 'Assemble a system from blocks and put it under load', '用积木块搭建系统，再给它施加负载'),
        href: '#/builder',
        icon: '🏗️',
      },
    ],
  },
  {
    id: 'data',
    title: tr('Распределённые данные', 'Distributed data', '分布式数据'),
    icon: '⚖️',
    summary: tr('CAP и кворумы, Event Sourcing и CQRS — задачи посложнее', 'CAP and quorums, Event Sourcing and CQRS: harder challenges', 'CAP 与法定人数、Event Sourcing 与 CQRS：更有难度的任务'),
    status: 'ready',
    lessons: dataLessons,
    quiz: dataQuiz,
    scenarios: [],
    extras: [
      {
        title: tr('CAP и кворумы', 'CAP and quorums', 'CAP 与法定人数'),
        desc: tr('Разрывы сети, падения узлов, N/W/R, sloppy quorum, LWW против слияния — 4 задачи', 'Network partitions, node failures, N/W/R, sloppy quorum, LWW vs merge: 4 tasks', '网络分区、节点故障、N/W/R、sloppy quorum、LWW 对比合并：4 个任务'),
        href: '#/data/cap',
        icon: '⚖️',
      },
      {
        title: 'Event Sourcing',
        desc: tr('Сторно, перестроение проекций, снапшоты, версии событий, конкурентность — 5 задач', 'Reversals, projection rebuilds, snapshots, event versioning, concurrency: 5 tasks', '冲正、重建投影、快照、事件版本管理、并发：5 个任务'),
        href: '#/data/es',
        icon: '📚',
      },
    ],
  },
  {
    id: 'c4',
    title: 'C4 Model',
    icon: '🗺️',
    summary: tr('Диаграммы архитектуры по уровням: контекст, контейнеры, компоненты', 'Architecture diagrams by level: context, containers, components', '按层级划分的架构图：上下文、容器、组件'),
    status: 'ready',
    lessons: c4Lessons,
    quiz: c4Quiz,
    scenarios: [],
    extras: [
      {
        title: tr('Упражнения по C4', 'C4 exercises', 'C4 练习'),
        desc: tr('Нарисуйте контекст, контейнеры и компоненты, найдите ошибки в чужой диаграмме', "Draw context, containers and components, and find the mistakes in someone else's diagram", '画出上下文、容器和组件，并找出别人图中的错误'),
        href: '#/c4/exercises',
        icon: '✏️',
      },
    ],
  },
  {
    id: 'kubernetes',
    title: 'Kubernetes',
    icon: '☸️',
    summary: tr('Ресурсы, пробы, выкатка, автоскейлинг, отказы нод и зон — 12 инцидентов', 'Resources, probes, rollouts, autoscaling, node and zone failures: 12 incidents', '资源、探针、发布、自动扩展、节点与可用区故障：12 个事故'),
    status: 'ready',
    lessons: k8sLessons,
    quiz: k8sQuiz,
    scenarios: [],
    extras: [
      {
        title: tr('Kubernetes: инциденты', 'Kubernetes: incidents', 'Kubernetes：事故'),
        desc: tr('Правьте манифест и смотрите, как кластер планирует, перезапускает и выкатывает поды', 'Edit the manifest and watch the cluster schedule, restart and roll out pods', '修改清单，观察集群如何调度、重启和发布 Pod'),
        href: '#/kubernetes/lab',
        icon: '☸️',
      },
    ],
  },
]

export function findModule(id: string | undefined): Module | undefined {
  return modules.find((m) => m.id === id)
}
