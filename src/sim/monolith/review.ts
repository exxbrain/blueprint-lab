import { grade, type Review, type ReviewItem } from '../review'
import { PATTERNS, type PatternId } from './patterns'
import { evaluate, solutionState, stateCost, type Mission, type Project, type State } from './model'

export function reviewMission(p: Project, m: Mission, s: State, spent: number): Review {
  const items: ReviewItem[] = []
  const e = evaluate(p, s, spent, m.budget)
  const refCost = stateCost(p, solutionState(p, m.solution))

  const failed = [
    ...m.goals.filter((g) => !g.check(e)).map((g) => g.text),
    ...(spent > m.budget ? [`бюджет ${m.budget} млн ₽`] : []),
  ]
  const goalsOk = failed.length === 0
  if (goalsOk) items.push({ tone: 'ok', text: 'Все цели миссии выполнены' })
  else items.push({ tone: 'bad', text: `Не выполнено: ${failed.join('; ')}` })

  // деньги: сколько стоит итоговая архитектура и сколько ушло на метания
  const built = stateCost(p, s)
  const ratio = spent / refCost
  if (spent <= refCost) items.push({ tone: 'ok', text: `Потрачено ${spent} млн ₽ — не больше эталона (${refCost})` })
  else if (built <= refCost)
    items.push({
      tone: spent - refCost > 3 ? 'warn' : 'ok',
      text: `Итоговая архитектура стоит как эталон (${built} млн ₽), но ${spent - built} млн ушло на переделки: передумывали по ходу`,
    })
  else
    items.push({
      tone: ratio > 1.2 ? 'warn' : 'ok',
      text: `Эталон дешевле на ${spent - refCost} млн ₽ (${refCost} против ${spent})`,
    })

  // оставшиеся предупреждения архитектуры (общая БД, прямые SQL, нет трейсинга)
  for (const pr of e.problems.filter((x) => x.severity === 'warn')) items.push({ tone: 'warn', text: pr.text })

  // отличия от эталона
  const title = (id: string) => p.modules.find((x) => x.id === id)?.title ?? id
  const extracted = p.modules.filter((x) => s.extracted[x.id]).map((x) => x.id)
  const refExtract = new Set(m.solution.extract)
  const extraMods = extracted.filter((x) => !refExtract.has(x)).map(title)
  const missingMods = m.solution.extract.filter((x) => !s.extracted[x]).map(title)
  if (extraMods.length) items.push({ tone: 'info', text: `Эталон не выносит: ${extraMods.join(', ')}` })
  if (missingMods.length) items.push({ tone: 'info', text: `Эталон выносит: ${missingMods.join(', ')}` })

  const on = (Object.keys(PATTERNS) as PatternId[]).filter((k) => s.infra[k])
  const refPatterns = new Set(m.solution.patterns)
  const extraPat = on.filter((k) => !refPatterns.has(k)).map((k) => PATTERNS[k].title)
  const missingPat = m.solution.patterns.filter((k) => !s.infra[k]).map((k) => PATTERNS[k].title)
  if (extraPat.length) items.push({ tone: 'info', text: `Паттерны сверх эталона: ${extraPat.join(', ')}` })
  if (missingPat.length) items.push({ tone: 'info', text: `В эталоне ещё есть: ${missingPat.join(', ')}` })
  if (!extraMods.length && !missingMods.length && !extraPat.length && !missingPat.length)
    items.push({ tone: 'ok', text: 'Модули и паттерны совпадают с эталоном' })

  return grade(goalsOk, Math.max(ratio, 0), items)
}
