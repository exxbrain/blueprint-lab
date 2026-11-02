import type { ComponentType, ReactNode } from 'react'
import type { KafkaConfig, KafkaSim } from '../sim/kafka/engine'
import type { SimControls } from '../sim/kafka/KafkaSimulator'

export interface Lesson {
  id: string
  title: string
  summary: string
  minutes: number
  Body: ComponentType
}

export interface QuizQuestion {
  q: string
  options: string[]
  correct: number
  explain: string
}

export interface Scenario {
  id: string
  title: string
  summary: string
  difficulty: 1 | 2 | 3
  brief: ReactNode
  config: KafkaConfig
  controls: SimControls
  goal: {
    text: string
    /** Сколько секунд подряд условие должно выполняться */
    holdSeconds: number
    check: (sim: KafkaSim) => boolean
    /** Короткая строка о текущем состоянии */
    status: (sim: KafkaSim) => string
    /** Нельзя пройти, пока не нажат trigger */
    afterTrigger?: boolean
  }
  /** Кнопка, которая устраивает «аварию» */
  trigger?: { label: string; run: (sim: KafkaSim) => void }
  hints: string[]
  debrief: ReactNode
}

export interface ExtraLink {
  title: string
  desc: string
  href: string
  icon: string
}

export interface Module {
  id: string
  title: string
  icon: string
  summary: string
  status: 'ready' | 'soon'
  lessons: Lesson[]
  quiz: QuizQuestion[]
  scenarios: Scenario[]
  extras: ExtraLink[]
}
