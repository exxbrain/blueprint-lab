import type { Module } from './types'
import { kafkaLessons } from './kafka/lessons'
import { kafkaQuiz } from './kafka/quiz'
import { kafkaScenarios } from './kafka/scenarios'

export const modules: Module[] = [
  {
    id: 'kafka',
    title: 'Apache Kafka',
    icon: '📜',
    summary: 'Журнал событий: партиции, consumer groups, репликация, гарантии доставки',
    status: 'ready',
    lessons: kafkaLessons,
    quiz: kafkaQuiz,
    scenarios: kafkaScenarios,
    extras: [
      {
        title: 'Песочница Kafka',
        desc: 'Все рычаги сразу: брокеры, партиции, группы, acks',
        href: '#/kafka/sandbox',
        icon: '🧰',
      },
    ],
  },
  {
    id: 'microservices',
    title: 'Микросервисы',
    icon: '🧩',
    summary: 'Распил монолита, синхронные и асинхронные связи, отказоустойчивость',
    status: 'ready',
    lessons: [],
    quiz: [],
    scenarios: [],
    extras: [
      {
        title: 'Распил монолита',
        desc: 'Два уровня: интернет-магазин и интернет-банк. Выносите модули по одному и смотрите на последствия',
        href: '#/monolith',
        icon: '🪓',
      },
      {
        title: 'Конструктор архитектуры',
        desc: 'Соберите систему из блоков и подайте нагрузку',
        href: '#/builder',
        icon: '🏗️',
      },
    ],
  },
  {
    id: 'kubernetes',
    title: 'Kubernetes',
    icon: '☸️',
    summary: 'Поды, Deployment, Service, автоскейлинг, rolling update',
    status: 'soon',
    lessons: [],
    quiz: [],
    scenarios: [],
    extras: [],
  },
]

export function findModule(id: string | undefined): Module | undefined {
  return modules.find((m) => m.id === id)
}
