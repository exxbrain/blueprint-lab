import { useSyncExternalStore } from 'react'

export interface Progress {
  lessons: Record<string, boolean>
  scenarios: Record<string, boolean>
  quizzes: Record<string, number> // лучший результат, 0..1
  /** Лучшая оценка решения, 1..3 звезды */
  stars: Record<string, number>
}

const KEY = 'blueprint-lab-progress'
const empty: Progress = { lessons: {}, scenarios: {}, quizzes: {}, stars: {} }

function load(): Progress {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...empty, ...JSON.parse(raw) } : empty
  } catch {
    return empty
  }
}

let state = load()
const listeners = new Set<() => void>()

function save(next: Progress) {
  state = next
  localStorage.setItem(KEY, JSON.stringify(next))
  listeners.forEach((l) => l())
}

export function useProgress(): Progress {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

export function markLesson(id: string) {
  if (!state.lessons[id]) save({ ...state, lessons: { ...state.lessons, [id]: true } })
}

export function markScenario(id: string) {
  if (!state.scenarios[id]) save({ ...state, scenarios: { ...state.scenarios, [id]: true } })
}

export function recordStars(id: string, stars: number) {
  if ((state.stars[id] ?? 0) < stars) save({ ...state, stars: { ...state.stars, [id]: stars } })
}

export function recordQuiz(id: string, score: number) {
  if ((state.quizzes[id] ?? -1) < score) save({ ...state, quizzes: { ...state.quizzes, [id]: score } })
}

export function resetProgress() {
  save(empty)
}
