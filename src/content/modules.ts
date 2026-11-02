import type { Module } from './types'
import { kafkaLessons } from './kafka/lessons'
import { kafkaQuiz } from './kafka/quiz'
import { kafkaScenarios } from './kafka/scenarios'
import { c4Lessons } from './c4/lessons'
import { c4Quiz } from './c4/quiz'
import { dataLessons } from './data/lessons'
import { dataQuiz } from './data/quiz'

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
    id: 'data',
    title: 'Распределённые данные',
    icon: '⚖️',
    summary: 'CAP и кворумы, Event Sourcing и CQRS — задачи посложнее',
    status: 'ready',
    lessons: dataLessons,
    quiz: dataQuiz,
    scenarios: [],
    extras: [
      {
        title: 'CAP и кворумы',
        desc: 'Разрывы сети, падения узлов, N/W/R, sloppy quorum, LWW против слияния — 4 задачи',
        href: '#/data/cap',
        icon: '⚖️',
      },
      {
        title: 'Event Sourcing',
        desc: 'Сторно, перестроение проекций, снапшоты, версии событий, конкурентность — 5 задач',
        href: '#/data/es',
        icon: '📚',
      },
    ],
  },
  {
    id: 'c4',
    title: 'C4 Model',
    icon: '🗺️',
    summary: 'Диаграммы архитектуры по уровням: контекст, контейнеры, компоненты',
    status: 'ready',
    lessons: c4Lessons,
    quiz: c4Quiz,
    scenarios: [],
    extras: [
      {
        title: 'Упражнения по C4',
        desc: 'Нарисуйте контекст, контейнеры и компоненты, найдите ошибки в чужой диаграмме',
        href: '#/c4/exercises',
        icon: '✏️',
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
