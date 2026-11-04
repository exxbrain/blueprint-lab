import { useSyncExternalStore } from 'react'
import { tr } from './i18n'
import { clearDrafts } from './drafts'

export interface Progress {
  lessons: Record<string, boolean>
  scenarios: Record<string, boolean>
  quizzes: Record<string, number> // лучший результат, 0..1
  /** Лучшая оценка решения, 1..3 звезды */
  stars: Record<string, number>
  /** Сколько подсказок открыто в задаче; просмотр эталона считается как все подсказки */
  hints: Record<string, number>
}

const KEY = 'blueprint-lab-progress'
const empty: Progress = { lessons: {}, scenarios: {}, quizzes: {}, stars: {}, hints: {} }

/** Просмотр эталона — как если бы открыли все подсказки */
export const REFERENCE_VIEWED = 99

/** Предупреждение на кнопке эталона: после него потолок звёзд за задачу — одна (уже полученные звёзды остаются) */
export const referenceNote = () =>
  tr('После эталона за эту задачу можно получить не больше ★. Уже заработанные звёзды останутся.', 'After viewing the reference this task gives at most ★. Stars you already earned stay.', '查看参考答案后，这个任务最多只能获得 ★。已经获得的星会保留。')

/**
 * Задачи переименованы: старые идентификаторы подсказывали ответ (tool-redis, readiness, reversal…).
 * Прогресс по старым ключам переносится на новые при загрузке.
 */
const RENAMED: Record<string, string> = {
  'builder/olap': 'builder/reports-db',
  'builder/tool-redis': 'builder/slow-home',
  'builder/tool-cdn': 'builder/slow-images',
  'builder/tool-kafka': 'builder/signup-email',
  'builder/tool-cassandra': 'builder/sensor-stream',
  'builder/tool-elastic': 'builder/classifieds',
  'builder/tool-clickhouse': 'builder/revenue-dashboard',
  'builder/tool-s3': 'builder/doc-scans',
  'kubernetes/lab/oom': 'kubernetes/lab/pod-restarts',
  'kubernetes/lab/readiness': 'kubernetes/lab/deploy-503',
  'kubernetes/lab/crashloop': 'kubernetes/lab/release-down',
  'kubernetes/lab/liveness': 'kubernetes/lab/hung-pod',
  'kubernetes/lab/hpa': 'kubernetes/lab/evening-peak',
  'kubernetes/lab/pending': 'kubernetes/lab/stuck-pods',
  'kubernetes/lab/rolling': 'kubernetes/lab/zero-downtime',
  'kubernetes/lab/node-failure': 'kubernetes/lab/node-died',
  'kubernetes/lab/drain': 'kubernetes/lab/cluster-upgrade',
  'kubernetes/lab/noisy': 'kubernetes/lab/night-report',
  'kubernetes/lab/canary': 'kubernetes/lab/live-check',
  'kubernetes/lab/zones': 'kubernetes/lab/zone-outage',
  'data/es/reversal': 'data/es/double-charge',
  'data/es/rebuild': 'data/es/new-report',
  'data/es/snapshots': 'data/es/slow-account',
  'data/es/versioning': 'data/es/event-version',
  'data/es/concurrency': 'data/es/two-withdrawals',
  'data/cap/quorum5': 'data/cap/five-nodes',
}

/** Старый адрес задачи (до переименования) — новый, если задачу переименовали */
export function renamedPath(path: string): string | undefined {
  return RENAMED[path]
}

function migrate(p: Progress): Progress {
  const move = <T,>(rec: Record<string, T> | undefined): Record<string, T> => {
    const out: Record<string, T> = {}
    for (const [k, v] of Object.entries(rec ?? {})) {
      const nk = RENAMED[k] ?? k
      const prev = out[nk]
      out[nk] = typeof v === 'number' && typeof prev === 'number' ? (Math.max(prev, v) as T) : (prev ?? v)
    }
    return out
  }
  return { ...p, scenarios: move(p.scenarios), stars: move(p.stars), hints: move(p.hints) }
}

function load(): Progress {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? migrate({ ...empty, ...JSON.parse(raw) }) : empty
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

/** Потолок звёзд по подсказкам: без подсказок — три, с одной — две, больше или эталон — одна */
export function hintStars(hints: number): 1 | 2 | 3 {
  return hints === 0 ? 3 : hints === 1 ? 2 : 1
}

/** Итоговые звёзды: оценка решения, но не выше потолка по подсказкам */
export function cappedStars(reviewStars: number, hints: number): 1 | 2 | 3 {
  return Math.max(1, Math.min(reviewStars, hintStars(hints))) as 1 | 2 | 3
}

export function takeHint(key: string) {
  if ((state.hints?.[key] ?? 0) >= REFERENCE_VIEWED) return
  save({ ...state, hints: { ...state.hints, [key]: (state.hints?.[key] ?? 0) + 1 } })
}

export function markReferenceViewed(key: string) {
  if ((state.hints?.[key] ?? 0) >= REFERENCE_VIEWED) return
  save({ ...state, hints: { ...state.hints, [key]: REFERENCE_VIEWED } })
}

/** Подсказки задачи, сохранённые в прогрессе: уход со страницы их не обнуляет */
export function useHints(key: string): { used: number; shown: number; take: () => void; reveal: () => void } {
  const p = useProgress()
  const used = p.hints?.[key] ?? 0
  return { used, shown: Math.min(used, REFERENCE_VIEWED - 1), take: () => takeHint(key), reveal: () => markReferenceViewed(key) }
}

export function recordStars(id: string, stars: number) {
  if ((state.stars[id] ?? 0) < stars) save({ ...state, stars: { ...state.stars, [id]: stars } })
}

export function recordQuiz(id: string, score: number) {
  if ((state.quizzes[id] ?? -1) < score) save({ ...state, quizzes: { ...state.quizzes, [id]: score } })
}

export function resetProgress() {
  save(empty)
  clearDrafts()
}
