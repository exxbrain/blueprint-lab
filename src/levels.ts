/**
 * Уровни: у каждой задачи есть уровень сложности, у игрока — уровень по набранному опыту.
 * Шкала общая: задачи уровня Junior решает Junior, Architect — архитектор.
 */
import { tr } from './i18n'
import { modules } from './content/modules'
import { builderChallenges } from './sim/builder/challenges'
import { PROJECTS } from './sim/monolith/projects'
import { DDD_STAGES } from './sim/ddd/tasks'
import { K8S_TASKS } from './sim/k8s/tasks'
import { C4_EXERCISES } from './sim/c4/exercises'
import { CAP_TASKS } from './sim/cap/model'
import { ES_TASKS } from './sim/es/model'
import type { Progress } from './progress'
import { href } from './router'

export type TaskLevel = 1 | 2 | 3 | 4

export const TASK_LEVEL: Record<TaskLevel, { name: string; short: string }> = {
  1: { name: tr('Младший', 'Junior', '初级'), short: tr('Мл', 'J', '初') },
  2: { name: tr('Средний', 'Middle', '中级'), short: tr('Ср', 'M', '中') },
  3: { name: tr('Старший', 'Senior', '高级'), short: tr('Ст', 'S', '高') },
  4: { name: tr('Архитектор', 'Architect', '架构师'), short: tr('Ар', 'A', '架') },
}

/** Опыт за решённую задачу по уровню */
/** Единица опыта в подписях */
export const XP = tr('опыта', 'XP', 'XP')

export const TASK_XP: Record<TaskLevel, number> = { 1: 50, 2: 100, 3: 200, 4: 350 }
const LESSON_XP = 15
const QUIZ_XP = 40

export interface Task {
  /** Ключ в прогрессе */
  key: string
  title: string
  area: string
  level: TaskLevel
  href: string
}

const BUILDER_LEVEL: Record<string, TaskLevel> = {
  sale: 1,
  'slow-home': 1,
  'slow-images': 1,
  'doc-scans': 1,
  'signup-email': 1,
  payments: 2,
  'catalog-search': 2,
  'reports-db': 2,
  profiles: 2,
  'sensor-stream': 2,
  'classifieds': 2,
  'revenue-dashboard': 2,
  shortener: 2,
  tickets: 3,
  feed: 3,
  autocomplete: 3,
  notifications: 3,
  video: 4,
  // по мотивам System Design Primer: три шага «Роста» — по одному в мирах 1–3
  'growth-1': 1,
  'growth-2': 2,
  'growth-3': 3,
  'sales-rank': 2,
  finance: 3,
  'social-graph': 3,
  crawler: 4,
}

/** Распил: магазин — Middle, доставка — Senior, банк — Architect; первая миссия проекта на уровень проще */
const PROJECT_LEVEL: Record<string, TaskLevel> = { shop: 2, food: 3, bank: 4 }

const clamp = (n: number): TaskLevel => Math.max(1, Math.min(4, n)) as TaskLevel

export const TASKS: Task[] = [
  ...builderChallenges.map((c) => ({
    key: `builder/${c.id}`,
    title: c.title,
    area: tr('Конструктор', 'Builder', '构建器'),
    level: BUILDER_LEVEL[c.id] ?? 2,
    href: href('builder', c.id),
  })),
  ...PROJECTS.flatMap((p) =>
    (DDD_STAGES[p.id] ?? []).map((t, i) => ({
      key: `monolith/${p.id}/${t.id}`,
      title: `${p.title}: ${t.title}`,
      area: tr('Распил монолита', 'Monolith', '拆分单体'),
      // поиск границ — на ступень проще миссий проекта, карта контекстов — на уровне проекта
      level: clamp((PROJECT_LEVEL[p.id] ?? 3) - (i === 0 ? 1 : 0)),
      href: href('monolith', p.id, t.id),
    })),
  ),
  ...PROJECTS.flatMap((p) =>
    p.missions.map((m, i) => ({
      key: `monolith/${p.id}/${m.id}`,
      title: `${p.title}: ${m.title}`,
      area: tr('Распил монолита', 'Monolith', '拆分单体'),
      level: clamp((PROJECT_LEVEL[p.id] ?? 3) - (i === 0 ? 1 : 0)),
      href: href('monolith', p.id, m.id),
    })),
  ),
  ...modules.flatMap((mod) =>
    mod.scenarios.map((s, i) => ({
      key: `${mod.id}/${s.id}`,
      title: s.title,
      area: mod.title,
      level: clamp(s.difficulty ?? (i < 2 ? 1 : 2)),
      href: href(mod.id, 'scenario', s.id),
    })),
  ),
  ...K8S_TASKS.map((t) => ({
    key: `kubernetes/lab/${t.id}`,
    title: t.title,
    area: 'Kubernetes',
    level: t.level,
    href: href('kubernetes', 'lab', t.id),
  })),
  ...C4_EXERCISES.map((ex, i) => ({
    key: `c4/${ex.id}`,
    title: ex.title,
    area: 'C4',
    level: clamp(i + 1),
    href: href('c4', 'exercises', ex.id),
  })),
  ...CAP_TASKS.map((t, i) => ({
    key: `data/cap/${t.id}`,
    title: t.title,
    area: 'CAP',
    level: clamp(i === 0 ? 1 : i < 2 ? 2 : 3),
    href: href('data', 'cap', t.id),
  })),
  ...ES_TASKS.map((t, i) => ({
    key: `data/es/${t.id}`,
    title: t.title,
    area: 'Event Sourcing',
    level: clamp(i === 0 ? 1 : i < 2 ? 2 : 3),
    href: href('data', 'es', t.id),
  })),
]

const BY_KEY = new Map(TASKS.map((t) => [t.key, t]))

export function taskLevel(key: string): TaskLevel | undefined {
  return BY_KEY.get(key)?.level
}

/**
 * Уровни открываются по порядку: задачи следующего уровня доступны,
 * только когда решены все задачи предыдущего. Уже решённые задачи остаются открытыми.
 */
export interface LevelStatus {
  level: TaskLevel
  done: number
  total: number
  open: boolean
  passed: boolean
}

export function levelStatus(p: Progress): LevelStatus[] {
  const out: LevelStatus[] = []
  let open = true
  for (const l of [1, 2, 3, 4] as TaskLevel[]) {
    const list = TASKS.filter((t) => t.level === l)
    const done = list.filter((t) => p.scenarios[t.key]).length
    const passed = done === list.length
    out.push({ level: l, done, total: list.length, open, passed })
    open = open && passed
  }
  return out
}

export function isTaskOpen(key: string, p: Progress): boolean {
  const t = BY_KEY.get(key)
  if (!t || p.scenarios[key]) return true
  return levelStatus(p)[t.level - 1].open
}

/** Что мешает открыть задачу: предыдущий уровень и его нерешённые задачи */
export function blockerOf(key: string, p: Progress): { level: TaskLevel; left: Task[]; status: LevelStatus } | null {
  if (isTaskOpen(key, p)) return null
  const st = levelStatus(p)
  const first = st.find((s) => !s.passed)!
  return { level: first.level, status: first, left: TASKS.filter((t) => t.level === first.level && !p.scenarios[t.key]) }
}

/** Опыт за задачу: базовый по уровню, звёзды оценки добавляют по 25% */
export function taskXp(t: Task, p: Progress): number {
  if (!p.scenarios[t.key]) return 0
  const stars = p.stars?.[t.key] ?? 1
  return Math.round(TASK_XP[t.level] * (1 + 0.25 * (stars - 1)))
}

export function totalXp(p: Progress): number {
  const tasks = TASKS.reduce((s, t) => s + taskXp(t, p), 0)
  const lessons = Object.values(p.lessons).filter(Boolean).length * LESSON_XP
  const quizzes = Object.values(p.quizzes).reduce((s, v) => s + Math.round(v * QUIZ_XP), 0)
  return tasks + lessons + quizzes
}

/** Уровни игрока: звание и масштаб систем, которые он умеет проектировать */
export const RANKS: { xp: number; title: string; scale: string; tier: TaskLevel }[] = [
  { xp: 0, title: tr('Стажёр', 'Intern', '实习生'), scale: tr('Hello world на одном сервере', 'Hello world on one server', '单台服务器上的 Hello world'), tier: 1 },
  { xp: 100, title: tr('Младший разработчик', 'Junior', '初级工程师'), scale: tr('Сервис и база данных', 'A service and a database', '一个服务加一个数据库'), tier: 1 },
  { xp: 300, title: tr('Разработчик', 'Junior+', '初级工程师+'), scale: tr('Кэш перед базой', 'A cache in front of the database', '数据库前面加缓存'), tier: 1 },
  { xp: 700, title: tr('Опытный разработчик', 'Middle', '中级工程师'), scale: tr('Балансировка и реплики', 'Load balancing and replicas', '负载均衡与副本'), tier: 2 },
  { xp: 1300, title: tr('Старший разработчик', 'Middle+', '中级工程师+'), scale: tr('Очереди и фоновая обработка', 'Queues and background processing', '队列与后台处理'), tier: 2 },
  { xp: 2100, title: tr('Ведущий разработчик', 'Senior', '高级工程师'), scale: tr('Микросервисы и свои базы', 'Microservices with their own databases', '各自拥有数据库的微服务'), tier: 3 },
  { xp: 3100, title: tr('Техлид', 'Senior+', '高级工程师+'), scale: tr('Распределённые данные и согласованность', 'Distributed data and consistency', '分布式数据与一致性'), tier: 3 },
  { xp: 4300, title: tr('Главный инженер', 'Staff', '资深工程师'), scale: tr('Платформа для многих команд', 'A platform for many teams', '服务众多团队的平台'), tier: 4 },
  { xp: 5700, title: tr('Системный архитектор', 'Principal', '首席工程师'), scale: tr('Системы на миллионы пользователей', 'Systems for millions of users', '面向数百万用户的系统'), tier: 4 },
  { xp: 7200, title: tr('Главный архитектор', 'Architect', '架构师'), scale: tr('Глобальная система', 'A global system', '全球化系统'), tier: 4 },
]

export interface PlayerLevel {
  level: number // 1..RANKS.length
  xp: number
  rank: (typeof RANKS)[number]
  next?: (typeof RANKS)[number]
  /** Доля пути до следующего уровня, 0..1 */
  toNext: number
}

export function playerLevel(p: Progress): PlayerLevel {
  const xp = totalXp(p)
  let i = 0
  while (i + 1 < RANKS.length && xp >= RANKS[i + 1].xp) i++
  const rank = RANKS[i]
  const next = RANKS[i + 1]
  return { level: i + 1, xp, rank, next, toNext: next ? (xp - rank.xp) / (next.xp - rank.xp) : 1 }
}

/** Что решать дальше: нерешённые задачи своего уровня, затем на ступень выше */
export function recommended(p: Progress, n = 4): Task[] {
  const tier = playerLevel(p).rank.tier
  const open = TASKS.filter((t) => !p.scenarios[t.key] && isTaskOpen(t.key, p))
  const score = (t: Task) => (t.level === tier ? 0 : t.level === tier + 1 ? 1 : t.level < tier ? 2 : 3)
  const all = [...open].sort((a, b) => score(a) - score(b) || a.level - b.level)
  // сначала свой уровень и ступень выше; задачи намного сложнее — только если подходящих мало
  const fit = all.filter((t) => score(t) <= 1)
  const sorted = fit.length >= n ? fit : all
  // по одной задаче из каждого раздела по очереди, чтобы рекомендации не были из одного места
  const out: Task[] = []
  const used = new Set<string>()
  while (out.length < n && out.length < sorted.length) {
    const before = out.length
    const areas = new Set<string>()
    for (const t of sorted) {
      if (out.length >= n) break
      if (used.has(t.key) || areas.has(t.area)) continue
      areas.add(t.area)
      used.add(t.key)
      out.push(t)
    }
    if (out.length === before) break
  }
  return out.sort((a, b) => score(a) - score(b))
}

export function maxXp(): number {
  const tasks = TASKS.reduce((s, t) => s + TASK_XP[t.level] * 1.5, 0)
  const lessons = modules.reduce((s, m) => s + m.lessons.length * LESSON_XP + (m.quiz.length ? QUIZ_XP : 0), 0)
  return Math.round(tasks + lessons)
}
